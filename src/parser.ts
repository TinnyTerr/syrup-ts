import { lex, LexError, type Tok } from "./lexer";
import {
  type Ty, BIT, cable, type Pat, type Expr, type Eqn,
  type Decl, type Def, type Stmt, type ValueLit, type TypeDef, indexDef,
} from "./ast";

// Names introduced by `type <Name> = <type-expr>` statements, resolved
// during parsing. Shared across a whole program (and the prelude) so a
// user's `type` statement is visible to every later declaration.
export type TypeAliases = Map<string, Ty>;

/** The two graphical output types built into the language. */
export function builtinAliases(): TypeAliases {
  const bits = (n: number) => cable(Array.from({ length: n }, () => BIT));
  return new Map<string, Ty>([
    ["7Segments", { ...bits(7), alias: "7Segments" }],
    ["Braille", { ...bits(6), alias: "Braille" }],
  ]);
}

// How a parse failure is explained in the "I was trying to make sense of" report.
export type Because =
  | { k: "unexpected" } // it made sense, but then stuff I didn't expect
  | { k: "begin" } // didn't know where to begin
  | { k: "hoping"; hoping: string; found: string };

export class ParseError extends Error {
  constructor(
    message: string,
    public pos?: number,
    public looking?: string,
    public because?: Because,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Statement splitting: Syrup uses an offside rule where a statement starts
// at column 0 and continues on any subsequently-indented line.
// ---------------------------------------------------------------------------

function stripComment(line: string): string {
  const idx = line.indexOf("--");
  return idx === -1 ? line : line.slice(0, idx);
}

export function splitStatements(src: string): string[] {
  return splitStatementsDetailed(src).map((c) => c.text);
}

/** Like splitStatements, noting whether a blank line came before each chunk. */
export function splitStatementsDetailed(src: string): { text: string; blankBefore: boolean }[] {
  const chunks: { text: string; blankBefore: boolean }[] = [];
  let cur: string[] = [];
  let curBlank = false;
  let blanks = 0;
  for (const raw of src.split("\n")) {
    const stripped = stripComment(raw).replace(/\s+$/, "");
    if (stripped.trim() === "") {
      blanks++;
      continue;
    }
    if (!/^[ \t]/.test(stripped)) {
      if (cur.length) chunks.push({ text: cur.join("\n"), blankBefore: curBlank });
      curBlank = blanks > 0;
      cur = [stripped];
    } else {
      if (cur.length === 0) throw new ParseError(`unexpected indentation: "${raw}"`);
      for (; blanks > 0; blanks--) cur.push("");
      cur.push(stripped);
    }
    blanks = 0;
  }
  if (cur.length) chunks.push({ text: cur.join("\n"), blankBefore: curBlank });
  return chunks;
}

// Index of a standalone top-level word (e.g. "where"), tracking bracket depth.
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

function describe(t: Tok): string {
  return t.kind === "eof" ? "the end" : t.value;
}

class TokStream {
  constructor(private toks: Tok[], private pos = 0) {}
  peek(): Tok { return this.toks[this.pos]!; }
  peekAt(offset: number): Tok { return this.toks[Math.min(this.pos + offset, this.toks.length - 1)]!; }
  next(): Tok { return this.toks[this.pos++]!; }
  at(kind: Tok["kind"]): boolean { return this.peek().kind === kind; }
  expect(kind: Tok["kind"], looking?: string): Tok {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new ParseError(
        `expected ${kind} but got ${t.kind} '${t.value}' at ${t.pos}`,
        t.pos, looking, { k: "unexpected" },
      );
    }
    this.pos++;
    return t;
  }
}

function parseType(ts: TokStream, aliases: TypeAliases): Ty {
  if (ts.at("at")) {
    // `@Ty` marks an output as coming from a register/feedback loop; it
    // carries no structural meaning here, so just parse past it.
    ts.next();
    return { ...parseType(ts, aliases), mem: true };
  }
  if (ts.at("tyname")) {
    const t = ts.next();
    if (t.value === "Bit") return BIT;
    const alias = aliases.get(t.value);
    if (!alias) throw new ParseError(`undefined type <${t.value}>`, t.pos);
    return alias;
  }
  if (ts.at("lbrack")) {
    ts.next();
    const items: Ty[] = [];
    if (!ts.at("rbrack")) {
      items.push(parseType(ts, aliases));
      while (ts.at("comma")) { ts.next(); items.push(parseType(ts, aliases)); }
    }
    ts.expect("rbrack");
    return cable(items);
  }
  throw new ParseError(`expected a type at token '${ts.peek().value}'`, ts.peek().pos);
}

function parseTypeListUntil(ts: TokStream, aliases: TypeAliases, stop: () => boolean): Ty[] {
  const items: Ty[] = [];
  if (stop()) return items;
  items.push(parseType(ts, aliases));
  while (ts.at("comma")) { ts.next(); items.push(parseType(ts, aliases)); }
  return items;
}

// Circuits named by a numeral: `1 -> <Bit>` declares `one`, `0` declares `zero`.
const NUMERAL_NAME: Record<string, string> = { "0": "zero", "1": "one" };

function parseDecl(ts: TokStream, aliases: TypeAliases): Decl {
  let name: string;
  let ins: Ty[];
  if (ts.at("bang")) {
    ts.next();
    ins = [parseType(ts, aliases)];
    name = "not";
  } else if (ts.at("num")) {
    name = NUMERAL_NAME[ts.next().value]!;
    ins = [];
  } else if (ts.at("name")) {
    name = ts.next().value;
    ts.expect("lparen", "a component template");
    ins = parseTypeListUntil(ts, aliases, () => ts.at("rparen"));
    ts.expect("rparen");
  } else {
    const ty1 = parseType(ts, aliases);
    if (ts.at("amp")) { ts.next(); ins = [ty1, parseType(ts, aliases)]; name = "and"; }
    else if (ts.at("pipe")) { ts.next(); ins = [ty1, parseType(ts, aliases)]; name = "or"; }
    else throw new ParseError(`malformed declaration near '${ts.peek().value}'`, ts.peek().pos);
  }
  ts.expect("arrow");
  const outs = parseTypeListUntil(ts, aliases, () => ts.at("eof"));
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
  throw new ParseError(`expected a pattern at token '${ts.peek().value}'`, ts.peek().pos);
}

function parsePatListUntil(ts: TokStream, stop: () => boolean): Pat[] {
  const items: Pat[] = [];
  if (stop()) return items;
  items.push(parsePat(ts));
  while (ts.at("comma")) { ts.next(); items.push(parsePat(ts)); }
  return items;
}

// `|` and `&` associate to the right: `X | Y | Z` is `X | (Y | Z)`.
function parseExprOr(ts: TokStream): Expr {
  const left = parseExprAnd(ts);
  if (ts.at("pipe")) {
    ts.next();
    return { k: "app", name: "or", args: [left, parseExprOr(ts)] };
  }
  return left;
}

function parseExprAnd(ts: TokStream): Expr {
  const left = parseExprUnary(ts);
  if (ts.at("amp")) {
    ts.next();
    return { k: "app", name: "and", args: [left, parseExprAnd(ts)] };
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
  if (t.kind === "hole" && t.value !== "") { ts.next(); return { k: "hole", name: t.value }; }
  if (t.kind === "name") {
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
    `I was trying to make sense of the following code but got stuck at '${t.value || "<end>"}'. I was looking for an expression.`,
    t.pos, "a definition", { k: "unexpected" },
  );
}

function parseExprListUntil(ts: TokStream, stop: () => boolean): Expr[] {
  const items: Expr[] = [];
  if (stop()) return items;
  items.push(parseExprOr(ts));
  while (ts.at("comma")) { ts.next(); items.push(parseExprOr(ts)); }
  return items;
}

/** Parse a standalone expression (used by property tests). */
export function parseExprText(text: string): Expr {
  const ts = new TokStream(lex(text));
  const e = parseExprOr(ts);
  ts.expect("eof");
  return e;
}

// ---------------------------------------------------------------------------
// Top-level statement parsing
// ---------------------------------------------------------------------------

function parseDefStatement(chunk: string): Def {
  const whereIdx = topLevelWord(chunk, "where");
  const headText = whereIdx === -1 ? chunk : chunk.slice(0, whereIdx);
  const bodyText = whereIdx === -1 ? "" : chunk.slice(whereIdx + "where".length);

  const ts = new TokStream(lex(headText));
  let name: string;
  let params: Pat[];
  if (ts.at("bang")) {
    ts.next();
    name = "not";
    params = [parsePat(ts)];
  } else if (ts.at("num")) {
    name = NUMERAL_NAME[ts.next().value]!;
    params = [];
  } else if (ts.at("name") && ts.peekAt(1).kind === "lparen") {
    name = ts.next().value;
    ts.expect("lparen");
    params = parsePatListUntil(ts, () => ts.at("rparen"));
    ts.expect("rparen");
  } else {
    const first = ts.peek();
    if (first.kind === "name" && ts.peekAt(1).kind !== "amp" && ts.peekAt(1).kind !== "pipe") {
      const nxt = ts.peekAt(1);
      throw new ParseError(
        `malformed definition near '${nxt.value}'`,
        nxt.pos, "a component template",
        nxt.kind === "eof" ? { k: "begin" } : { k: "hoping", hoping: "(..)", found: describe(nxt) },
      );
    }
    const left = parsePat(ts);
    if (ts.at("amp")) { ts.next(); name = "and"; params = [left, parsePat(ts)]; }
    else if (ts.at("pipe")) { ts.next(); name = "or"; params = [left, parsePat(ts)]; }
    else throw new ParseError(`malformed definition near '${ts.peek().value}'`, ts.peek().pos);
  }
  ts.expect("eq");
  const rhs = parseExprListUntil(ts, () => ts.at("eof"));
  if (!ts.at("eof") || rhs.length === 0) {
    throw new ParseError(
      `unexpected '${describe(ts.peek())}' in a definition`,
      ts.peek().pos, "a definition", { k: "unexpected" },
    );
  }

  const eqns: Eqn[] = [];
  let emptyWhere = false;
  if (whereIdx !== -1) {
    const lines = bodyText.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    emptyWhere = lines.length === 0;
    for (const line of lines) {
      const ets = new TokStream(lex(line));
      const lhs = parsePatListUntil(ets, () => ets.at("eq"));
      ets.expect("eq");
      const erhs = parseExprListUntil(ets, () => ets.at("eof"));
      ets.expect("eof");
      eqns.push({ lhs, rhs: erhs });
    }
  }

  const def: Def = { k: "def", name, params, rhs, eqns, src: chunk, emptyWhere };
  indexDef(def);
  return def;
}

// Parses the bracket/digit literal grammar used inside `experiment f(...)`,
// e.g. `[[10][10]] [[01][10]] 0`.
export function parseValueLitSeq(text: string): ValueLit[] {
  let i = 0;
  const n = text.length;
  const skipWs = () => { while (i < n && /\s/.test(text[i]!)) i++; };
  const parseOne = (): ValueLit => {
    if (text[i] === "[") {
      i++;
      const items: ValueLit[] = [];
      skipWs();
      while (text[i] !== "]") {
        if (i >= n) throw new ParseError("unterminated cable literal");
        items.push(parseOne());
        skipWs();
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

function parseMem(text: string): number[] {
  return [...text].filter((c) => c === "0" || c === "1").map(Number);
}

function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

function parseExperiment(chunk: string): Stmt {
  const rest = chunk.trim().slice("experiment".length).trim();

  const fa = /^forall\s+(.*?)\s*->\s*(.*)$/s.exec(rest);
  if (fa) {
    const vars = fa[1]!.split(",").map((v) => v.trim()).filter((v) => v !== "");
    const body = fa[2]!;
    const eq = topLevelSymbol(body, "=");
    if (eq === -1) throw new ParseError(`malformed property test: "${chunk}"`);
    return {
      k: "expForall",
      vars,
      lhs: parseExprText(body.slice(0, eq)),
      rhs: parseExprText(body.slice(eq + 1)),
    };
  }

  const nameMatch = /^[A-Za-z][A-Za-z0-9]*/.exec(rest);
  if (!nameMatch) throw new ParseError(`malformed experiment: "${chunk}"`);
  const name = nameMatch[0];
  let tail = rest.slice(name.length).trim();
  let mem: number[] | undefined;
  const memMatch = /^\{([01\s]*)\}/.exec(tail);
  if (memMatch) {
    mem = parseMem(memMatch[1]!);
    tail = tail.slice(memMatch[0].length).trim();
  }
  if (tail === "") return { k: "expTruth", name };
  if (tail.startsWith("=") && !mem) {
    const other = tail.slice(1).trim();
    const m2 = /^[A-Za-z][A-Za-z0-9]*$/.exec(other);
    if (!m2) throw new ParseError(`malformed equivalence experiment: "${chunk}"`);
    return { k: "expEquiv", a: name, b: other };
  }
  if (tail.startsWith("(")) {
    const close = matchParen(tail, 0);
    if (close === -1) throw new ParseError(`malformed experiment: "${chunk}"`);
    const inner = tail.slice(1, close);
    const after = tail.slice(close + 1).trim();
    if (after === "") {
      const steps = inner
        .split(";")
        .map((s) => s.trim())
        .filter((s, i, a) => s !== "" || a.length === 1)
        .map(parseValueLitSeq);
      return { k: "expSim", name, mem, steps };
    }
    if (after.startsWith("=")) {
      let outText = after.slice(1).trim();
      let expMem: number[] | undefined;
      const em = /^\{([01\s]*)\}/.exec(outText);
      if (em) {
        expMem = parseMem(em[1]!);
        outText = outText.slice(em[0].length).trim();
      }
      return {
        k: "expUnit",
        name,
        mem,
        inputs: parseValueLitSeq(inner),
        expMem,
        outputs: parseValueLitSeq(outText),
        text: rest,
      };
    }
  }
  throw new ParseError(`malformed experiment: "${chunk}"`);
}

function parseNameList(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter((s) => s !== "");
}

// `display f`, `display [g, h] f` (also `cost`): names to unfold, then the circuit.
function parseUnfolding(chunk: string, kw: string): { name: string; unfold: string[] } {
  const rest = chunk.trim().slice(kw.length).trim();
  const m = /^(?:\[([^\]]*)\]\s*)?([A-Za-z][A-Za-z0-9]*)$/.exec(rest);
  if (!m) throw new ParseError(`malformed ${kw}: "${chunk}"`);
  return { name: m[2]!, unfold: parseNameList(m[1] ?? "") };
}

function parseTypeDef(chunk: string, aliases: TypeAliases): TypeDef {
  const rest = chunk.slice(chunk.indexOf("type") + "type".length).trim();
  const ts = new TokStream(lex(rest));
  const nameTok = ts.expect("tyname");
  if (nameTok.value === "Bit" || aliases.has(nameTok.value)) {
    throw new ParseError(`type <${nameTok.value}> is already defined`);
  }
  ts.expect("eq");
  const ty = parseType(ts, aliases);
  ts.expect("eof");
  const named: Ty = { ...ty, alias: nameTok.value };
  aliases.set(nameTok.value, named);
  return { k: "typeDef", name: nameTok.value, ty: named };
}

export function parseChunk(chunk: string, aliases: TypeAliases = new Map()): Stmt {
  try {
    return parseChunkInner(chunk, aliases);
  } catch (e) {
    if (e instanceof LexError) throw new ParseError(e.message, e.pos, undefined, { k: "unexpected" });
    throw e;
  }
}

function parseChunkInner(chunk: string, aliases: TypeAliases): Stmt {
  const head = chunk.trimStart();
  if (/^experiment\b/.test(head)) return parseExperiment(chunk);
  if (/^display\b/.test(head)) return { k: "display", ...parseUnfolding(chunk, "display") };
  if (/^cost\b/.test(head)) return { k: "cost", ...parseUnfolding(chunk, "cost") };
  if (/^type\s+</.test(head)) return parseTypeDef(chunk, aliases);
  for (const kw of ["type", "print", "anf", "dnf", "simplify"] as const) {
    if (new RegExp(`^${kw}\\s+[A-Za-z]`).test(head)) {
      const name = head.slice(kw.length).trim();
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new ParseError(`malformed ${kw}: "${chunk}"`);
      return { k: kw === "type" ? "typing" : kw, name };
    }
  }
  const def = /^definition\s+([A-Za-z][A-Za-z0-9]*)\s*\[([^\]]*)\]\s*\[([^\]]*)\]\s*$/.exec(head);
  if (def) {
    return { k: "definition", name: def[1]!, vars: parseNameList(def[2]!), outs: parseNameList(def[3]!) };
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
    const d = parseDecl(new TokStream(lex(chunk)), aliases);
    d.src = chunk;
    return d;
  }
  if (eqIdx !== -1) return parseDefStatement(chunk);
  throw new ParseError(`unrecognized statement: "${chunk}"`, 0, "Syrup source code", { k: "begin" });
}

// Parses the whole program up front; a single malformed statement aborts
// the entire parse. Prefer driving splitStatements()+parseChunk() one
// statement at a time (see run.ts) when partial progress on error matters.
export function parseProgram(src: string): Stmt[] {
  const aliases = builtinAliases();
  return splitStatements(src).map((chunk) => parseChunk(chunk, aliases));
}
