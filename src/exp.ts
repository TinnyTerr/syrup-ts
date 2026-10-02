// Statement handlers for experiments: truth tables, simulation,
// bisimulation, unit tests and property tests.
import type { Ctx } from "./ctx";
import {
  type Message, type Doc, type TCell, type Table,
  br, seq, code, circ, fn, indent, sepBy,
} from "./doc";
import {
  type ExpSim, type ExpUnit, type ExpForall, type Expr, type Pat, type Ty, type ValueLit,
  BIT, tyToString, tyWidth, indexDef,
} from "./ast";
import {
  type Bit, type Value, type Registry, type Component, RuntimeError,
  runComponent, memLayout, reshapeList, flattenValues, allBitCombos, widthOfTys,
} from "./eval";
import { truthTable, simulate, equivalence } from "./experiments";
import { graphicalCell } from "./display";
import { tyListDoc, exprDoc } from "./pretty";

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const fmtBit = (b: Bit): string => (b === "X" ? "?" : String(b));
const compact = (v: Value): string => (Array.isArray(v) ? "[" + v.map(compact).join("") + "]" : fmtBit(v));
const compactAll = (vs: Value[]): string => vs.map(compact).join("");
const pad = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - s.length));
const flatKey = (vs: Value[]): string => flattenValues(vs).join("");

function getComp(reg: Registry, name: string): Component {
  const c = reg.get(name);
  if (!c) throw new RuntimeError(`\`${name}\` is not declared`);
  return c;
}

const isStub = (c: Component): boolean => !c.def && !c.isPrimitive;
const stubError = (name: string): RuntimeError =>
  new RuntimeError(`Circuit \`${name}\` is a stub (has no definition).`);

/** Names given to primitive inputs and outputs in tables. */
const PRIM_NAMES: Record<string, { ins: string[]; outs: string[] }> = {
  nand: { ins: ["X", "Y"], outs: [""] },
  zero: { ins: [], outs: [""] },
  dff: { ins: ["D"], outs: ["Q"] },
  srff: { ins: ["S", "R"], outs: ["Q"] },
};

const hasGraphical = (t: Ty): boolean =>
  t.alias === "7Segments" || t.alias === "Braille" || (t.k === "cable" && t.items.some(hasGraphical));

const memType = (n: number): string => `{${Array.from({ length: n }, () => "<Bit>").join(", ")}}`;

function statesOf(n: number): Bit[][] {
  return [...allBitCombos(n)];
}

function memMap(paths: string[], bits: Bit[]): Map<string, Bit> {
  return new Map(paths.map((p, i) => [p, bits[i] ?? 0] as [string, Bit]));
}

const memBits = (bits: Bit[]): string => `{${bits.map(fmtBit).join("")}}`;

// ---------------------------------------------------------------------------
// column specs for truth tables
// ---------------------------------------------------------------------------

interface Spec {
  header: string;
  cell: (v: Value | undefined) => string;
  /** width of the widest cell of this type */
  w?: number;
}

const tyCellWidth = (t: Ty | undefined): number => (!t ? 1 : t.k === "bit" ? 1 : 2 + t.items.reduce((n, i) => n + tyCellWidth(i), 0));
const specWidth = (s: Spec): number => Math.max(1, s.header.length, s.w ?? 1);

function cableSpec(items: Spec[], ty?: Ty): Spec {
  return {
    w: tyCellWidth(ty),
    header: "[" + items.map((s) => pad(s.header, specWidth(s))).join(" ") + "]",
    cell: (v) =>
      Array.isArray(v)
        ? "[" + items.map((s, i) => pad(s.cell(v[i]), specWidth(s))).join(" ") + "]"
        : v === undefined ? "?" : compact(v),
  };
}

const itemTy = (t: Ty | undefined, i: number): Ty | undefined => (t && t.k === "cable" ? t.items[i] : undefined);

function patSpec(p: Pat, ty?: Ty): Spec {
  const w = tyCellWidth(ty);
  if (p.k === "var") return { header: p.name, w, cell: (v) => (v === undefined ? "?" : compact(v)) };
  if (p.k === "wild") return { header: "_", w, cell: (v) => (v === undefined ? "?" : compact(v)) };
  return cableSpec(p.items.map((q, i) => patSpec(q, itemTy(ty, i))), ty);
}

function exprSpec(e: Expr, ty?: Ty): Spec {
  const w = tyCellWidth(ty);
  if (e.k === "var") return { header: e.name, w, cell: (v) => (v === undefined ? "?" : compact(v)) };
  if (e.k === "cable") return cableSpec(e.items.map((q, i) => exprSpec(q, itemTy(ty, i))), ty);
  return tySpec(ty);
}

// an output that has no name of its own: blank header as wide as its bits, items spaced out
function tySpec(ty?: Ty): Spec {
  const w = tyCellWidth(ty);
  if (!ty || ty.k === "bit") return { header: " ", w, cell: (v) => (v === undefined ? "?" : compact(v)) };
  const items = ty.items.map(tySpec);
  return {
    w,
    header: " ".repeat(flatBits(ty)),
    cell: (v) =>
      Array.isArray(v)
        ? "[" + items.map((s, i) => pad(s.cell(v[i]), specWidth(s))).join(" ") + "]"
        : v === undefined ? "?" : compact(v),
  };
}

const flatBits = (t: Ty): number => (t.k === "bit" ? 1 : t.items.reduce((n, i) => n + flatBits(i), 0));

const unknownOf = (t: Ty): Value => (t.k === "bit" ? "X" : t.items.map(unknownOf));

// ---------------------------------------------------------------------------
// truth tables
// ---------------------------------------------------------------------------

interface OutCol {
  spec: Spec;
  ty?: Ty;
}

function outColumns(reg: Registry, c: Component): OutCol[] {
  if (c.isPrimitive) {
    const names = PRIM_NAMES[c.name]?.outs ?? c.outs.map(() => "");
    return c.outs.map((t, i) => ({ spec: { header: names[i] ?? "", cell: (v) => (v === undefined ? "?" : compact(v)) }, ty: t }));
  }
  if (!c.def) {
    return c.outs.map((t) => ({ spec: { header: "", cell: (v) => (v === undefined ? "?" : compact(v)) }, ty: t }));
  }
  const cols: OutCol[] = [];
  let slot = 0;
  for (const e of c.def.rhs) {
    const k = e.k === "app" ? reg.get(e.name)?.outs.length ?? 1 : 1;
    if (e.k === "app" && k !== 1) {
      for (let i = 0; i < k; i++) cols.push({ spec: exprSpec({ k: "hole" }, c.outs[slot + i]), ty: c.outs[slot + i] });
    } else cols.push({ spec: exprSpec(e, c.outs[slot]), ty: c.outs[slot] });
    slot += k;
  }
  return cols;
}

function inColumns(c: Component): Spec[] | undefined {
  if (c.isPrimitive) {
    const names = PRIM_NAMES[c.name]?.ins ?? c.ins.map(() => "");
    return c.ins.map((_, i) => ({ header: names[i] ?? "", cell: (v) => (v === undefined ? "?" : compact(v)) }));
  }
  if (!c.def) return undefined;
  return c.def.params.map((p, i) => patSpec(p, c.ins[i]));
}

function truthTableDoc(ctx: Ctx, name: string): Doc {
  const html = ctx.opts.format === "html";
  const c = getComp(ctx.reg, name);
  const inCols = inColumns(c);
  const outCols = outColumns(ctx.reg, c);
  const layout = isStub(c) ? { paths: [], names: [] } : memLayout(ctx.reg, name);
  const n = layout.paths.length;
  const stateful = n > 0;

  const nIn = c.ins.length;
  const headers: TCell[] = [];
  if (inCols) inCols.forEach((s) => headers.push({ text: s.header }));
  else for (let i = 0; i < nIn; i++) headers.push({ text: "" });
  const widths = layout.names.map((nm) => Math.max(1, nm.length));
  const memHead = () => {
    const names = layout.names.map((nm, i) => pad(nm, widths[i]!)).join(" ");
    return `{ ${names} -> ${names} }`;
  };
  if (stateful) headers.push({ text: memHead() });
  outCols.forEach((o) => headers.push({ text: o.ty && hasGraphical(o.ty) ? " ".repeat(flatBits(o.ty)) : o.spec.header || " " }));
  const anyHeader = !!inCols && headers.some((h) => h.text.trim() !== "" || h.text !== "");

  const width = widthOfTys(c.ins);
  const states = statesOf(n);
  const groups: TCell[][][] = [];
  for (const flat of allBitCombos(width)) {
    const inputs = reshapeList(flat, c.ins);
    const inCells: TCell[] = inputs.map((v, i) => ({ text: inCols ? inCols[i]!.cell(v) : compact(v) }));
    const rows: TCell[][] = [];
    for (const st of states) {
      let outputs: Value[];
      let next: Bit[] = st;
      try {
        if (isStub(c)) throw stubError(name);
        const r = runComponent(ctx.reg, name, inputs, memMap(layout.paths, st));
        outputs = r.outputs;
        next = layout.paths.map((p) => r.nextMem.get(p) ?? 0);
      } catch (e) {
        if (!(e instanceof RuntimeError) || !/is a stub/.test(e.message)) throw e;
        outputs = outCols.map((o) => (o.ty ? unknownOf(o.ty) : "X"));
        next = st.map(() => "X" as Bit);
      }
      const cells: TCell[] = [...inCells];
      if (stateful) {
        const b = st.map((x, i) => pad(fmtBit(x), widths[i]!)).join(" ");
        const a = next.map((x, i) => pad(fmtBit(x), widths[i]!)).join(" ");
        cells.push({ text: `{ ${b} -> ${a} }` });
      }
      outCols.forEach((o, i) => {
        const v = outputs[i];
        const g = o.ty && v !== undefined && hasGraphical(o.ty) && Array.isArray(v) ? graphicalCell(o.ty, v, html) : undefined;
        cells.push(g ?? { text: o.spec.cell(v) });
      });
      rows.push(cells);
    }
    groups.push(rows);
  }

  const table: Table = {
    headers: anyHeader ? headers : undefined,
    split: nIn + (stateful ? 1 : 0),
    spanCols: nIn,
    groups,
    ruled: stateful,
  };
  return seq("Truth table for ", circ(name), ":", br, indent({ t: "table", table }));
}

export function runTruth(ctx: Ctx, name: string): Message[] {
  const doc = truthTableDoc(ctx, name);
  let legacy: string;
  try {
    legacy = truthTable(ctx.reg, name);
  } catch (e) {
    legacy = e instanceof RuntimeError ? `Error: ${e.message}` : (() => { throw e; })();
  }
  return [{ level: "happy", doc, legacy }];
}

// ---------------------------------------------------------------------------
// input / output literal checking
// ---------------------------------------------------------------------------

function fits(lit: ValueLit, t: Ty): boolean {
  if (t.k === "bit") return typeof lit === "number";
  return Array.isArray(lit) && lit.length === t.items.length && lit.every((x, i) => fits(x, t.items[i]!));
}

function litText(l: ValueLit): string {
  return Array.isArray(l) ? "[" + l.map(litText).join("") + "]" : String(l);
}

function checkLits(tys: Ty[], lits: ValueLit[]): boolean {
  return lits.length === tys.length && lits.every((l, i) => fits(l, tys[i]!));
}

const asValues = (lits: ValueLit[]): Value[] => lits as Value[];

// ---------------------------------------------------------------------------
// simulation
// ---------------------------------------------------------------------------

export function runSim(ctx: Ctx, s: ExpSim): Message[] {
  const c = getComp(ctx.reg, s.name);
  if (isStub(c)) throw stubError(s.name);
  const layout = memLayout(ctx.reg, s.name);
  const n = layout.paths.length;
  const stateful = n > 0;
  for (const step of s.steps) {
    if (!checkLits(c.ins, step)) {
      return [{
        level: "error",
        doc: seq(
          "Inputs for ", circ(s.name), " are typed ", code("(", tyListDoc(c.ins), ")"), ".", br,
          "That can't accept ", code("(" + step.map(litText).join(", ") + ")"), ".",
        ),
      }];
    }
  }

  let mem: Bit[] = layout.paths.map((_, i) => (s.mem?.[i] ?? 0) as Bit);
  const rows: TCell[][] = [];
  s.steps.forEach((step, t) => {
    const inputs = asValues(step);
    const r = runComponent(ctx.reg, s.name, inputs, memMap(layout.paths, mem));
    const cells: TCell[] = [{ text: `${t}:`, html: `<code>${t}</code>` }];
    if (stateful) cells.push({ text: memBits(mem) });
    cells.push({ text: compactAll(inputs) }, { text: compactAll(r.outputs) });
    rows.push(cells);
    mem = layout.paths.map((p) => r.nextMem.get(p) ?? 0);
  });
  if (stateful) {
    rows.push([
      { text: `${s.steps.length}:`, html: `<code>${s.steps.length}</code>` },
      { text: memBits(mem) }, { text: "" }, { text: "" },
    ]);
  }

  const headers: TCell[] = [{ text: "Time" }];
  if (stateful) headers.push({ text: "State" });
  headers.push({ text: "Input" }, { text: "Output" });
  const table: Table = { headers, groups: rows.map((r) => [r]), rowHead: true, padHtml: false };

  let legacy: string;
  try {
    legacy = simulate(ctx.reg, s.name, s.steps as Value[][], (s.mem ?? []) as Bit[]);
  } catch (e) {
    legacy = e instanceof RuntimeError ? `Error: ${e.message}` : (() => { throw e; })();
  }
  return [{ level: "happy", doc: seq("Simulation for ", circ(s.name), ":", br, indent({ t: "table", table })), legacy }];
}

// ---------------------------------------------------------------------------
// bisimulation
// ---------------------------------------------------------------------------

interface Machine {
  name: string;
  nstates: number;
  /** out[s][i]: output key; next[s][i]: next state index */
  out: string[][];
  next: number[][];
  bitsOf: (s: number) => Bit[];
  inputText: string[];
}

const stateIndex = (bits: Bit[]): number => bits.reduce<number>((a, b) => a * 2 + (b === 1 ? 1 : 0), 0);

function buildMachine(reg: Registry, name: string, ins: Ty[]): Machine {
  const c = getComp(reg, name);
  if (isStub(c)) throw stubError(name);
  const layout = memLayout(reg, name);
  const states = statesOf(layout.paths.length);
  const combos = [...allBitCombos(widthOfTys(ins))];
  const out: string[][] = [];
  const next: number[][] = [];
  for (const st of states) {
    const o: string[] = [];
    const nx: number[] = [];
    for (const flat of combos) {
      const inputs = reshapeList(flat, c.ins);
      const r = runComponent(reg, name, inputs, memMap(layout.paths, st));
      o.push(flatKey(r.outputs));
      nx.push(stateIndex(layout.paths.map((p) => r.nextMem.get(p) ?? 0)));
    }
    out.push(o);
    next.push(nx);
  }
  return {
    name, nstates: states.length, out, next,
    bitsOf: (s) => states[s]!,
    inputText: combos.map((flat) => compactAll(reshapeList(flat, c.ins))),
  };
}

/** shortest, then lexicographically smallest, input sequence telling (x@s) from (y@t) apart */
function witness(x: Machine, y: Machine, s: number, t: number): string[] | undefined {
  const key = (a: number, b: number) => a * y.nstates + b;
  const seen = new Map<number, { parent: number; input: number }>();
  seen.set(key(s, t), { parent: -1, input: -1 });
  const queue: Array<[number, number]> = [[s, t]];
  for (let qi = 0; qi < queue.length; qi++) {
    const [a, b] = queue[qi]!;
    for (let i = 0; i < x.inputText.length; i++) {
      if (x.out[a]![i] !== y.out[b]![i]) {
        const path = [x.inputText[i]!];
        for (let k = key(a, b); seen.get(k)!.parent !== -1; k = seen.get(k)!.parent) path.unshift(x.inputText[seen.get(k)!.input]!);
        return path;
      }
      const na = x.next[a]![i]!;
      const nb = y.next[b]![i]!;
      const nk = key(na, nb);
      if (!seen.has(nk)) {
        seen.set(nk, { parent: key(a, b), input: i });
        queue.push([na, nb]);
      }
    }
  }
  return undefined;
}

export function runEquiv(ctx: Ctx, a: string, b: string): Message[] {
  let legacy: string;
  try {
    legacy = equivalence(ctx.reg, a, b);
  } catch (e) {
    legacy = e instanceof RuntimeError ? `Error: ${e.message}` : (() => { throw e; })();
  }
  const ca = getComp(ctx.reg, a);
  const cb = getComp(ctx.reg, b);
  if (isStub(ca)) throw stubError(a);
  if (isStub(cb)) throw stubError(b);
  const title: Doc = seq("Bisimulation between ", circ(a), ", ", circ(b), ":");
  const wrap = (body: Doc): Message[] => [{ level: "happy", doc: seq(title, br, indent(body)), legacy }];

  if (widthOfTys(ca.ins) !== widthOfTys(cb.ins) || widthOfTys(ca.outs) !== widthOfTys(cb.outs)) {
    return [{
      level: "happy",
      doc: seq(circ(a), " and ", circ(b), " are not comparable: different signal widths."),
      legacy,
    }];
  }

  const A = buildMachine(ctx.reg, a, ca.ins);
  const B = buildMachine(ctx.reg, b, ca.ins === cb.ins ? ca.ins : cb.ins);
  const nin = A.inputText.length;

  // stateless on both sides: compare directly and list every disagreement
  if (A.nstates === 1 && B.nstates === 1) {
    const bad: Doc[] = [];
    for (let i = 0; i < nin; i++) {
      if (A.out[0]![i] !== B.out[0]![i]) {
        bad.push(seq(
          code(a, "(", A.inputText[i]!, ") = ", outText(ctx.reg, a, A, i)), " but ",
          code(b, "(", B.inputText[i]!, ") = ", outText(ctx.reg, b, B, i)),
        ));
      }
    }
    if (bad.length) {
      return wrap(seq(circ(a), " has a behaviour that ", circ(b), " does not match", ...bad.flatMap((l) => [br, l])));
    }
    return wrap(seq(circ(a), " behaves like ", circ(b), br, indent(seq(code("{}"), " ~ ", code("{}")))));
  }

  // greatest bisimulation over all pairs of states
  const R: boolean[][] = Array.from({ length: A.nstates }, (_, s) =>
    Array.from({ length: B.nstates }, (_, t) => A.out[s]!.every((o, i) => o === B.out[t]![i])),
  );
  for (let changed = true; changed; ) {
    changed = false;
    for (let s = 0; s < A.nstates; s++) {
      for (let t = 0; t < B.nstates; t++) {
        if (!R[s]![t]) continue;
        for (let i = 0; i < nin; i++) {
          if (!R[A.next[s]![i]!]![B.next[t]![i]!]) {
            R[s]![t] = false;
            changed = true;
            break;
          }
        }
      }
    }
  }
  const aOrphans = [...Array(A.nstates).keys()].filter((s) => !R[s]!.some(Boolean));
  const bOrphans = [...Array(B.nstates).keys()].filter((t) => !R.some((row) => row[t]));

  if (aOrphans.length === 0 && bOrphans.length === 0) {
    const lines: Doc[] = [];
    for (let s = A.nstates - 1; s >= 0; s--) {
      const ts = [...Array(B.nstates).keys()].filter((t) => R[s]![t]);
      lines.push(seq(code(memBits(A.bitsOf(s))), " ~ ", code("{" + ts.map((t) => B.bitsOf(t).map(fmtBit).join("")).join("") + "}")));
    }
    return wrap(seq(circ(a), " behaves like ", circ(b), br, indent(sepBy(lines, br))));
  }

  // report the orphan state with the longest distinguishing sequences
  const explain = (X: Machine, Y: Machine, orphans: number[], flip: boolean): Doc => {
    let best: { s: number; ws: Array<{ t: number; w: string[] }>; score: number } | undefined;
    for (const s of orphans) {
      const ws: Array<{ t: number; w: string[] }> = [];
      for (let t = Y.nstates - 1; t >= 0; t--) {
        const w = flip ? witness(Y, X, t, s) : witness(X, Y, s, t);
        ws.push({ t, w: w ?? [] });
      }
      const score = Math.max(...ws.map((x) => x.w.length));
      if (!best || score > best.score) best = { s, ws, score };
    }
    const head = seq(circ(X.name), " can be distinguished from all possible states of ", circ(Y.name));
    const when = seq("when ", circ(X.name), " has memory ", code(memBits(X.bitsOf(best!.s))));
    const ifs = best!.ws.map(({ t, w }) =>
      seq("if ", circ(Y.name), " has memory like ", code(memBits(Y.bitsOf(t))), ", try inputs ", code(w.join(";"))),
    );
    // upstream glues the first two lines together when the stranded state belongs to the second circuit
    return seq(head, flip ? "" : br, when, ...ifs.flatMap((l) => [br, l]));
  };
  const doc = aOrphans.length ? explain(A, B, aOrphans, false) : explain(B, A, bOrphans, true);
  return [{ level: "happy", doc: seq(title, br, indent(doc)), legacy }];
}

// the output of machine `m` (state 0) at input i, shown as the circuit's own output list
function outText(reg: Registry, name: string, m: Machine, i: number): string {
  const c = reg.get(name)!;
  const layout = memLayout(reg, name);
  const flat = [...allBitCombos(widthOfTys(c.ins))][i]!;
  const r = runComponent(reg, name, reshapeList(flat, c.ins), memMap(layout.paths, m.bitsOf(0)));
  return compactAll(r.outputs);
}

// ---------------------------------------------------------------------------
// unit tests
// ---------------------------------------------------------------------------

export function runUnit(ctx: Ctx, s: ExpUnit): Message[] {
  const c = getComp(ctx.reg, s.name);
  if (isStub(c)) throw stubError(s.name);
  const layout = memLayout(ctx.reg, s.name);
  const n = layout.paths.length;
  const rest = s.text.slice(s.name.length);
  const title = seq("When unit testing ", code(fn(s.name), rest), ":");
  const result = (level: "happy" | "error", body: Doc): Message[] => [
    { level, doc: seq(title, br, indent(body)) },
  ];
  const memErr = (bits: number[]) =>
    result("error", seq(
      "Memory for ", circ(s.name), " has type ", code(memType(n)), ".", br,
      "That can't store ", memBits(bits as Bit[]), ".",
    ));

  if (s.mem && s.mem.length !== n) return memErr(s.mem);
  if (!checkLits(c.ins, s.inputs)) {
    return result("error", seq(
      "Inputs for ", circ(s.name), " are typed ", code("(", tyListDoc(c.ins), ")"), ".", br,
      "That can't accept ", code("(" + s.inputs.map(litText).join(", ") + ")"), ".",
    ));
  }
  if (s.expMem && s.expMem.length !== n) return memErr(s.expMem);
  if (!checkLits(c.outs, s.outputs)) {
    return result("error", seq(
      "Outputs for ", circ(s.name), " are typed ", code(tyListDoc(c.outs)), ".", br,
      "That can't accept ", code(s.outputs.map(litText).join(", ")), ".",
    ));
  }

  const start = layout.paths.map((_, i) => (s.mem?.[i] ?? 0) as Bit);
  const r = runComponent(ctx.reg, s.name, asValues(s.inputs), memMap(layout.paths, start));
  const nextBits = layout.paths.map((p) => r.nextMem.get(p) ?? 0);
  const wantOut = flatKey(asValues(s.outputs));
  const gotOut = flatKey(r.outputs);
  const memOk = !s.expMem || s.expMem.join("") === nextBits.map(fmtBit).join("");
  if (wantOut === gotOut && memOk) return result("happy", "Success!");
  const got = (n > 0 && s.expMem ? memBits(nextBits) : "") + r.outputs.map(compact).join(", ");
  const want = (s.expMem ? memBits(s.expMem as Bit[]) : "") + s.outputs.map(litText).join(", ");
  return result("error", seq("Expected ", code(want), " but got ", code(got), "."));
}

// ---------------------------------------------------------------------------
// property tests
// ---------------------------------------------------------------------------

type MaybeTy = Ty | undefined;

function slotTys(reg: Registry, e: Expr, env: Map<string, MaybeTy>): MaybeTy[] {
  switch (e.k) {
    case "var": return [env.get(e.name)];
    case "lit": return [BIT];
    case "hole": return [undefined];
    case "cable": {
      const items = e.items.flatMap((i) => slotTys(reg, i, env));
      return [items.every((t) => t !== undefined) ? { k: "cable", items: items as Ty[] } : undefined];
    }
    case "app": return reg.get(e.name)?.outs ?? [undefined];
  }
}

function assign(e: Expr, t: MaybeTy, env: Map<string, MaybeTy>): boolean {
  if (!t) return false;
  if (e.k === "var") {
    if (env.has(e.name) && env.get(e.name) === undefined) {
      env.set(e.name, t);
      return true;
    }
    return false;
  }
  if (e.k === "cable" && t.k === "cable") {
    let ch = false;
    e.items.forEach((i, k) => { if (t.items[k] && assign(i, t.items[k], env)) ch = true; });
    return ch;
  }
  return false;
}

function constrain(reg: Registry, e: Expr, env: Map<string, MaybeTy>): boolean {
  let ch = false;
  if (e.k === "cable") e.items.forEach((i) => { if (constrain(reg, i, env)) ch = true; });
  else if (e.k === "app") {
    const callee = reg.get(e.name);
    e.args.forEach((a, i) => {
      if (callee && callee.ins[i] && assign(a, callee.ins[i], env)) ch = true;
      if (constrain(reg, a, env)) ch = true;
    });
  }
  return ch;
}

// pair up two expressions and propagate known types across `=`
function align(reg: Registry, a: Expr, b: Expr, env: Map<string, MaybeTy>): boolean {
  let ch = false;
  if (a.k === "cable" && b.k === "cable" && a.items.length === b.items.length) {
    a.items.forEach((x, i) => { if (align(reg, x, b.items[i]!, env)) ch = true; });
    return ch;
  }
  const ta = slotTys(reg, a, env);
  const tb = slotTys(reg, b, env);
  if (tb.length === 1 && assign(a, tb[0], env)) ch = true;
  if (ta.length === 1 && assign(b, ta[0], env)) ch = true;
  return ch;
}

const listTy = (ts: MaybeTy[]): string => "[" + ts.map((t) => (t ? tyToString(t, ", ") : "?")).join(", ") + "]";

export function runForall(ctx: Ctx, s: ExpForall): Message[] {
  const reg = ctx.reg;
  const title = seq("When property testing ", code(exprDoc(s.lhs), " = ", exprDoc(s.rhs)), ":");
  const result = (level: "happy" | "error", body: Doc): Message[] => [{ level, doc: seq(title, br, indent(body)) }];

  const env = new Map<string, MaybeTy>(s.vars.map((v) => [v, undefined]));
  constrain(reg, s.lhs, env);
  constrain(reg, s.rhs, env);
  for (let i = 0; i < 4; i++) {
    if (!align(reg, s.lhs, s.rhs, env)) break;
  }

  // a bare variable is checked against the other side's whole list of types
  for (const [v, other] of [[s.lhs, s.rhs], [s.rhs, s.lhs]] as const) {
    if (v.k === "var") {
      const ts = slotTys(reg, other, env);
      if (ts.length !== 1) return result("error", `The variable ${v.name} is checked against a list of types ${listTy(ts)}.`);
    }
  }
  for (const v of s.vars) {
    if (!env.get(v)) return result("error", `Failed to infer the type of ${v}.`);
  }

  const tys = s.vars.map((v) => env.get(v)!);
  const mk = (name: string, e: Expr): Registry => {
    const def = { k: "def" as const, name, params: s.vars.map((v) => ({ k: "var" as const, name: v })), rhs: [e], eqns: [] };
    indexDef(def);
    const reg2: Registry = new Map(reg);
    reg2.set(name, { name, ins: tys, outs: [], def });
    (def as { varOwner?: Map<string, number> }).varOwner = new Map();
    return reg2;
  };
  const regL = mk("__lhs", s.lhs);
  const regR = mk("__rhs", s.rhs);

  const bad: Doc[] = [];
  const width = tys.reduce((n, t) => n + tyWidth(t), 0);
  for (const flat of allBitCombos(width)) {
    const inputs = reshapeList(flat, tys);
    const l = runComponent(regL, "__lhs", inputs, new Map()).outputs;
    const r = runComponent(regR, "__rhs", inputs, new Map()).outputs;
    if (flatKey(l) !== flatKey(r)) {
      const args = compactAll(inputs);
      bad.push(seq(
        code(exprDoc(s.lhs), `(${args}) = ${compactAll(l)}`), " but ",
        code(exprDoc(s.rhs), `(${args}) = ${compactAll(r)}`),
      ));
    }
  }
  if (bad.length === 0) return result("happy", "Success!");
  return result("error", seq(
    code(exprDoc(s.lhs)), " has a behaviour that ", code(exprDoc(s.rhs)), " does not match", ...bad.flatMap((l) => [br, l]),
  ));
}

