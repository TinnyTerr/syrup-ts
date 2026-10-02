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
  prelude?: boolean; // defined by the built-in prelude: users may redefine it silently
  def?: Def; // absent => stub / primitive
  isPrimitive?: boolean;
  hasMemory?: boolean; // filled in lazily by analyseMemory
  memPaths?: string[]; // filled in lazily by discoverMemPaths
  layout?: MemLayout; // filled in lazily by memLayout
  prev?: Component; // the circuit this one replaced (a redefinition's own calls to its name mean that)
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

// Circuit references are fixed when the definition is registered, so
// redefining a name later (say, `dff`) does not change older circuits that
// were built on the previous meaning.
const bound = new WeakMap<object, Component>();

function bindCalls(reg: Registry, def: Def, self: Component): void {
  const walk = (e: Expr): void => {
    if (e.k === "cable") e.items.forEach(walk);
    else if (e.k === "app") {
      const c = e.name === def.name ? self.prev ?? self : reg.get(e.name);
      if (c) bound.set(e, c);
      e.args.forEach(walk);
    }
  };
  def.rhs.forEach(walk);
  def.eqns.forEach((q) => q.rhs.forEach(walk));
}

const calleeOf = (reg: Registry, e: { name: string }): Component | undefined => bound.get(e) ?? reg.get(e.name);

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
  bindCalls(reg, def, c);
}

// ---------------------------------------------------------------------------
// Pattern binding
// ---------------------------------------------------------------------------

function bindPat(p: Pat, v: Value, env: Map<string, Value>): void {
  if (p.k === "wild") return;
  if (p.k === "var") { env.set(p.name, v); return; }
  if (v === "X") {
    // an unknown bundle: every part of it is unknown
    p.items.forEach((i) => bindPat(i, "X", env));
    return;
  }
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
  // register inputs still to be evaluated: a register's output does not depend
  // on its input this step, so its input may mention wires that are mid-evaluation
  pending: Array<() => void>;
}

function flushPending(frame: Frame): void {
  while (frame.pending.length) frame.pending.shift()!();
}

interface Ctx {
  reg: Registry;
  mem: Map<string, Bit>;
  nextMem: Map<string, Bit>;
  // A loop that runs through a register is legitimate even when it passes
  // through a call (the register's output does not depend on its input).
  // When evaluation closes such a loop it takes a provisional value for the
  // wire; the run is repeated with what the wire really came to until the two
  // agree.
  prov: Map<string, Value>;
  used: Map<string, Value>;
  final: Map<string, Value>;
}

function evalVar(frame: Frame, name: string, path: string, ctx: Ctx): Value {
  const existing = frame.env.get(name);
  if (existing !== undefined) return existing;
  const eqnIdx = frame.def.varOwner!.get(name);
  if (eqnIdx === undefined) {
    throw new RuntimeError(`unbound variable \`${name}\``);
  }
  const eqn = frame.def.eqns[eqnIdx]!;
  if (frame.computing.has(name)) {
    const key = `${path}:${name}`;
    const pv = ctx.prov.get(key) ?? "X";
    ctx.used.set(key, pv);
    return pv;
  }

  // A register (dff/srff) that is the whole right side of a `where`
  // equation can be fed back into its own input, e.g. `Q = dff(xor(Q,T))`.
  // Its output for this step is just last step's state, independent of the
  // argument expression, so bind it before evaluating the argument at
  // all -- otherwise evaluating the argument (which mentions `Q`) would
  // look like an ordinary combinational cycle.
  const rhsExpr = eqn.rhs.length === 1 ? eqn.rhs[0]! : undefined;
  const rhsCallee = rhsExpr?.k === "app" ? calleeOf(ctx.reg, rhsExpr) : undefined;
  if (rhsExpr?.k === "app" && rhsCallee?.isPrimitive && (rhsCallee.name === "dff" || rhsCallee.name === "srff")) {
    const childPath = `${path}.${rhsExpr.idx}`;
    bindPatList(eqn.lhs, [peekMem(childPath, ctx)], frame.env);
    frame.pending.push(() => {
      const args = evalExprList(rhsExpr.args, frame, path, ctx);
      commitPrimitive(rhsCallee.name, args, childPath, ctx);
    });
    return frame.env.get(name)!;
  }

  frame.computing.add(name);
  const vals = evalExprList(eqn.rhs, frame, path, ctx);
  bindPatList(eqn.lhs, vals, frame.env);
  frame.computing.delete(name);
  const v = frame.env.get(name);
  if (v === undefined) throw new RuntimeError(`\`${name}\` was not bound by its own equation`);
  ctx.final.set(`${path}:${name}`, v);
  return v;
}

function evalExprSlots(e: Expr, frame: Frame, path: string, ctx: Ctx): Value[] {
  switch (e.k) {
    case "var": return [evalVar(frame, e.name, path, ctx)];
    case "lit": return [e.bit];
    case "cable": return [evalExprList(e.items, frame, path, ctx)];
    case "app": return evalApp(e, frame, path, ctx);
    case "hole": throw new RuntimeError(`hole ?${e.name ?? ""} has no value`);
  }
}

function evalExprList(exprs: Expr[], frame: Frame, path: string, ctx: Ctx): Value[] {
  const out: Value[] = [];
  for (const e of exprs) out.push(...evalExprSlots(e, frame, path, ctx));
  return out;
}

function evalApp(e: Extract<Expr, { k: "app" }>, frame: Frame, path: string, ctx: Ctx): Value[] {
  const args = evalExprList(e.args, frame, path, ctx);
  const callee = calleeOf(ctx.reg, e);
  if (!callee) throw new RuntimeError(`\`${e.name}\` is not declared`);
  const childPath = `${path}.${e.idx}`;

  if (callee.isPrimitive) return evalPrimitive(callee.name, args, childPath, ctx);

  if (!callee.def) {
    throw new RuntimeError(`Circuit \`${e.name}\` is a stub (has no definition).`);
  }
  const childFrame: Frame = { env: new Map(), computing: new Set(), def: callee.def, pending: [] };
  bindPatList(callee.def.params, args, childFrame.env);
  const outs = evalExprList(callee.def.rhs, childFrame, childPath, ctx);
  flushPending(childFrame);
  return outs;
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
  if (!c.isPrimitive && !c.def) throw new RuntimeError(`Circuit \`${name}\` is a stub (has no definition).`);
  let prov = new Map<string, Value>();
  for (let round = 0; round < 8; round++) {
    const nextMem = new Map<string, Bit>();
    const ctx: Ctx = { reg, mem, nextMem, prov, used: new Map(), final: new Map() };
    let outputs: Value[];
    if (c.isPrimitive) {
      outputs = evalPrimitive(name, inputs, ".", ctx);
    } else {
      const frame: Frame = { env: new Map(), computing: new Set(), def: c.def!, pending: [] };
      bindPatList(c.def!.params, inputs, frame.env);
      outputs = evalExprList(c.def!.rhs, frame, "", ctx);
      flushPending(frame);
    }
    if (ctx.used.size === 0) return { outputs, nextMem };
    let settled = true;
    for (const [key, pv] of ctx.used) {
      if (JSON.stringify(ctx.final.get(key)) !== JSON.stringify(pv)) settled = false;
    }
    if (settled) return { outputs, nextMem };
    prov = new Map(ctx.final);
  }
  throw new RuntimeError("combinational cycle");
}

export interface MemLayout {
  /** register paths in display order (the first is the most significant bit of a state) */
  paths: string[];
  /** a name per register ("" when it has none) */
  names: string[];
}

// Registers in source order: a definition's `where` equations first, then its
// outputs, descending into the circuits it calls. A register is named after
// the wire of a top-level `V = ...` equation when that equation holds exactly
// one register; otherwise it is anonymous.
function collectRegs(reg: Registry, def: Def, path: string, out: string[]): void {
  const expr = (e: Expr): void => {
    if (e.k === "cable") e.items.forEach(expr);
    else if (e.k === "app") {
      const cp = `${path}.${e.idx}`;
      const callee = calleeOf(reg, e);
      if (callee?.isPrimitive) {
        if (callee.name === "dff" || callee.name === "srff") out.push(cp);
      } else if (callee?.def) collectRegs(reg, callee.def, cp, out);
      e.args.forEach(expr);
    }
  };
  for (const q of def.eqns) q.rhs.forEach(expr);
  def.rhs.forEach(expr);
}

export function memLayout(reg: Registry, name: string): MemLayout {
  const c = reg.get(name)!;
  if (c.layout) return c.layout;
  const zeroInputs = c.ins.map((t) => reshape(new Array(tyWidth(t)).fill(0), t).value);
  let live: Set<string>;
  try {
    live = new Set(runComponent(reg, name, zeroInputs, new Map()).nextMem.keys());
  } catch (e) {
    // a circuit built on a stub has no usable memory
    if (e instanceof RuntimeError && /is a stub/.test(e.message)) return { paths: [], names: [] };
    throw e;
  }
  const paths: string[] = [];
  const names: string[] = [];
  if (c.isPrimitive) {
    for (const p of live) {
      paths.push(p);
      names.push("Q");
    }
  } else if (c.def) {
    const def = c.def;
    for (const q of def.eqns) {
      const regs: string[] = [];
      const sub: Def = { ...def, eqns: [q], rhs: [] };
      collectRegs(reg, sub, "", regs);
      const one = q.lhs.length === 1 && q.lhs[0]!.k === "var" && regs.length === 1;
      for (const r of regs) {
        paths.push(r);
        names.push(one ? (q.lhs[0] as { name: string }).name : "");
      }
    }
    const top: string[] = [];
    collectRegs(reg, { ...def, eqns: [] }, "", top);
    for (const r of top) {
      paths.push(r);
      names.push("");
    }
    // keep only registers evaluation actually reaches
    for (let i = paths.length - 1; i >= 0; i--) {
      if (!live.has(paths[i]!)) {
        paths.splice(i, 1);
        names.splice(i, 1);
      }
    }
    for (const p of live) {
      if (!paths.includes(p)) {
        paths.push(p);
        names.push("");
      }
    }
  }
  c.layout = { paths, names };
  c.memPaths = paths;
  c.hasMemory = paths.length > 0;
  return c.layout;
}

export function discoverMemPaths(reg: Registry, name: string): string[] {
  return memLayout(reg, name).paths;
}

export type { Bit, Value };
export { formatValue, formatValues, flattenValue, flattenValues, allBitCombos, reshape, reshapeList, widthOfTys };
