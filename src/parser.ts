import { lex, isBitTok, type Tok } from "./lexer";
import {
  type Ty, BIT, cable, type Pat, type Expr, type Eqn,
  type Decl, type Def, type Stmt, type ValueLit, indexDef,
} from "./ast";

export class ParseError extends Error {}

// ---------------------------------------------------------------------------
// Statement splitting: Syrup uses an offside rule where a statement starts
// at column 0 and continues on any subsequently-indented line.
// ---------------------------------------------------------------------------

function stripComment(line: string): string {
  const idx = line.indexOf("--");
  return idx === -1 ? line : line.slice(0, idx);
}

export function splitStatements(src: string): string[] {
  const rawLines = src.split("\n");
  const chunks: string[] = [];
  let cur: string[] = [];
  for (const raw of rawLines) {
    const stripped = stripComment(raw);
    if (stripped.trim() === "") continue;
    const isIndented = /^[ \t]/.test(stripped);
    if (!isIndented) {
      if (cur.length) chunks.push(cur.join("\n"));
      cur = [stripped];
    } else {
      if (cur.length === 0) {
        throw new ParseError(`unexpected indentation: "${raw}"`);
      }
      cur.push(stripped);
    }
  }
  if (cur.length) chunks.push(cur.join("\n"));
  return chunks;
}

// Find the index (in raw text) of a standalone top-level word (e.g. "where"),
// tracking bracket depth so nested structure can't shadow it. -1 if absent.
function topLevelWord(text: string, word: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && text.startsWith(word, i)) {
      const before = i === 0 ? " " : text[i - 1]!;
      const after = text[i + word.length] ?? " ";
      if (!/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)) return i;
    }
  }
  return -1;
}

// Find the index of a top-level occurrence of a punctuation substring (e.g.
// "->"), tracking bracket depth.
function topLevelSymbol(text: string, sym: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && text.startsWith(sym, i)) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Token-stream parser
// ---------------------------------------------------------------------------

class TokStream {
  constructor(private toks: Tok[], private pos = 0) {}
  peek(): Tok { return this.toks[this.pos]!; }
  next(): Tok { return this.toks[this.pos++]!; }
  at(kind: Tok["kind"]): boolean { return this.peek().kind === kind; }
  expect(kind: Tok["kind"]): Tok {
    const t = this.next();
    if (t.kind !== kind) {
      throw new ParseError(`expected ${kind} but got ${t.kind} '${t.value}' at ${t.pos}`);
    }
    return t;
  }
}

function parseType(ts: TokStream): Ty {
  if (isBitTok(ts.peek())) { ts.next(); return BIT; }
  if (ts.at("lbrack")) {
    ts.next();
    const items: Ty[] = [];
    if (!ts.at("rbrack")) {
      items.push(parseType(ts));
      while (ts.at("comma")) { ts.next(); items.push(parseType(ts)); }
    }
    ts.expect("rbrack");
    return cable(items);
  }
  throw new ParseError(`expected a type at token '${ts.peek().value}'`);
}

function parseTypeListUntil(ts: TokStream, stop: () => boolean): Ty[] {
  const items: Ty[] = [];
  if (stop()) return items;
  items.push(parseType(ts));
  while (ts.at("comma")) { ts.next(); items.push(parseType(ts)); }
  return items;
}

function parseDecl(ts: TokStream): Decl {
  let name: string;
  let ins: Ty[];
  if (ts.at("bang")) {
    ts.next();
    ins = [parseType(ts)];
    name = "not";
  } else if (ts.at("name") && !isBitTok(ts.peek())) {
    name = ts.next().value;
    ts.expect("lparen");
    ins = parseTypeListUntil(ts, () => ts.at("rparen"));
    ts.expect("rparen");
  } else {
    const ty1 = parseType(ts);
    if (ts.at("amp")) { ts.next(); ins = [ty1, parseType(ts)]; name = "and"; }
    else if (ts.at("pipe")) { ts.next(); ins = [ty1, parseType(ts)]; name = "or"; }
    else throw new ParseError(`malformed declaration near '${ts.peek().value}'`);
  }
  ts.expect("arrow");
  const outs = parseTypeListUntil(ts, () => ts.at("eof"));
  ts.expect("eof");
  return { k: "decl", name, ins, outs };
}

function parsePat(ts: TokStream): Pat {
  if (ts.at("wild")) { ts.next(); return { k: "wild" }; }
  if (ts.at("name")) { return { k: "var", name: ts.next().value }; }
  if (ts.at("lbrack")) {
    ts.next();
    const items: Pat[] = [];
    if (!ts.at("rbrack")) {
      items.push(parsePat(ts));
      while (ts.at("comma")) { ts.next(); items.push(parsePat(ts)); }
    }
    ts.expect("rbrack");
    return { k: "cable", items };
  }
  throw new ParseError(`expected a pattern at token '${ts.peek().value}'`);
}

function parsePatListUntil(ts: TokStream, stop: () => boolean): Pat[] {
  const items: Pat[] = [];
  if (stop()) return items;
  items.push(parsePat(ts));
  while (ts.at("comma")) { ts.next(); items.push(parsePat(ts)); }
  return items;
}

function checkDistinctPatternNames(pats: Pat[]): void {
  const seen = new Set<string>();
  const walk = (p: Pat) => {
    if (p.k === "var") {
      if (seen.has(p.name)) {
        throw new ParseError(`You are redefining the local variable ${p.name}.`);
      }
      seen.add(p.name);
    } else if (p.k === "cable") {
      p.items.forEach(walk);
    }
  };
  pats.forEach(walk);
}

function parseExprOr(ts: TokStream): Expr {
  let left = parseExprAnd(ts);
  while (ts.at("pipe")) {
    ts.next();
    const right = parseExprAnd(ts);
    left = { k: "app", name: "or", args: [left, right] };
  }
  return left;
}

function parseExprAnd(ts: TokStream): Expr {
  let left = parseExprUnary(ts);
  while (ts.at("amp")) {
    ts.next();
    const right = parseExprUnary(ts);
    left = { k: "app", name: "and", args: [left, right] };
  }
  return left;
}

function parseExprUnary(ts: TokStream): Expr {
  if (ts.at("bang")) {
    ts.next();
    return { k: "app", name: "not", args: [parseExprUnary(ts)] };
  }
  return parseExprAtom(ts);
}

function parseExprAtom(ts: TokStream): Expr {
  const t = ts.peek();
  if (t.kind === "num") { ts.next(); return { k: "lit", bit: (t.value === "1" ? 1 : 0) }; }
  if (t.kind === "name" && !isBitTok(t)) {
    ts.next();
    if (ts.at("lparen")) {
      ts.next();
      const args = parseExprListUntil(ts, () => ts.at("rparen"));
      ts.expect("rparen");
      return { k: "app", name: t.value, args };
    }
    return { k: "var", name: t.value };
  }
  if (t.kind === "lbrack") {
    ts.next();
    const items = parseExprListUntil(ts, () => ts.at("rbrack"));
    ts.expect("rbrack");
    return { k: "cable", items };
  }
  if (t.kind === "lparen") {
    ts.next();
    const e = parseExprOr(ts);
    ts.expect("rparen");
    return e;
  }
  throw new ParseError(
    `I was trying to make sense of the following code but got stuck at '${t.value || "<end>"}'. I was looking for an expression.`
  );
}

function parseExprListUntil(ts: TokStream, stop: () => boolean): Expr[] {
  const items: Expr[] = [];
  if (stop()) return items;
  items.push(parseExprOr(ts));
  while (ts.at("comma")) { ts.next(); items.push(parseExprOr(ts)); }
  return items;
}

// ---------------------------------------------------------------------------
// Top-level statement parsing
// ---------------------------------------------------------------------------

function parseDefStatement(chunk: string): Def {
  const whereIdx = topLevelWord(chunk, "where");
  const headText = whereIdx === -1 ? chunk : chunk.slice(0, whereIdx);
  const bodyText = whereIdx === -1 ? "" : chunk.slice(whereIdx + "where".length);

  const ts = new TokStream(lex(headText));
  const name = ts.expect("name").value;
  ts.expect("lparen");
  const params = parsePatListUntil(ts, () => ts.at("rparen"));
  ts.expect("rparen");
  checkDistinctPatternNames(params);
  ts.expect("eq");
  const rhs = parseExprListUntil(ts, () => ts.at("eof"));
  ts.expect("eof");

  const eqns: Eqn[] = [];
  if (whereIdx !== -1) {
    for (const rawLine of bodyText.split("\n")) {
      const line = stripComment(rawLine).trim();
      if (line === "") continue;
      const ets = new TokStream(lex(line));
      const lhs = parsePatListUntil(ets, () => ets.at("eq"));
      checkDistinctPatternNames(lhs);
      ets.expect("eq");
      const erhs = parseExprListUntil(ets, () => ets.at("eof"));
      ets.expect("eof");
      eqns.push({ lhs, rhs: erhs });
    }
  }

  const def: Def = { k: "def", name, params, rhs, eqns };
  indexDef(def);
  return def;
}

// Parses the bracket/digit literal grammar used inside `experiment f(...)`,
// e.g. `[[10][10]] [[01][10]] 0`.
function parseValueLitSeq(text: string): ValueLit[] {
  let i = 0;
  const n = text.length;
  const skipWs = () => { while (i < n && /\s/.test(text[i]!)) i++; };
  const parseOne = (): ValueLit => {
    if (text[i] === "[") {
      i++;
      const items: ValueLit[] = [];
      while (text[i] !== "]") {
        if (i >= n) throw new ParseError("unterminated cable literal");
        items.push(parseOne());
      }
      i++;
      return items;
    }
    if (text[i] === "0" || text[i] === "1") {
      const v = text[i] === "1" ? 1 : 0;
      i++;
      return v;
    }
    throw new ParseError(`bad literal at '${text.slice(i, i + 10)}'`);
  };
  const out: ValueLit[] = [];
  skipWs();
  while (i < n) {
    out.push(parseOne());
    skipWs();
  }
  return out;
}

function parseExperiment(chunk: string): Stmt {
  const rest = chunk.slice("experiment".length).trim();
  const nameMatch = /^[A-Za-z][A-Za-z0-9]*/.exec(rest);
  if (!nameMatch) throw new ParseError(`malformed experiment: "${chunk}"`);
  const name = nameMatch[0];
  const tail = rest.slice(name.length).trim();
  if (tail === "") return { k: "expTruth", name };
  if (tail.startsWith("=")) {
    const other = tail.slice(1).trim();
    const m2 = /^[A-Za-z][A-Za-z0-9]*$/.exec(other);
    if (!m2) throw new ParseError(`malformed equivalence experiment: "${chunk}"`);
    return { k: "expEquiv", a: name, b: other };
  }
  if (tail.startsWith("(") && tail.endsWith(")")) {
    const inner = tail.slice(1, -1);
    const stepsText = inner.split(";").map((s) => s.trim()).filter((s) => s !== "");
    const steps = stepsText.map(parseValueLitSeq);
    return { k: "expSim", name, steps };
  }
  throw new ParseError(`malformed experiment: "${chunk}"`);
}

function parseDisplay(chunk: string): Stmt {
  const rest = chunk.slice(chunk.indexOf("display") + "display".length).trim();
  const m = /^[A-Za-z][A-Za-z0-9]*$/.exec(rest);
  if (!m) throw new ParseError(`malformed display: "${chunk}"`);
  return { k: "display", name: rest };
}

export function parseChunk(chunk: string): Stmt {
  const head = chunk.trimStart();
  if (head.startsWith("experiment")) {
    return parseExperiment(chunk);
  }
  if (/^display\b/.test(head)) {
    return parseDisplay(chunk);
  }
  if (/^(type|print)\b/.test(head)) {
    return { k: "skip", reason: head.split(/\s/)[0]! };
  }
  const arrowIdx = topLevelSymbol(chunk, "->");
  const eqIdx = (() => {
    let depth = 0;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (depth === 0 && c === "=") return i;
    }
    return -1;
  })();
  const isDecl = arrowIdx !== -1 && (eqIdx === -1 || arrowIdx < eqIdx);
  if (isDecl) {
    const ts = new TokStream(lex(chunk));
    return parseDecl(ts);
  } else if (eqIdx !== -1) {
    return parseDefStatement(chunk);
  } else {
    throw new ParseError(`unrecognized statement: "${chunk}"`);
  }
}

// Parses the whole program up front; a single malformed statement aborts
// the entire parse. Prefer driving splitStatements()+parseChunk() one
// statement at a time (see run.ts) when partial progress on error matters.
export function parseProgram(src: string): Stmt[] {
  return splitStatements(src).map(parseChunk);
}
