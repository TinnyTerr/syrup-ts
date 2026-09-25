import { type Ty, type Pat, type Expr, type Eqn, type Def, type Decl, tyWidth, BIT } from "./ast";
import {
  type Bit, type Value, reshape, reshapeList, flattenValue, flattenValues,
  allBitCombos, formatValue, formatValues, widthOfTys,
} from "./values";

export class RuntimeError extends Error {}

export interface Component {
  name: string;
  ins: Ty[];
  outs: Ty[];
  def?: Def; // absent => stub / primitive
  isPrimitive?: boolean;
  hasMemory?: boolean; // filled in lazily by analyseMemory
  memPaths?: string[]; // filled in lazily by discoverMemPaths
}

export type Registry = Map<string, Component>;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function newRegistry(): Registry {
  const reg: Registry = new Map();
  reg.set("nand", { name: "nand", ins: [BIT, BIT], outs: [BIT], isPrimitive: true, hasMemory: false });
  reg.set("zero", { name: "zero", ins: [], outs: [BIT], isPrimitive: true, hasMemory: false });
  reg.set("dff", { name: "dff", ins: [BIT], outs: [BIT], isPrimitive: true, hasMemory: true });
  reg.set("srff", { name: "srff", ins: [BIT, BIT], outs: [BIT], isPrimitive: true, hasMemory: true });
  return reg;
}

function buildVarOwner(def: Def): Map<string, number> {
  const owner = new Map<string, number>();
  const walk = (p: Pat, idx: number) => {
    if (p.k === "var") owner.set(p.name, idx);
    else if (p.k === "cable") p.items.forEach((i) => walk(i, idx));
  };
  def.eqns.forEach((eqn, idx) => eqn.lhs.forEach((p) => walk(p, idx)));
  return owner;
}

export function registerDecl(reg: Registry, decl: Decl): void {
  if (reg.has(decl.name)) {
    throw new RuntimeError(`Circuit \`${decl.name}\` is already declared.`);
  }
  reg.set(decl.name, { name: decl.name, ins: decl.ins, outs: decl.outs });
}

export function registerDef(reg: Registry, def: Def): void {
  const c = reg.get(def.name);
  if (!c) throw new RuntimeError(`You haven't declared the circuit \`${def.name}\`.`);
  if (c.def) throw new RuntimeError(`Circuit \`${def.name}\` is already defined.`);
  if (def.params.length !== c.ins.length) {
    throw new RuntimeError(
      `Circuit \`${def.name}\` expects ${c.ins.length} argument(s) but its definition names ${def.params.length}.`
    );
  }
  c.def = def;
  def.varOwner = buildVarOwner(def);
}

// ---------------------------------------------------------------------------
// Pattern binding
// ---------------------------------------------------------------------------

function bindPat(p: Pat, v: Value, env: Map<string, Value>): void {
  if (p.k === "wild") return;
  if (p.k === "var") { env.set(p.name, v); return; }
  if (!Array.isArray(v)) {
    throw new RuntimeError(`expected a cable but got a single bit while matching a pattern`);
  }
  if (v.length !== p.items.length) {
    throw new RuntimeError(`cable pattern of width ${p.items.length} does not match a value of width ${v.length}`);
  }
  p.items.forEach((item, i) => bindPat(item, v[i]!, env));
}

function bindPatList(pats: Pat[], vals: Value[], env: Map<string, Value>): void {
  if (pats.length !== vals.length) {
    throw new RuntimeError(
      `expected ${pats.length} value(s) on the right but got ${vals.length}`
    );
  }
  pats.forEach((p, i) => bindPat(p, vals[i]!, env));
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

interface Frame {
  env: Map<string, Value>;
  computing: Set<string>;
  def: Def;
}

interface Ctx {
  reg: Registry;
  mem: Map<string, Bit>;
  nextMem: Map<string, Bit>;
}

function evalVar(frame: Frame, name: string, path: string, ctx: Ctx): Value {
  const existing = frame.env.get(name);
  if (existing !== undefined) return existing;
  const eqnIdx = frame.def.varOwner!.get(name);
  if (eqnIdx === undefined) {
    throw new RuntimeError(`unbound variable \`${name}\``);
  }
  if (frame.computing.has(name)) {
    throw new RuntimeError(`combinational cycle involving \`${name}\``);
  }
  const eqn = frame.def.eqns[eqnIdx]!;

  // A register (dff/srff) that is the whole right side of a `where`
  // equation can be fed back into its own input, e.g. `Q = dff(xor(Q,T))`.
  // Its output for this step is just last step's state, independent of the
  // argument expression, so bind it before evaluating the argument at
  // all -- otherwise evaluating the argument (which mentions `Q`) would
  // look like an ordinary combinational cycle.
  const rhsExpr = eqn.rhs.length === 1 ? eqn.rhs[0]! : undefined;
  if (rhsExpr?.k === "app" && (rhsExpr.name === "dff" || rhsExpr.name === "srff")) {
    const childPath = `${path}.${rhsExpr.idx}`;
    bindPatList(eqn.lhs, [peekMem(childPath, ctx)], frame.env);
    frame.computing.add(name);
    const args = evalExprList(rhsExpr.args, frame, path, ctx);
    commitPrimitive(rhsExpr.name, args, childPath, ctx);
    frame.computing.delete(name);
    return frame.env.get(name)!;
  }

  frame.computing.add(name);
  const vals = evalExprList(eqn.rhs, frame, path, ctx);
  bindPatList(eqn.lhs, vals, frame.env);
  frame.computing.delete(name);
  const v = frame.env.get(name);
  if (v === undefined) throw new RuntimeError(`\`${name}\` was not bound by its own equation`);
  return v;
}

function evalExprSlots(e: Expr, frame: Frame, path: string, ctx: Ctx): Value[] {
  switch (e.k) {
    case "var": return [evalVar(frame, e.name, path, ctx)];
    case "lit": return [e.bit];
    case "cable": return [evalExprList(e.items, frame, path, ctx)];
    case "app": return evalApp(e, frame, path, ctx);
  }
}

function evalExprList(exprs: Expr[], frame: Frame, path: string, ctx: Ctx): Value[] {
  const out: Value[] = [];
  for (const e of exprs) out.push(...evalExprSlots(e, frame, path, ctx));
  return out;
}

function evalApp(e: Extract<Expr, { k: "app" }>, frame: Frame, path: string, ctx: Ctx): Value[] {
  const args = evalExprList(e.args, frame, path, ctx);
  const callee = ctx.reg.get(e.name);
  if (!callee) throw new RuntimeError(`\`${e.name}\` is not declared`);
  const childPath = `${path}.${e.idx}`;

  if (callee.isPrimitive) return evalPrimitive(e.name, args, childPath, ctx);

  if (!callee.def) {
    throw new RuntimeError(`Circuit \`${e.name}\` is a stub (has no definition).`);
  }
  const childFrame: Frame = { env: new Map(), computing: new Set(), def: callee.def };
  bindPatList(callee.def.params, args, childFrame.env);
  return evalExprList(callee.def.rhs, childFrame, childPath, ctx);
}

function bit01(v: Value, who: string): Bit {
  if (Array.isArray(v)) throw new RuntimeError(`${who} expects a single bit, got a cable`);
  return v;
}

function peekMem(path: string, ctx: Ctx): Bit {
  return ctx.mem.get(path) ?? 0;
}

// Computes next state for a memory primitive from its (already evaluated)
// arguments and writes it to ctx.nextMem; shared by evalPrimitive's normal
// path and evalVar's register-feedback path so the two can't drift apart.
function commitPrimitive(name: string, args: Value[], path: string, ctx: Ctx): void {
  switch (name) {
    case "dff": {
      const d = bit01(args[0]!, "dff");
      ctx.nextMem.set(path, d);
      return;
    }
    case "srff": {
      const s = bit01(args[0]!, "srff");
      const r = bit01(args[1]!, "srff");
      const q = peekMem(path, ctx);
      let next: Bit;
      if (s === "X" || r === "X") next = "X";
      else if (s === 0 && r === 0) next = q;
      else if (s === 0 && r === 1) next = 0;
      else if (s === 1 && r === 0) next = 1;
      else next = "X"; // S=R=1: conflicting request
      ctx.nextMem.set(path, next);
      return;
    }
    default:
      throw new RuntimeError(`\`${name}\` has no memory to commit`);
  }
}

function evalPrimitive(name: string, args: Value[], path: string, ctx: Ctx): Value[] {
  switch (name) {
    case "nand": {
      const a = bit01(args[0]!, "nand");
      const b = bit01(args[1]!, "nand");
      if (a === "X" || b === "X") return ["X"];
      return [a === 0 || b === 0 ? 1 : 0];
    }
    case "zero":
      return [0];
    case "dff": {
      const q = peekMem(path, ctx);
      commitPrimitive(name, args, path, ctx);
      return [q];
    }
    case "srff": {
      const q = peekMem(path, ctx);
      commitPrimitive(name, args, path, ctx);
      return [q];
    }
    default:
      throw new RuntimeError(`unknown primitive \`${name}\``);
  }
}

// Run one evaluation step of a top-level component.
export function runComponent(
  reg: Registry,
  name: string,
  inputs: Value[],
  mem: Map<string, Bit>
): { outputs: Value[]; nextMem: Map<string, Bit> } {
  const c = reg.get(name);
  if (!c) throw new RuntimeError(`\`${name}\` is not declared`);
  const nextMem = new Map<string, Bit>();
  const ctx: Ctx = { reg, mem, nextMem };
  if (c.isPrimitive) {
    const outputs = evalPrimitive(name, inputs, ".", ctx);
    return { outputs, nextMem };
  }
  if (!c.def) throw new RuntimeError(`Circuit \`${name}\` is a stub (has no definition).`);
  const frame: Frame = { env: new Map(), computing: new Set(), def: c.def };
  bindPatList(c.def.params, inputs, frame.env);
  const outputs = evalExprList(c.def.rhs, frame, "", ctx);
  return { outputs, nextMem };
}

export function discoverMemPaths(reg: Registry, name: string): string[] {
  const c = reg.get(name)!;
  if (c.memPaths) return c.memPaths;
  const zeroInputs = c.ins.map((t) => reshape(new Array(tyWidth(t)).fill(0), t).value);
  const { nextMem } = runComponent(reg, name, zeroInputs, new Map());
  c.memPaths = [...nextMem.keys()].sort();
  c.hasMemory = c.memPaths.length > 0;
  return c.memPaths;
}

export type { Bit, Value };
export { formatValue, formatValues, flattenValue, flattenValues, allBitCombos, reshape, reshapeList, widthOfTys };
