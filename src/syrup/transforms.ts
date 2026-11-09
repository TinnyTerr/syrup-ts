// Statement handlers: typing, print, anf, dnf, simplify, cost, definition.
import type { Ctx } from "./ctx";
import {
  type Doc, type Message, seq, br, indent, codeblock, circ, lines,
} from "./doc";
import { indexDef, BIT, type NameStmt, type CostStmt, type DefinitionStmt, type Def, type Expr, type Ty } from "./ast";
import { RuntimeError, registerDef, type Component } from "./eval";
import { declDoc, defLines, nl } from "./pretty";
import { anf, dnf, dnfExpr, dnfTerms, simplify } from "./normal";
import { cost } from "./cost";

const happy = (doc: Doc): Message => ({ level: "happy", doc });

function comp(c: Ctx, name: string): Component {
  const k = c.reg.get(name);
  if (!k) throw new RuntimeError(`You tried to use ${name} but it is not in scope.`);
  return k;
}

// registers: the primitive flip-flops are `@` typed
function outsOf(k: Component): Ty[] {
  return k.isPrimitive && k.hasMemory ? k.outs.map((t) => ({ ...t, mem: true })) : k.outs;
}

const declOf = (k: Component): Doc => declDoc(k.name, k.ins, outsOf(k));

const block = (title: string, name: string, body: Doc): Message =>
  happy(seq(title, " ", circ(name), ":", br, indent(codeblock(body))));

export function runTyping(c: Ctx, s: NameStmt): Message[] {
  return [block("Typing for", s.name, declOf(comp(c, s.name)))];
}

export function runPrint(c: Ctx, s: NameStmt): Message[] {
  const k = comp(c, s.name);
  return [block("Printing", s.name, nl([declOf(k), ...(k.def ? defLines(k.def) : [])]))];
}

function transformed(title: string, c: Ctx, name: string, d: Def): Message {
  const k = comp(c, name);
  return block(title, name, nl([declOf(k), ...defLines(d)]));
}

export function runAnf(c: Ctx, s: NameStmt): Message[] {
  return [transformed("A Normal Form of", c, s.name, anf(c.reg, s.name))];
}

export function runDnf(c: Ctx, s: NameStmt): Message[] {
  return [transformed("Disjunctive Normal Form of", c, s.name, dnf(c.reg, s.name))];
}

export function runSimplify(c: Ctx, s: NameStmt): Message[] {
  return [transformed("Simplification of", c, s.name, simplify(c.reg, s.name))];
}

export function runCost(c: Ctx, s: CostStmt): Message[] {
  comp(c, s.name);
  const totals = cost(c.reg, s.name, new Set(s.unfold));
  const rows = [...totals].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [
    happy(seq(
      "Cost for ", circ(s.name), ":", br,
      indent(lines(rows.map(([n, k]) => seq(`${k} ${k === 1 ? "copy" : "copies"} of `, circ(n))))),
    )),
  ];
}

const err = (doc: Doc): Message => ({ level: "error", doc });

export function runDefinition(c: Ctx, s: DefinitionStmt): Message[] {
  const dup = s.vars.find((v, i) => s.vars.indexOf(v) !== i);
  if (dup !== undefined) return [err(seq("You are redefining the local variable ", dup, "."))];
  const n = s.vars.length;
  if (s.outs.length !== 2 ** n || s.outs.some((o) => o !== "0" && o !== "1")) {
    return [err(seq("Invalid truth table output for ", circ(s.name), "."))];
  }
  const old = c.reg.get(s.name);
  if (old && !old.prelude) return [err(seq("You are redefining the top-level variable ", s.name, "."))];

  const minterms = s.outs.flatMap((o, i) => (o === "1" ? [i] : []));
  const rhs: Expr = dnfExpr(dnfTerms(minterms, n), s.vars);
  const ins: Ty[] = s.vars.map(() => BIT);
  const def: Def = {
    k: "def", name: s.name, params: s.vars.map((v) => ({ k: "var", name: v })), rhs: [rhs], eqns: [],
  };
  indexDef(def);
  c.reg.set(s.name, { name: s.name, ins, outs: [BIT] });
  registerDef(c.reg, def);
  return [block("DNF circuit for", s.name, nl([declDoc(s.name, ins, [BIT]), ...defLines(def)]))];
}
