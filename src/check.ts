// Static checks on a definition against its declaration: scope, duplicate
// locals, dead wires, needlessly split cables and holes.

import { BIT, cable, type Decl, type Def, type Expr, type Pat, type Ty } from "./ast";
import type { Registry } from "./eval";

export interface ScopeError {
  name: string;
  suggestions: string[];
}

export interface Hole {
  name: string;
  ty: Ty;
}

export interface CheckResult {
  dups: string[];
  scope: ScopeError[];
  unused: string[];
  splits: Pat[];
  holes: Hole[];
  arity?: string;
}

function patVars(p: Pat, out: string[] = []): string[] {
  if (p.k === "var") out.push(p.name);
  else if (p.k === "cable") p.items.forEach((i) => patVars(i, out));
  return out;
}

function exprVars(e: Expr, out: string[] = []): string[] {
  if (e.k === "var") out.push(e.name);
  else if (e.k === "cable") e.items.forEach((i) => exprVars(i, out));
  else if (e.k === "app") e.args.forEach((i) => exprVars(i, out));
  return out;
}

function exprApps(e: Expr, out: string[] = []): string[] {
  if (e.k === "cable") e.items.forEach((i) => exprApps(i, out));
  else if (e.k === "app") {
    out.push(e.name);
    e.args.forEach((i) => exprApps(i, out));
  }
  return out;
}

function patToTy(p: Pat): Ty {
  return p.k === "cable" ? cable(p.items.map(patToTy)) : BIT;
}

// -- needless splits --------------------------------------------------------

// does the cable literal `e` have exactly the shape and names of `p`?
function sameShape(p: Pat, e: Expr): boolean {
  if (p.k === "var") return e.k === "var" && e.name === p.name;
  if (p.k === "wild") return false;
  return e.k === "cable" && e.items.length === p.items.length && p.items.every((q, i) => sameShape(q, e.items[i]!));
}

function allCablePats(p: Pat, out: Pat[] = []): Pat[] {
  if (p.k === "cable") {
    out.push(p);
    p.items.forEach((i) => allCablePats(i, out));
  }
  return out;
}

// occurrences of `name` in `e`: [inside a literal shaped like `p`, total]
function countUses(e: Expr, name: string, p: Pat): { ok: number; bad: number } {
  let ok = 0;
  let bad = 0;
  const walk = (x: Expr, covered: boolean) => {
    if (x.k === "var") {
      if (x.name === name) covered ? ok++ : bad++;
    } else if (x.k === "cable") {
      const rebuilds = sameShape(p, x);
      x.items.forEach((i) => walk(i, rebuilds || covered));
    } else if (x.k === "app") x.args.forEach((i) => walk(i, false));
  };
  walk(e, false);
  return { ok, bad };
}

function needlessSplits(def: Def): Pat[] {
  const pats: Pat[] = [];
  def.params.forEach((p) => allCablePats(p, pats));
  def.eqns.forEach((q) => q.lhs.forEach((p) => allCablePats(p, pats)));
  const uses: Expr[] = [...def.rhs, ...def.eqns.flatMap((q) => q.rhs)];
  const flagged: Pat[] = [];
  for (const p of pats) {
    const vars = patVars(p);
    if (vars.length === 0) continue;
    const taken = vars.every((v) => uses.every((e) => countUses(e, v, p).bad === 0));
    if (taken) flagged.push(p);
  }
  return flagged;
}

// -- holes ------------------------------------------------------------------

function inferHoles(def: Def, decl: Decl, reg: Registry): Hole[] {
  const found = new Map<string, Ty>();

  const outCount = (e: Expr): number => (e.k === "app" ? reg.get(e.name)?.outs.length ?? 1 : 1);

  const visit = (e: Expr, expected: Ty): void => {
    switch (e.k) {
      case "hole":
        if (e.name !== undefined && !found.has(e.name)) found.set(e.name, expected);
        return;
      case "cable":
        e.items.forEach((x, i) => visit(x, expected.k === "cable" ? expected.items[i] ?? BIT : BIT));
        return;
      case "app": {
        const callee = reg.get(e.name);
        if (callee && callee.ins.length === e.args.length) e.args.forEach((x, i) => visit(x, callee.ins[i]!));
        else e.args.forEach((x) => visit(x, BIT));
        return;
      }
      default:
        return;
    }
  };

  // align a list of expressions with the types of the slots they fill
  const visitList = (es: Expr[], slots: Ty[]): void => {
    let s = 0;
    for (const e of es) {
      visit(e, slots[s] ?? BIT);
      s += outCount(e);
    }
  };

  visitList(def.rhs, decl.outs);
  for (const q of def.eqns) visitList(q.rhs, q.lhs.map(patToTy));
  return [...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, ty]) => ({ name, ty }));
}

// -- main -------------------------------------------------------------------

export function checkDef(def: Def, decl: Decl, reg: Registry): CheckResult {
  const res: CheckResult = { dups: [], scope: [], unused: [], splits: [], holes: [] };

  if (def.params.length !== decl.ins.length) {
    res.arity = `Circuit \`${def.name}\` expects ${decl.ins.length} argument(s) but its definition names ${def.params.length}.`;
  }

  // duplicates and the set of names in scope
  const defined: string[] = [];
  const seen = new Set<string>();
  const note = (n: string) => {
    if (seen.has(n)) res.dups.push(n);
    else {
      seen.add(n);
      defined.push(n);
    }
  };
  def.params.forEach((p) => patVars(p).forEach(note));
  def.eqns.forEach((q) => q.lhs.forEach((p) => patVars(p).forEach(note)));

  // out-of-scope uses (variables, then circuits), each reported once
  const bad = new Set<string>();
  const report = (n: string, universe: string[]) => {
    if (bad.has(n)) return;
    bad.add(n);
    const low = n.toLowerCase();
    res.scope.push({
      name: n,
      suggestions: [...new Set(universe.filter((u) => u !== n && u.toLowerCase() === low))].sort(),
    });
  };
  const allExprs: Expr[] = [...def.rhs, ...def.eqns.flatMap((q) => q.rhs)];
  for (const e of allExprs) {
    for (const v of exprVars(e)) if (!seen.has(v)) report(v, defined);
    for (const a of exprApps(e)) if (!reg.has(a)) report(a, [...reg.keys()]);
  }

  // dead wires: reachable from the outputs through equations
  const owner = new Map<string, number>();
  def.eqns.forEach((q, i) => q.lhs.forEach((p) => patVars(p).forEach((v) => !owner.has(v) && owner.set(v, i))));
  const used = new Set<string>();
  const doneEqn = new Set<number>();
  const use = (e: Expr) => {
    for (const v of exprVars(e)) {
      used.add(v);
      const i = owner.get(v);
      if (i !== undefined && !doneEqn.has(i)) {
        doneEqn.add(i);
        def.eqns[i]!.rhs.forEach(use);
      }
    }
  };
  def.rhs.forEach(use);
  // only `where` wires are linted; unused parameters are the caller's business
  res.unused = [...owner.keys()].filter((v) => !used.has(v)).sort();

  res.splits = needlessSplits(def);
  res.holes = inferHoles(def, decl, reg);
  return res;
}
