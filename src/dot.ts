// Graphviz ("whitebox") source for `display`, reproducing upstream's layout:
// numbered call sites, copy / fan-in / fan-out nodes, optional unfolding of
// named sub-circuits into nested clusters.

import type { Def, Expr, Pat, Ty } from "./ast";
import type { Component, Registry } from "./eval";
import { renderText } from "./doc";
import { exprDoc } from "./pretty";

const PRIMITIVE_IDS: Record<string, number> = { nand: 0, dff: 1, zero: 2, srff: 3 };
const PRIMITIVE_PORTS: Record<string, { ins: string[]; outs: string[] }> = {
  nand: { ins: ["X", "Y"], outs: ["Z"] },
  zero: { ins: [], outs: ["__VIRTUAL__0"] },
  dff: { ins: ["D"], outs: ["Q"] },
  srff: { ins: ["S", "R"], outs: ["Q"] },
};

type Role = "inputs" | "outputs" | "gate" | "fanin" | "fanout" | "copy" | "nodeIn" | "nodeOut" | "sink";

interface Ep {
  node: string;
  port?: string; // undefined until a __VIRTUAL__ name is handed out
  role: Role;
  bare?: boolean; // boundary NODE used from the inside
  same?: Wire; // port is whatever this wire's port ends up being
}

interface Wire {
  ep: Ep;
  cable: boolean;
}

interface Cons {
  dst: Ep;
  seq: number;
}

interface Ref {
  wire?: Wire;
  name?: string;
  label?: string;
}

interface Item {
  idx: number;
  kind: "gate" | "fanin" | "fanout" | "copy" | "cluster";
  text: () => string;
  virt?: () => void; // hands out __VIRTUAL__ names, visited in descending idx
}

interface Edge {
  src: Wire;
  dst: Ep;
}

const portOf = (e: Ep): string => (e.same ? portOf(e.same.ep) : e.port ?? "");

const sanitize = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, "_");
const shown = (name: string): string => (name === "one" ? "1" : name === "zero" ? "0" : name);

// ---------------------------------------------------------------------------
// Component ids and port names
// ---------------------------------------------------------------------------

export function circuitId(reg: Registry, name: string): number {
  if (name in PRIMITIVE_IDS) {
    const c = reg.get(name);
    if (!c || c.isPrimitive) return PRIMITIVE_IDS[name]!;
  }
  const c = reg.get(name);
  const given = c?.id;
  if (given !== undefined) return given;
  // fallback: position among the user's defined circuits
  let n = 4;
  for (const [k, v] of reg) {
    if (v.isPrimitive || v.prelude || !v.def) continue;
    if (k === name) return n;
    n++;
  }
  return n;
}

export interface Ports {
  ins: string[];
  outs: string[];
}

export class DotBuilder {
  portCache = new Map<string, Ports>();
  /** callee instances without an implementation, one entry per call */
  unimplemented: string[] = [];
  constructor(public reg: Registry, public unfold: Set<string>) {}

  hasImpl(c: Component | undefined): boolean {
    return !!c && (!!c.isPrimitive || !!c.def);
  }

  ports(name: string): Ports {
    const hit = this.portCache.get(name);
    if (hit) return hit;
    const c = this.reg.get(name);
    let p: Ports;
    if (c?.isPrimitive && PRIMITIVE_PORTS[name]) p = PRIMITIVE_PORTS[name]!;
    else if (c?.def) {
      const L = new Layout(this, name, String(circuitId(this.reg, name)), false, new Set(), true);
      L.build();
      p = { ins: L.inPortNames(), outs: L.outPortNames() };
    } else {
      const ni = c?.ins.length ?? 0;
      const no = c?.outs.length ?? 0;
      p = {
        ins: Array.from({ length: ni }, (_, i) => `__VIRTUAL__${i}`),
        outs: Array.from({ length: no }, (_, i) => `__VIRTUAL__${ni + i}`),
      };
    }
    this.portCache.set(name, p);
    return p;
  }

  /** The complete digraph for `name`. */
  dot(name: string): string {
    const L = new Layout(this, name, String(circuitId(this.reg, name)), false, new Set());
    L.build();
    return L.toplevel();
  }
}

// ---------------------------------------------------------------------------
// One circuit's layout
// ---------------------------------------------------------------------------

const exprLabel = (e: Expr): string => renderText(exprDoc(e));

function patLabel(p: Pat): string {
  if (p.k === "var") return p.name;
  if (p.k === "wild") return "_";
  return `[${p.items.map(patLabel).join(", ")}]`;
}

class Layout {
  idx = 0;
  seq = 0;
  wild = 0;
  vcount = 0;
  items: Item[] = [];
  wires: Wire[] = [];
  consumers = new Map<Wire, Cons[]>();
  pending = new Map<string, Cons[]>();
  binds = new Map<string, Ref>();
  edges: Edge[] = [];
  sinks: string[] = [];
  feeders = new Map<Ep, Wire>();
  def: Def;
  comp: Component;
  id: number;

  inputs: { ep: Ep; label?: string }[] = [];
  outputs: { ep: Ep; label?: string }[] = [];
  // inner (unfolded) layouts talk to their parent through boundary NODEs
  boundaryIn: { port: string; node: string }[] = [];
  boundaryOut: { port: string; node: string }[] = [];

  constructor(
    public b: DotBuilder,
    public name: string,
    public path: string,
    public inner: boolean,
    public stack: Set<string>,
    public portsOnly = false,
  ) {
    this.comp = b.reg.get(name)!;
    this.def = this.comp.def!;
    this.id = circuitId(b.reg, name);
  }

  inPortNames(): string[] {
    return this.inputs.map((i) => portOf(i.ep));
  }
  outPortNames(): string[] {
    return this.outputs.map((o) => portOf(o.ep));
  }

  suffix(idx: number, callee?: number): string {
    return callee === undefined ? `${this.path}__${idx}` : `${this.path}__${idx}__${callee}`;
  }

  newWire(ep: Ep, cable = false): Wire {
    const w: Wire = { ep, cable };
    this.wires.push(w);
    return w;
  }

  consume(ref: Ref, dst: Ep): void {
    const c: Cons = { dst, seq: this.seq++ };
    if (ref.wire) {
      const l = this.consumers.get(ref.wire) ?? [];
      l.push(c);
      this.consumers.set(ref.wire, l);
    } else if (ref.name !== undefined) {
      const l = this.pending.get(ref.name) ?? [];
      l.push(c);
      this.pending.set(ref.name, l);
    }
  }

  // -- evaluation ------------------------------------------------------------

  evalList(es: Expr[]): Ref[] {
    const parts: Ref[][] = new Array(es.length);
    for (let i = es.length - 1; i >= 0; i--) parts[i] = this.evalExpr(es[i]!);
    return parts.flat();
  }

  evalExpr(e: Expr): Ref[] {
    switch (e.k) {
      case "var":
        return [{ name: e.name, label: e.name }];
      case "lit":
        return this.call(e.bit === 1 ? "one" : "zero", []);
      case "hole":
        return [];
      case "cable": {
        const slots = this.evalList(e.items);
        const idx = this.idx++;
        const node = `FANIN_${this.suffix(idx)}`;
        const outW = this.newWire({ node, role: "fanin" }, true);
        const itemEps: Ep[] = slots.map((r, i) => {
          const nm = r.name ?? (e.items[i]?.k === "var" ? (e.items[i] as { name: string }).name : undefined);
          return { node, port: nm, role: "fanin" as Role };
        });
        for (let i = slots.length - 1; i >= 0; i--) this.consume(slots[i]!, itemEps[i]!);
        this.items.push({
          idx,
          kind: "fanin",
          virt: () => {
            for (const ep of itemEps) if (ep.port === undefined) ep.port = this.vname();
            if (outW.ep.port === undefined) outW.ep.port = this.vname();
          },
          text: () => this.fanText("fanin", node, "red", itemEps.map(portOf), portOf(outW.ep), "in"),
        });
        return [{ wire: outW, label: exprLabel(e) }];
      }
      case "app": {
        const args = this.evalList(e.args);
        return this.call(e.name, args);
      }
    }
  }

  vname(): string {
    return `__VIRTUAL__${this.vcount++}`;
  }

  call(name: string, args: Ref[]): Ref[] {
    const callee = this.b.reg.get(name);
    const idx = this.idx++;
    const calleeId = circuitId(this.b.reg, name);
    const ports = this.b.ports(name);
    const cableOut = (j: number): boolean => callee?.outs[j]?.k === "cable";

    const unfoldable = this.b.unfold.has(name) && callee?.def && !this.stack.has(name);
    if (unfoldable) return this.unfolded(name, idx, calleeId, ports, args, cableOut);

    if (!this.b.hasImpl(callee)) this.b.unimplemented.push(name);
    const suffix = this.suffix(idx, calleeId);
    const node = `GATE_${name}_${suffix}`;
    const inEps: Ep[] = ports.ins.map((p) => ({ node, port: p, role: "gate" as Role }));
    for (let i = Math.min(args.length, inEps.length) - 1; i >= 0; i--) this.consume(args[i]!, inEps[i]!);
    const outs = ports.outs.map((p, j) => this.newWire({ node, port: p, role: "gate" }, cableOut(j)));
    this.items.push({
      idx,
      kind: "gate",
      text: () => this.gateText(name, suffix, ports),
    });
    return outs.map((w) => ({ wire: w }));
  }

  unfolded(
    name: string, idx: number, calleeId: number, ports: Ports, args: Ref[], cableOut: (j: number) => boolean,
  ): Ref[] {
    const path = `${this.path}__${idx}__${calleeId}`;
    const sub = new Layout(this.b, name, path, true, new Set([...this.stack, name]));
    sub.build();
    const inEps = ports.ins.map((p) => ({ node: `NODE_${sanitize(p)}_${path}`, port: undefined as string | undefined, role: "nodeIn" as Role }));
    for (let i = Math.min(args.length, inEps.length) - 1; i >= 0; i--) this.consume(args[i]!, inEps[i]!);
    const outs = ports.outs.map((p, j) =>
      this.newWire({ node: `NODE_${sanitize(p)}_${path}`, role: "nodeOut" }, cableOut(j)),
    );
    this.items.push({ idx, kind: "cluster", text: () => sub.clusterText() });
    this.nested.push(sub);
    return outs.map((w) => ({ wire: w }));
  }
  nested: Layout[] = [];

  // -- patterns --------------------------------------------------------------

  sinkNode(): { node: string; port: string } {
    const k = this.wild++;
    const port = `-${k}`;
    const node = `NODE_${sanitize(port)}_${this.path}`;
    this.sinks.push(node);
    return { node, port };
  }

  bindPats(pats: Pat[], refs: Ref[]): void {
    pats.forEach((p, i) => {
      const r = refs[i];
      if (!r) return;
      this.bindPat(p, r);
    });
  }

  bindPat(p: Pat, ref: Ref): void {
    if (p.k === "var") {
      this.binds.set(p.name, ref);
    } else if (p.k === "wild") {
      const s = this.sinkNode();
      this.consume(ref, { node: s.node, role: "sink", bare: true });
    } else {
      this.fanout(p.items, (dst) => this.consume(ref, dst));
    }
  }

  fanout(items: Pat[], feed: (dst: Ep) => void): void {
    const idx = this.idx++;
    const node = `FANOUT_${this.suffix(idx)}`;
    const inEp: Ep = { node, role: "fanout" };
    feed(inEp);
    const outEps: Ep[] = [];
    for (const it of items) {
      if (it.k === "var") {
        const ep: Ep = { node, port: it.name, role: "fanout" };
        outEps.push(ep);
        this.binds.set(it.name, { wire: this.newWire(ep) });
      } else if (it.k === "wild") {
        const s = this.sinkNode();
        const ep: Ep = { node, port: s.port, role: "fanout" };
        outEps.push(ep);
        this.consume({ wire: this.newWire(ep) }, { node: s.node, role: "sink", bare: true });
      } else {
        const ep: Ep = { node, role: "fanout" };
        outEps.push(ep);
        const w = this.newWire(ep, true);
        this.fanout(it.items, (dst) => this.consume({ wire: w }, dst));
      }
    }
    this.items.push({
      idx,
      kind: "fanout",
      virt: () => {
        const f = this.feeders.get(inEp);
        if (f && f.ep.port === undefined) f.ep.port = this.vname();
        inEp.port = f ? portOf(f.ep) : this.vname();
        for (const ep of outEps) if (ep.port === undefined) ep.port = this.vname();
      },
      text: () => this.fanText("fanout", node, "red", outEps.map(portOf), portOf(inEp), "out"),
    });
  }

  // -- the whole circuit -----------------------------------------------------

  build(): void {
    const def = this.def;
    // wildcard parameters are numbered first, left to right
    const paramWild: (string | undefined)[] = def.params.map((p) => (p.k === "wild" ? `-${this.wild++}` : undefined));

    // outputs: processed first, then the equations from last to first
    const rhs = this.evalList(def.rhs);
    const rhsExprs = def.rhs;
    // labels for OUTPUTS ports
    let slot = 0;
    const outSlots: { ref: Ref; label?: string }[] = [];
    for (const e of rhsExprs) {
      const n = this.slotCount(e);
      for (let k = 0; k < n; k++) {
        const r = rhs[slot++];
        if (r) outSlots.push({ ref: r, label: n === 1 ? r.label : undefined });
      }
    }
    const outEps: Ep[] = outSlots.map(({ ref }) => {
      const nm = ref.name;
      const ep: Ep = { node: "", port: nm, role: this.inner ? "nodeOut" : "outputs", bare: this.inner };
      if (nm === undefined && ref.wire && ref.wire.ep.role === "fanin") ep.same = ref.wire;
      return ep;
    });
    for (let i = outSlots.length - 1; i >= 0; i--) this.consume(outSlots[i]!.ref, outEps[i]!);
    this.outputs = outEps.map((ep, i) => ({ ep, label: outSlots[i]!.label }));

    for (let i = def.eqns.length - 1; i >= 0; i--) {
      const q = def.eqns[i]!;
      const refs = this.evalList(q.rhs);
      this.bindPats(q.lhs, refs);
    }

    // parameters, last to first (cable parameters get their fan-outs now)
    const paramEps: { ep: Ep; label?: string }[] = new Array(def.params.length);
    const inRole: Role = this.inner ? "nodeIn" : "inputs";
    for (let i = def.params.length - 1; i >= 0; i--) {
      const p = def.params[i]!;
      if (p.k === "var") {
        const ep: Ep = { node: "", port: p.name, role: inRole, bare: this.inner };
        this.binds.set(p.name, { wire: this.newWire(ep) });
        paramEps[i] = { ep, label: p.name };
      } else if (p.k === "wild") {
        const port = paramWild[i]!;
        const ep: Ep = { node: "", port, role: inRole, bare: this.inner };
        if (!this.inner) {
          const node = `NODE_${sanitize(port)}_${this.path}`;
          this.sinks.push(node);
          this.consume({ wire: this.newWire(ep) }, { node, role: "sink", bare: true });
        }
        paramEps[i] = { ep };
      } else {
        const ep: Ep = { node: "", role: inRole, bare: this.inner };
        const w = this.newWire(ep, true);
        this.fanout(p.items, (dst) => this.consume({ wire: w }, dst));
        paramEps[i] = { ep, label: patLabel(p) };
      }
    }
    this.inputs = paramEps;

    this.resolve();
    this.copies();
    this.numbering();
    this.collectEdges();
  }

  slotCount(e: Expr): number {
    if (e.k === "app") return this.b.reg.get(e.name)?.outs.length ?? 1;
    return 1;
  }

  resolve(): void {
    for (const [name, conss] of this.pending) {
      let ref = this.binds.get(name);
      const seen = new Set<string>();
      while (ref && !ref.wire && ref.name !== undefined && !seen.has(ref.name)) {
        seen.add(ref.name);
        ref = this.binds.get(ref.name);
      }
      if (ref?.wire) {
        const l = this.consumers.get(ref.wire) ?? [];
        l.push(...conss);
        this.consumers.set(ref.wire, l);
      }
    }
    for (const [w, cs] of this.consumers) {
      cs.sort((a, b) => a.seq - b.seq);
      for (const c of cs) if (c.dst.role === "fanout" && !c.dst.port) this.feeders.set(c.dst, w);
    }
  }

  copies(): void {
    const shared = [...this.consumers].filter(([, cs]) => cs.length > 1);
    shared.sort(([a], [b]) => {
      const pa = a.ep.port ?? "";
      const pb = b.ep.port ?? "";
      return pa < pb ? 1 : pa > pb ? -1 : a.ep.node < b.ep.node ? 1 : -1;
    });
    for (const [w, cs] of shared) {
      const idx = this.idx++;
      const node = `COPY_${this.suffix(idx)}`;
      const inEp: Ep = { node, role: "copy", same: w };
      const ordered = [...cs].reverse();
      const outEps = ordered.map(() => ({ node, role: "copy" as Role, port: undefined as string | undefined }));
      this.edges.push({ src: w, dst: inEp });
      const copyWires = ordered.map((c, j) => {
        const cw = this.newWire(outEps[j]!, false);
        this.edges.push({ src: cw, dst: c.dst });
        return cw;
      });
      void copyWires;
      this.consumers.set(w, []); // consumed by the copy edge above
      this.items.push({
        idx,
        kind: "copy",
        virt: () => outEps.forEach((ep) => (ep.port = this.vname())),
        text: () => this.fanText("copy", node, "skyblue", outEps.map(portOf), portOf(w.ep), "out"),
      });
    }
  }

  numbering(): void {
    const order = this.items.filter((i) => i.virt).sort((a, b) => b.idx - a.idx);
    for (const it of order) it.virt!();
    for (const o of this.outputs) if (o.ep.port === undefined && !o.ep.same) o.ep.port = this.vname();
    for (const w of this.wires) if (w.ep.port === undefined && !w.ep.same) w.ep.port = this.vname();
  }

  collectEdges(): void {
    for (const [w, cs] of this.consumers) for (const c of cs) this.edges.push({ src: w, dst: c.dst });
  }

  // -- text ------------------------------------------------------------------

  srcStr(w: Wire): string {
    const e = w.ep;
    switch (e.role) {
      case "inputs": return `${this.nodeName(e)}:${portOf(e)}`;
      case "nodeIn": return `NODE_${sanitize(portOf(e))}_${this.path}`;
      case "nodeOut": return `${e.node}:s`;
      default: return `${this.nodeName(e)}:${portOf(e)}:s`;
    }
  }

  dstStr(e: Ep): string {
    switch (e.role) {
      case "outputs": return `${this.nodeName(e)}:${portOf(e)}`;
      case "sink": return e.node;
      case "nodeIn": return `${e.node}:n`;
      case "nodeOut": return e.bare ? `NODE_${sanitize(portOf(e))}_${this.path}` : e.node;
      default: return `${this.nodeName(e)}:${portOf(e)}:n`;
    }
  }

  nodeName(e: Ep): string {
    if (e.role === "inputs") return `GATE_${this.name}_${this.path}__INPUTS`;
    if (e.role === "outputs") return `GATE_${this.name}_${this.path}__OUTPUTS`;
    return e.node;
  }

  edgeText(e: Edge): string {
    const none = e.dst.role !== "gate" && e.dst.role !== "outputs";
    return `${this.srcStr(e.src)} -> ${this.dstStr(e.dst)} [label=" ", arrowsize = .5 penwidth= ${e.src.cable ? 4 : 2}${none ? " , dir = none" : ""}];`;
  }

  /** this layout's own edges plus those of everything unfolded inside it, as lines */
  allEdges(): string[] {
    return this.edges.map((e) => this.edgeText(e)).sort();
  }

  fanText(kind: string, node: string, color: string, outs: string[], inPort: string, side: "in" | "out"): string {
    const head = `subgraph ${kind === "copy" ? "fanout" : kind}_${node.replace(/^[A-Z]+_/, "")} {\n  style = invis;\n  ${node}\n    [ shape = none\n    , style = filled\n    , fillcolor = ${color}\n    , fixedsize = true\n    , width = 0.14\n    , height = .1\n    , label = <<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0">\n`;
    const n = outs.length;
    const many = outs.map((p) => `<TD PORT="${p}"></TD>\n`).join("");
    const one = `<TD PORT="${inPort}" COLSPAN="${n}"></TD>\n`;
    const rows =
      side === "out"
        ? `               <TR>${one}</TR>\n               <TR>${many}</TR>\n`
        : `               <TR>${many}</TR>\n               <TR>${one}</TR>\n`;
    return `${head}${rows}              </TABLE>>\n    ];\n}\n`;
  }

  gateText(name: string, suffix: string, ports: Ports): string {
    const td = (p: string) => (p.startsWith("__VIRTUAL__") ? `<TD PORT="${p}"></TD>\n` : `<TD PORT="${p}"><FONT POINT-SIZE="7">${p}</FONT></TD>\n`);
    const span = Math.max(1, ports.ins.length, ports.outs.length);
    const inRow = ports.ins.length ? `               <TR>${ports.ins.map(td).join("")}</TR>\n` : "";
    const outRow = ports.outs.length ? `               <TR>${ports.outs.map(td).join("")}</TR>\n` : "";
    return (
      `subgraph gate_${suffix} {\n  style = invis;\n  GATE_${name}_${suffix}\n    [ shape = none\n    , label = <<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="4">\n` +
      inRow +
      `               <TR><TD COLSPAN="${span}"><FONT POINT-SIZE="15">${shown(name)}&nbsp;</FONT></TD></TR>\n` +
      outRow +
      `\n              </TABLE>>\n    ];\n}\n`
    );
  }

  ioText(which: "INPUTS" | "OUTPUTS", cols: { ep: Ep; label?: string }[]): string {
    const tds = cols
      .map((c) => {
        const p = portOf(c.ep);
        return c.label === undefined ? `               <TD PORT="${p}"></TD>\n` : `               <TD PORT="${p}"><FONT POINT-SIZE="20">${c.label}</FONT></TD>\n`;
      })
      .join("");
    return `  GATE_${this.name}_${this.path}__${which}\n    [ shape = none\n    , label = <<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="20">\n               <TR>\n${tds}\n               </TR>\n               </TABLE>>\n    ];\n`;
  }

  title(): string {
    return `  label=<<table border="0"><tr><td border="1">${shown(this.name)}&nbsp;</td></tr></table>>;\n  labeljust=l;\n`;
  }

  body(): string {
    const sinks = [...this.sinks].sort().map((n) => `  ${n} [label="", shape=point, height=0];\n`).join("");
    const items = [...this.items].sort((a, b) => a.idx - b.idx).map((i) => i.text()).join("");
    return sinks + items;
  }

  /** an unfolded call: a solid cluster, boundary points, then (outside it) its inner edges */
  clusterText(): string {
    const pts = [
      ...this.b.ports(this.name).ins,
      ...this.b.ports(this.name).outs,
    ].map((p) => `NODE_${sanitize(p)}_${this.path}`);
    const nodes = [...pts].sort().map((n) => `  ${n} [label="", shape=point, height=0];\n`).join("");
    return (
      `subgraph cluster_circuit__GATE_${this.name}_${this.path} {\n  style=solid;\n` +
      this.title() +
      nodes +
      this.body() +
      `}\n` +
      this.allEdges().join("\n") + (this.edges.length ? "\n" : "")
    );
  }

  toplevel(): string {
    const hdr =
      `digraph whitebox {\n  margin = 0;\n  rankdir = TB;\n  nodesep = 0;\n  ranksep = 0.05;\n` +
      `  graph [fontname = "Lucida Sans Typewriter"];\n  node [fontname = "Lucida Sans Typewriter"];\n  edge [fontname = "Lucida Sans Typewriter"];\n`;
    const ins = this.inputs.length ? this.ioText("INPUTS", this.inputs) : "";
    const outs = this.outputs.length ? this.ioText("OUTPUTS", this.outputs) : "";
    return (
      hdr + ins + `\nsubgraph cluster_circuit__GATE_${this.name}_${this.path} {\n  style=dashed;\n  margin = 10;\n` +
      this.title() + this.body() + `}\n` + outs + `\n` + this.allEdges().join("\n") + (this.edges.length ? "\n" : "") + `}\n`
    );
  }
}
