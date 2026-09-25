// Renders a defined circuit's immediate structure (its own gates and
// sub-circuit calls, one level deep — callees stay as labelled boxes rather
// than being inlined) as a Mermaid flowchart, so it can be dropped straight
// into a browser page that has mermaid.js loaded.

import type { Def, Expr, Pat } from "./ast";
import { type Registry, RuntimeError } from "./eval";

type Origin =
  | { k: "input"; name: string }
  | { k: "lit"; bit: 0 | 1 }
  | { k: "gate"; id: string; port: number };

// One equation "slot" (an output value position) may be a bundle built up
// from several underlying sources (e.g. a literal cable `[a,b]`); we track
// all of them so every physical wire ends up as its own edge.
type Ref = Origin[];

interface GateNode {
  id: string;
  label: string;
}

interface Edge {
  from: Origin;
  to: { id: string; port: number } | { output: number };
}

interface Graph {
  nodes: GateNode[];
  edges: Edge[];
}

function buildGraph(reg: Registry, name: string): Graph {
  const c = reg.get(name);
  if (!c) throw new RuntimeError(`\`${name}\` is not declared`);
  if (!c.def) {
    throw new RuntimeError(`Circuit \`${name}\` is a stub (has no definition), so it can't be displayed.`);
  }
  const def: Def = c.def;

  const nodes: GateNode[] = [];
  const edges: Edge[] = [];
  const env = new Map<string, Ref>();
  const computing = new Set<string>();

  const bindParams = (p: Pat): void => {
    if (p.k === "var") env.set(p.name, [{ k: "input", name: p.name }]);
    else if (p.k === "cable") p.items.forEach(bindParams);
  };
  def.params.forEach(bindParams);

  const bindPat = (p: Pat, ref: Ref): void => {
    if (p.k === "wild") return;
    if (p.k === "var") { env.set(p.name, ref); return; }
    // A cable pattern destructures one bundle into several names; for
    // display purposes they're all just projections of the same wire.
    p.items.forEach((item) => bindPat(item, ref));
  };
  const bindPatList = (pats: Pat[], slots: Ref[]): void => {
    pats.forEach((p, i) => bindPat(p, slots[i] ?? []));
  };

  const resolveVar = (varName: string): Ref => {
    const existing = env.get(varName);
    if (existing) return existing;
    const eqnIdx = def.varOwner?.get(varName);
    if (eqnIdx === undefined) throw new RuntimeError(`unbound variable \`${varName}\``);
    if (computing.has(varName)) {
      throw new RuntimeError(`combinational cycle involving \`${varName}\``);
    }
    computing.add(varName);
    const eqn = def.eqns[eqnIdx]!;
    const slots = slotListOf(eqn.rhs);
    bindPatList(eqn.lhs, slots);
    computing.delete(varName);
    return env.get(varName) ?? [];
  };

  function slotsOf(e: Expr): Ref[] {
    switch (e.k) {
      case "var": return [resolveVar(e.name)];
      case "lit": return [[{ k: "lit", bit: e.bit }]];
      case "cable": return [slotListOf(e.items).flat()];
      case "app": return appSlots(e);
    }
  }
  function slotListOf(exprs: Expr[]): Ref[] {
    return exprs.flatMap(slotsOf);
  }

  function appSlots(e: Extract<Expr, { k: "app" }>): Ref[] {
    const callee = reg.get(e.name);
    if (!callee) throw new RuntimeError(`\`${e.name}\` is not declared`);
    const id = `g${e.idx}`;
    nodes.push({ id, label: e.name });

    const argSlots = slotListOf(e.args);
    argSlots.forEach((ref, portIdx) => {
      ref.forEach((origin) => edges.push({ from: origin, to: { id, port: portIdx } }));
    });

    return Array.from(
      { length: callee.outs.length },
      (_, port): Ref => [{ k: "gate", id, port }]
    );
  }

  const outSlots = slotListOf(def.rhs);
  outSlots.forEach((ref, outIdx) => {
    ref.forEach((origin) => edges.push({ from: origin, to: { output: outIdx } }));
  });

  return { nodes, edges };
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, "_");
}

export function toMermaid(reg: Registry, name: string): string {
  const g = buildGraph(reg, name);

  const inputNames = new Set<string>();
  let maxOutput = -1;
  for (const e of g.edges) {
    if (e.from.k === "input") inputNames.add(e.from.name);
    if ("output" in e.to) maxOutput = Math.max(maxOutput, e.to.output);
  }
  const outCount = maxOutput + 1;

  const lines: string[] = [`flowchart LR`, `  subgraph ${sanitize(name)}["\`${name}\`"]`];
  for (const n of [...inputNames].sort()) {
    lines.push(`    in_${sanitize(n)}(("${n}"))`);
  }
  for (const n of g.nodes) {
    lines.push(`    ${n.id}["${n.label}"]`);
  }
  for (let i = 0; i < outCount; i++) {
    lines.push(`    out${i}((${outCount > 1 ? `"out${i}"` : `"out"`}))`);
  }

  let litCounter = 0;
  for (const e of g.edges) {
    let fromId: string;
    if (e.from.k === "input") {
      fromId = `in_${sanitize(e.from.name)}`;
    } else if (e.from.k === "gate") {
      fromId = e.from.id;
    } else {
      fromId = `lit${litCounter++}`;
      lines.push(`    ${fromId}(("${e.from.bit}"))`);
    }

    let toId: string;
    if ("output" in e.to) {
      toId = outCount > 1 ? `out${e.to.output}` : "out0";
    } else {
      toId = e.to.id;
    }

    lines.push(`    ${fromId} --> ${toId}`);
  }

  lines.push(`  end`);
  return lines.join("\n");
}
