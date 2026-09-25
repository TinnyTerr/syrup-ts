// AST types for Syrup, plus the static call-site indexing pass used to give
// every primitive instantiation (dff/srff) a stable, path-addressable identity
// across simulation steps without needing a separate netlist compile.

export type Ty = { k: "bit" } | { k: "cable"; items: Ty[] };

export const BIT: Ty = { k: "bit" };
export const cable = (items: Ty[]): Ty => ({ k: "cable", items });

export function tyWidth(t: Ty): number {
  return t.k === "bit" ? 1 : t.items.reduce((n, i) => n + tyWidth(i), 0);
}

export function tyToString(t: Ty): string {
  return t.k === "bit" ? "<Bit>" : `[${t.items.map(tyToString).join(",")}]`;
}

export type Pat =
  | { k: "var"; name: string }
  | { k: "wild" }
  | { k: "cable"; items: Pat[] };

export type Expr =
  | { k: "var"; name: string }
  | { k: "lit"; bit: 0 | 1 }
  | { k: "cable"; items: Expr[] }
  | { k: "app"; name: string; args: Expr[]; idx?: number };

export type Eqn = { lhs: Pat[]; rhs: Expr[] };

export interface Decl {
  k: "decl";
  name: string;
  ins: Ty[];
  outs: Ty[];
}

export interface Def {
  k: "def";
  name: string;
  params: Pat[];
  rhs: Expr[];
  eqns: Eqn[];
  numApps?: number; // populated by indexDef()
  varOwner?: Map<string, number>; // var name -> index into eqns; populated by registerDef()
}

export interface ExpTruth {
  k: "expTruth";
  name: string;
}

export interface ExpEquiv {
  k: "expEquiv";
  a: string;
  b: string;
}

// A value literal, as used in `experiment name(steps)`.
export type ValueLit = number | ValueLit[];

export interface ExpSim {
  k: "expSim";
  name: string;
  steps: ValueLit[][];
}

export interface Skip {
  k: "skip";
  reason: string;
}

export type Stmt = Decl | Def | ExpTruth | ExpEquiv | ExpSim | Skip;

// Assigns a per-definition-local index to every `app` node, in a fixed
// deterministic (pre-order) traversal. This index, combined with the
// caller's runtime path, gives every instantiation of a component
// (in particular every dff/srff) a globally unique, run-stable identity.
export function indexDef(def: Def): void {
  let counter = 0;
  const visitExpr = (e: Expr) => {
    if (e.k === "cable") e.items.forEach(visitExpr);
    else if (e.k === "app") {
      e.idx = counter++;
      e.args.forEach(visitExpr);
    }
  };
  def.rhs.forEach(visitExpr);
  for (const eqn of def.eqns) eqn.rhs.forEach(visitExpr);
  def.numApps = counter;
}
