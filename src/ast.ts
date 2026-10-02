// AST types for Syrup, plus the static call-site indexing pass used to give
// every primitive instantiation (dff/srff) a stable, path-addressable identity
// across simulation steps without needing a separate netlist compile.

// `mem` records an `@` annotation (printing only). `alias` remembers the `type <Name> = ...` a type was spelled with, purely
// for printing (and for picking a graphical display such as <7Segments>).
export type Ty = ({ k: "bit" } | { k: "cable"; items: Ty[] }) & { alias?: string; mem?: boolean };

export const BIT: Ty = { k: "bit" };
export const cable = (items: Ty[]): Ty => ({ k: "cable", items });

export function tyWidth(t: Ty): number {
  return t.k === "bit" ? 1 : t.items.reduce((n, i) => n + tyWidth(i), 0);
}

export function tyToString(t: Ty, sep = ","): string {
  if (t.alias) return `<${t.alias}>`;
  return t.k === "bit" ? "<Bit>" : `[${t.items.map((i) => tyToString(i, sep)).join(sep)}]`;
}

/** Structural equality, ignoring aliases. */
export function tyEq(a: Ty, b: Ty): boolean {
  if (a.k === "bit" || b.k === "bit") return a.k === b.k;
  return a.items.length === b.items.length && a.items.every((x, i) => tyEq(x, b.items[i]!));
}

export type Pat =
  | { k: "var"; name: string }
  | { k: "wild" }
  | { k: "cable"; items: Pat[] };

export type Expr =
  | { k: "var"; name: string }
  | { k: "lit"; bit: 0 | 1 }
  | { k: "cable"; items: Expr[] }
  | { k: "app"; name: string; args: Expr[]; idx?: number }
  | { k: "hole"; name?: string };

export type Eqn = { lhs: Pat[]; rhs: Expr[] };

export interface Decl {
  k: "decl";
  name: string;
  ins: Ty[];
  outs: Ty[];
  src?: string;
}

export interface Def {
  k: "def";
  name: string;
  params: Pat[];
  rhs: Expr[];
  eqns: Eqn[];
  src?: string; // the statement as written (for error context)
  emptyWhere?: boolean; // `where` with no indented block after it
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

// A value literal, as used in `experiment f(...)`.
export type ValueLit = number | ValueLit[];

// `experiment f{mem}(steps)`: a time-sequence simulation.
export interface ExpSim {
  k: "expSim";
  name: string;
  mem?: number[];
  steps: ValueLit[][];
}

// `experiment f{mem}(inputs) = {mem'}outputs`: a unit test.
export interface ExpUnit {
  k: "expUnit";
  name: string;
  mem?: number[];
  inputs: ValueLit[];
  expMem?: number[];
  outputs: ValueLit[];
  /** the test as written, e.g. `nand{0}(00) = 1`, for titles */
  text: string;
}

// `experiment forall X, Y -> lhs = rhs`: exhaustive property test.
export interface ExpForall {
  k: "expForall";
  vars: string[];
  lhs: Expr;
  rhs: Expr;
}

export interface Skip {
  k: "skip";
  reason: string;
}

export interface Display {
  k: "display";
  name: string;
  unfold: string[];
}

export interface CostStmt {
  k: "cost";
  name: string;
  unfold: string[];
}

export interface NameStmt {
  k: "typing" | "print" | "anf" | "dnf" | "simplify";
  name: string;
}

export interface DefinitionStmt {
  k: "definition";
  name: string;
  vars: string[];
  outs: string[];
}

export interface TypeDef {
  k: "typeDef";
  name: string;
  ty: Ty;
}

export type Stmt =
  | Decl | Def | ExpTruth | ExpEquiv | ExpSim | ExpUnit | ExpForall
  | Display | CostStmt | NameStmt | DefinitionStmt | Skip | TypeDef;

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
