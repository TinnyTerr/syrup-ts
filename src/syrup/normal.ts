// Normal forms of circuit definitions: ANF, DNF and algebraic simplification.
import { BIT, indexDef, tyWidth, type Def, type Expr, type Pat, type Eqn, type Ty } from "./ast";
import {
  RuntimeError, runComponent, discoverMemPaths, type Registry,
} from "./eval";
import { allBitCombos, reshapeList, flattenValues, type Bit } from "./values";

const V = (name: string): Expr => ({ k: "var", name });
const app = (name: string, args: Expr[]): Expr => ({ k: "app", name, args });

const patVars = (p: Pat, out: string[] = []): string[] => {
  if (p.k === "var") out.push(p.name);
  else if (p.k === "cable") p.items.forEach((i) => patVars(i, out));
  return out;
};

function needDef(reg: Registry, name: string): Def {
  const c = reg.get(name);
  if (!c) throw new RuntimeError(`You tried to use ${name} but it is not in scope.`);
  if (c.isPrimitive) throw new RuntimeError(`Circuit \`${name}\` is a primitive: it has no definition to transform.`);
  if (!c.def) throw new RuntimeError(`Circuit \`${name}\` is a stub (has no definition).`);
  return c.def;
}

function mkDef(base: Def, rhs: Expr[], eqns: Eqn[]): Def {
  const d: Def = { k: "def", name: base.name, params: base.params, rhs, eqns };
  indexDef(d);
  return d;
}

// ---------------------------------------------------------------------------
// ANF: arguments and outputs are variables; each variable is used once
// (fan-out is an explicit `[X, X]` copy equation)
// ---------------------------------------------------------------------------

export function anf(reg: Registry, name: string): Def {
  const def = needDef(reg, name);
  let counter = 0;
  const fresh = (): string => `__VIRTUAL__${counter++}`;
  const outCount = (e: Expr): number => (e.k === "app" ? reg.get(e.name)?.outs.length ?? 1 : 1);
  const lifted: Eqn[] = [];

  // an expression whose arguments are all variables / cables of them
  const flatten = (e: Expr): Expr => {
    if (e.k !== "app") return e.k === "cable" ? { k: "cable", items: e.items.map(argOf).flat() } : e;
    return app(e.name, e.args.flatMap(argOf));
  };
  // turn an argument into variables (lifting anything compound into an equation)
  const argOf = (e: Expr): Expr[] => {
    if (e.k === "var") return [e];
    if (e.k === "cable") return [{ k: "cable", items: e.items.flatMap(argOf) }];
    if (e.k === "lit" || e.k === "hole") {
      const v = fresh();
      lifted.push({ lhs: [{ k: "var", name: v }], rhs: [e] });
      return [V(v)];
    }
    const vs = Array.from({ length: outCount(e) }, fresh);
    lifted.push({ lhs: vs.map((n) => ({ k: "var", name: n }) as Pat), rhs: [flatten(e)] });
    return vs.map(V);
  };

  const eqns: Eqn[] = [];
  for (const q of def.eqns) {
    const rhs = q.rhs.map(flatten);
    eqns.push(...lifted.splice(0), { lhs: q.lhs, rhs });
  }
  const outs: Expr[] = [];
  for (const e of def.rhs) outs.push(...argOf(e));
  eqns.push(...lifted.splice(0));

  // fan-out: variables used more than once get explicit copies
  const uses = new Map<string, number>();
  const count = (e: Expr) => {
    if (e.k === "var") uses.set(e.name, (uses.get(e.name) ?? 0) + 1);
    else if (e.k === "cable") e.items.forEach(count);
    else if (e.k === "app") e.args.forEach(count);
  };
  eqns.forEach((q) => q.rhs.forEach(count));
  outs.forEach(count);

  const order: string[] = [];
  def.params.forEach((p) => order.push(...patVars(p)));
  eqns.forEach((q) => q.lhs.forEach((p) => order.push(...patVars(p))));

  const supply = new Map<string, string[]>();
  const copies: Eqn[] = [];
  for (const v of order) {
    const n = uses.get(v) ?? 0;
    if (n < 2 || supply.has(v)) continue;
    const names = Array.from({ length: n }, fresh);
    supply.set(v, names);
    copies.push({
      lhs: names.map((x) => ({ k: "var", name: x }) as Pat),
      rhs: [{ k: "cable", items: names.map(() => V(v)) }],
    });
  }
  const taken = new Map<string, number>();
  const rename = (e: Expr): Expr => {
    if (e.k === "var" && supply.has(e.name)) {
      const i = taken.get(e.name) ?? 0;
      taken.set(e.name, i + 1);
      return V(supply.get(e.name)![i]!);
    }
    if (e.k === "cable") return { k: "cable", items: e.items.map(rename) };
    if (e.k === "app") return app(e.name, e.args.map(rename));
    return e;
  };
  const finalEqns = eqns.map((q) => ({ lhs: q.lhs, rhs: q.rhs.map(rename) }));
  const finalOuts = outs.map(rename);
  return mkDef(def, finalOuts, [...copies, ...finalEqns]);
}

// ---------------------------------------------------------------------------
// DNF
// ---------------------------------------------------------------------------

type Lit = -1 | 0 | 1; // -1: don't care

function combine(a: Lit[], b: Lit[]): Lit[] | undefined {
  let diff = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] === -1 || b[i] === -1 || diff !== -1) return undefined;
    diff = i;
  }
  if (diff === -1) return undefined;
  const r = a.slice();
  r[diff] = -1;
  return r;
}

const key = (t: Lit[]) => t.join(",");
const covers = (t: Lit[], m: number, n: number) => t.every((l, i) => l === -1 || l === ((m >> (n - 1 - i)) & 1));

/** Prime implicants, then essential ones plus a greedy cover; sorted descending. */
export function dnfTerms(minterms: number[], n: number): Lit[][] {
  if (minterms.length === 0) return [];
  let cur = new Map<string, Lit[]>();
  for (const m of minterms) {
    const t = Array.from({ length: n }, (_, i) => ((m >> (n - 1 - i)) & 1) as Lit);
    cur.set(key(t), t);
  }
  const primes: Lit[][] = [];
  while (cur.size) {
    const next = new Map<string, Lit[]>();
    const used = new Set<string>();
    const ts = [...cur.values()];
    for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++) {
        const c = combine(ts[i]!, ts[j]!);
        if (c) {
          next.set(key(c), c);
          used.add(key(ts[i]!));
          used.add(key(ts[j]!));
        }
      }
    for (const t of ts) if (!used.has(key(t))) primes.push(t);
    cur = next;
  }
  // choose a cover
  const chosen = new Set<Lit[]>();
  let left = new Set(minterms);
  const take = (t: Lit[]) => {
    chosen.add(t);
    left = new Set([...left].filter((m) => !covers(t, m, n)));
  };
  for (const m of minterms) {
    const cs = primes.filter((p) => covers(p, m, n));
    if (cs.length === 1 && !chosen.has(cs[0]!)) take(cs[0]!);
  }
  while (left.size) {
    let best: Lit[] | undefined;
    let bestN = -1;
    for (const p of primes) {
      if (chosen.has(p)) continue;
      const k = [...left].filter((m) => covers(p, m, n)).length;
      if (k > bestN) {
        best = p;
        bestN = k;
      }
    }
    take(best!);
  }
  const rank = (l: Lit) => l + 1;
  return [...chosen].sort((a, b) => {
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return rank(b[i]!) - rank(a[i]!);
    return 0;
  });
}

/** Expression for a DNF over named input bits. */
export function dnfExpr(terms: Lit[][], names: string[]): Expr {
  if (terms.length === 0) return { k: "lit", bit: 0 };
  const termExpr = (t: Lit[]): Expr => {
    const lits: Expr[] = [];
    t.forEach((l, i) => {
      if (l === 1) lits.push(V(names[i]!));
      else if (l === 0) lits.push(app("not", [V(names[i]!)]));
    });
    if (lits.length === 0) return { k: "lit", bit: 1 };
    return lits.reduceRight((acc, x) => app("and", [x, acc]));
  };
  if (terms.some((t) => t.every((l) => l === -1))) return { k: "lit", bit: 1 };
  return terms.map(termExpr).reduceRight((acc, x) => app("or", [x, acc]));
}

function build(t: Ty, bits: Expr[]): { e: Expr; rest: Expr[] } {
  if (t.k === "bit") return { e: bits[0]!, rest: bits.slice(1) };
  let rest = bits;
  const items: Expr[] = [];
  for (const it of t.items) {
    const r = build(it, rest);
    items.push(r.e);
    rest = r.rest;
  }
  return { e: { k: "cable", items }, rest };
}

/** Input bit names, in order, from the parameter patterns. */
function paramNames(def: Def): string[] {
  const out: string[] = [];
  const walk = (p: Pat) => {
    if (p.k === "var") out.push(p.name);
    else if (p.k === "wild") out.push("_");
    else p.items.forEach(walk);
  };
  def.params.forEach(walk);
  return out;
}

export function dnf(reg: Registry, name: string): Def {
  const c = reg.get(name);
  const def = needDef(reg, name);
  if (discoverMemPaths(reg, name).length > 0) {
    throw new RuntimeError(`Circuit \`${name}\` has memory, so it has no disjunctive normal form.`);
  }
  const width = c!.ins.reduce((n, t) => n + tyWidth(t), 0);
  const outWidth = c!.outs.reduce((n, t) => n + tyWidth(t), 0);
  const minterms: number[][] = Array.from({ length: outWidth }, () => []);
  let row = 0;
  for (const flat of allBitCombos(width)) {
    const { outputs } = runComponent(reg, name, reshapeList(flat, c!.ins), new Map());
    flattenValues(outputs).forEach((b: Bit, i) => {
      if (b === "X") throw new RuntimeError(`Circuit \`${name}\` has an undetermined output, so it has no disjunctive normal form.`);
      if (b === 1) minterms[i]!.push(row);
    });
    row++;
  }
  const names = paramNames(def);
  let bits = minterms.map((ms) => dnfExpr(dnfTerms(ms, width), names));
  const rhs: Expr[] = [];
  for (const t of c!.outs) {
    const r = build(t, bits);
    rhs.push(r.e);
    bits = r.rest;
  }
  return mkDef(def, rhs, []);
}

// ---------------------------------------------------------------------------
// Simplify
// ---------------------------------------------------------------------------

const same = (a: Expr, b: Expr): boolean => JSON.stringify(a) === JSON.stringify(b);
type App = Extract<Expr, { k: "app" }>;
const isApp = (e: Expr, n: string, k: number): boolean => e.k === "app" && e.name === n && e.args.length === k;
const argsOf = (e: Expr): Expr[] => (e as App).args;

const mkNot = (a: Expr): Expr => (isApp(a, "not", 1) ? argsOf(a)[0]! : app("not", [a]));
const mkNand = (a: Expr, b: Expr): Expr => (same(a, b) ? mkNot(a) : app("nand", [a, b]));

// Fold the nand-level form back into the operators the user knows, except
// the one being simplified (which would be circular).
function fold(e: Expr, self: string): Expr {
  if (e.k === "cable") return { k: "cable", items: e.items.map((i) => fold(i, self)) };
  if (e.k !== "app") return e;
  const args = e.args.map((a) => fold(a, self));
  if (isApp(e, "not", 1)) {
    const inner = argsOf(e)[0]!;
    if (isApp(inner, "nand", 2) && self !== "and") return app("and", argsOf(inner).map((a) => fold(a, self)));
    if (self === "not") return app("nand", [args[0]!, args[0]!]);
    return app("not", args);
  }
  const [l, r] = argsOf(e);
  if (isApp(e, "nand", 2) && isApp(l!, "not", 1) && isApp(r!, "not", 1) && self !== "or") {
    return app("or", [fold(argsOf(l!)[0]!, self), fold(argsOf(r!)[0]!, self)]);
  }
  return app(e.name, args);
}

export function simplify(reg: Registry, name: string): Def {
  const def = needDef(reg, name);

  // single-variable, single-expression equations are candidate wires
  const bodies = new Map<string, Expr>();
  for (const q of def.eqns) {
    if (q.lhs.length === 1 && q.lhs[0]!.k === "var" && q.rhs.length === 1) bodies.set((q.lhs[0] as { name: string }).name, q.rhs[0]!);
  }
  const pure = (e: Expr): boolean =>
    e.k === "var" || e.k === "lit"
    || (e.k === "cable" && e.items.every(pure))
    || (e.k === "app" && ["not", "and", "or", "nand"].includes(e.name) && e.args.every(pure));
  const varsOf = (e: Expr, out: string[] = []): string[] => {
    if (e.k === "var") out.push(e.name);
    else if (e.k === "cable") e.items.forEach((i) => varsOf(i, out));
    else if (e.k === "app") e.args.forEach((i) => varsOf(i, out));
    return out;
  };
  const candidates = new Set([...bodies].filter(([, b]) => pure(b)).map(([n]) => n));
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    for (const v of varsOf(bodies.get(from)!)) {
      if (!candidates.has(v)) continue;
      if (v === target) return true;
      if (!seen.has(v)) {
        seen.add(v);
        if (reaches(v, target, seen)) return true;
      }
    }
    return false;
  };
  const subst = new Set([...candidates].filter((w) => !reaches(w, w)));

  const memo = new Map<string, Expr>();
  const norm = (e: Expr): Expr => {
    switch (e.k) {
      case "var": {
        if (!subst.has(e.name)) return e;
        let r = memo.get(e.name);
        if (!r) memo.set(e.name, (r = norm(bodies.get(e.name)!)));
        return r;
      }
      case "cable": return { k: "cable", items: e.items.map(norm) };
      case "app": {
        const a = e.args.map(norm);
        if (isApp(e, "not", 1)) return mkNot(a[0]!);
        if (isApp(e, "and", 2)) return mkNot(mkNand(a[0]!, a[1]!));
        if (isApp(e, "or", 2)) return mkNand(mkNot(a[0]!), mkNot(a[1]!));
        if (isApp(e, "nand", 2)) return mkNand(a[0]!, a[1]!);
        return app(e.name, a);
      }
      default: return e;
    }
  };

  const eqnOf = new Map<string, Eqn>();
  for (const q of def.eqns) {
    const isWire = q.lhs.length === 1 && q.lhs[0]!.k === "var" && subst.has((q.lhs[0] as { name: string }).name);
    if (!isWire) q.lhs.forEach((p) => patVars(p).forEach((v) => eqnOf.set(v, q)));
    else eqnOf.set((q.lhs[0] as { name: string }).name, q);
  }

  const kept: Eqn[] = [];
  const done = new Set<Eqn>();
  const reference = (e: Expr): void => {
    for (const v of varsOf(e)) {
      const q = eqnOf.get(v);
      if (!q || done.has(q)) continue;
      done.add(q);
      const wire = q.lhs.length === 1 && q.lhs[0]!.k === "var" && subst.has((q.lhs[0] as { name: string }).name);
      const rhs = q.rhs.map((r) => fold(norm(r), name));
      kept.push({ lhs: q.lhs, rhs });
      rhs.forEach(reference);
      void wire;
    }
  };
  const outs = def.rhs.map((e) => {
    if (e.k === "var") {
      reference(e);
      return e;
    }
    const n = fold(norm(e), name);
    reference(n);
    return n;
  });
  kept.sort((a, b) => {
    const x = patVars(a.lhs[0]!)[0] ?? "";
    const y = patVars(b.lhs[0]!)[0] ?? "";
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return mkDef(def, outs, kept);
}

export { BIT };
