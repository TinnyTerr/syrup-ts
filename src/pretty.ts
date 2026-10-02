// Pretty printing of types, expressions and circuit definitions, as `Doc`s so
// the same printer feeds plain text and the coloured HTML output.

import type { Ty, Pat, Expr, Def, Eqn } from "./ast";
import { type Doc, seq, fn, ty, vr, sepBy } from "./doc";

export function tyDoc(t: Ty): Doc {
  const at: Doc = t.mem ? "@" : "";
  if (t.alias) return seq(at, ty(`<${t.alias}>`));
  if (t.k === "bit") return seq(at, ty("<Bit>"));
  return seq(at, "[", sepBy(t.items.map(tyDoc), ", "), "]");
}

export function tyListDoc(ts: Ty[]): Doc {
  return sepBy(ts.map(tyDoc), ", ");
}

/** `f(<Bit>, <Bit>) -> <Bit>`, with the operator spellings for not/and/or. */
export function declDoc(name: string, ins: Ty[], outs: Ty[]): Doc {
  let head: Doc;
  if (name === "not" && ins.length === 1) head = seq(fn("!"), tyDoc(ins[0]!));
  else if (name === "and" && ins.length === 2) head = seq(tyDoc(ins[0]!), " ", fn("&"), " ", tyDoc(ins[1]!));
  else if (name === "or" && ins.length === 2) head = seq(tyDoc(ins[0]!), " ", fn("|"), " ", tyDoc(ins[1]!));
  else head = seq(fn(name), "(", tyListDoc(ins), ")");
  return seq(head, " -> ", tyListDoc(outs));
}

export function patDoc(p: Pat): Doc {
  if (p.k === "var") return vr(p.name);
  if (p.k === "wild") return "_";
  return seq("[", sepBy(p.items.map(patDoc), ", "), "]");
}

export function patListDoc(ps: Pat[]): Doc {
  return sepBy(ps.map(patDoc), ", ");
}

const isApp = (e: Expr, name: string): boolean => e.k === "app" && e.name === name && e.args.length === (name === "not" ? 1 : 2);

// level: 0 = anywhere, 1 = operand of `|` (right) / `&`, 2 = operand needing parens for any infix
export function exprDoc(e: Expr, level = 0): Doc {
  switch (e.k) {
    case "var": return vr(e.name);
    case "lit": return fn(String(e.bit));
    case "hole": return `?${e.name ?? ""}`;
    case "cable": return seq("[", sepBy(e.items.map((i) => exprDoc(i)), ", "), "]");
    case "app": {
      if (isApp(e, "not")) return seq(fn("!"), exprDoc(e.args[0]!, 3));
      if (isApp(e, "and")) {
        const d = seq(exprDoc(e.args[0]!, 3), " ", fn("&"), " ", exprDoc(e.args[1]!, 1));
        return level >= 3 ? seq("(", d, ")") : d;
      }
      if (isApp(e, "or")) {
        const d = seq(exprDoc(e.args[0]!, 2), " ", fn("|"), " ", exprDoc(e.args[1]!, 0));
        return level >= 2 ? seq("(", d, ")") : d;
      }
      return seq(fn(e.name), "(", sepBy(e.args.map((a) => exprDoc(a)), ", "), ")");
    }
  }
}

export function exprListDoc(es: Expr[]): Doc {
  return sepBy(es.map((e) => exprDoc(e)), ", ");
}

function eqnDoc(q: Eqn): Doc {
  return seq(patListDoc(q.lhs), " = ", exprListDoc(q.rhs));
}

/** The definition as lines (no declaration): head, then indented `where` equations. */
export function defLines(def: Def): Doc[] {
  let head: Doc;
  if (def.name === "not" && def.params.length === 1) head = seq(fn("!"), patDoc(def.params[0]!));
  else if (def.name === "and" && def.params.length === 2) head = seq(patDoc(def.params[0]!), " ", fn("&"), " ", patDoc(def.params[1]!));
  else if (def.name === "or" && def.params.length === 2) head = seq(patDoc(def.params[0]!), " ", fn("|"), " ", patDoc(def.params[1]!));
  else head = seq(fn(def.name), "(", patListDoc(def.params), ")");
  const out: Doc[] = [seq(head, " = ", exprListDoc(def.rhs), def.eqns.length ? " where" : "")];
  for (const q of def.eqns) out.push(seq("  ", eqnDoc(q)));
  return out;
}

/** Declaration and definition, newline separated, for a code block. */
export function circuitLines(name: string, ins: Ty[], outs: Ty[], def: Def | undefined): Doc[] {
  const ls: Doc[] = [declDoc(name, ins, outs)];
  if (def) ls.push(...defLines(def));
  return ls;
}

export const nl = (ls: Doc[]): Doc => sepBy(ls, "\n");
