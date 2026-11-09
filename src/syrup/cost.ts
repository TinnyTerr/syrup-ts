// `cost [stop...] name`: how many copies of each circuit `name` is built from,
// unfolding definitions except for circuits in `stop` (and primitives/stubs).
import type { Def, Expr } from "./ast";
import { RuntimeError, type Registry } from "./eval";

function appsOf(e: Expr, out: string[]): void {
  if (e.k === "lit") out.push(e.bit === 1 ? "one" : "zero");
  else if (e.k === "cable") e.items.forEach((i) => appsOf(i, out));
  else if (e.k === "app") {
    out.push(e.name);
    e.args.forEach((a) => appsOf(a, out));
  }
}

function callsOf(def: Def): string[] {
  const out: string[] = [];
  def.rhs.forEach((e) => appsOf(e, out));
  def.eqns.forEach((q) => q.rhs.forEach((e) => appsOf(e, out)));
  return out;
}

export function cost(reg: Registry, name: string, stop: Set<string>): Map<string, number> {
  const totals = new Map<string, number>();
  const walk = (n: string, mult: number, path: string[]) => {
    const c = reg.get(n);
    if (!c) throw new RuntimeError(`You tried to use ${n} but it is not in scope.`);
    if (stop.has(n) || c.isPrimitive || !c.def || path.includes(n)) {
      totals.set(n, (totals.get(n) ?? 0) + mult);
      return;
    }
    for (const callee of callsOf(c.def)) walk(callee, mult, [...path, n]);
  };
  walk(name, 1, []);
  return totals;
}
