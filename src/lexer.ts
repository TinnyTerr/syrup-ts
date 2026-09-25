// Tokenizer for a single Syrup statement chunk (see splitStatements in
// parser.ts for how source is broken into chunks; a chunk is lexed with all
// newlines already collapsed to spaces, so this lexer never needs to think
// about layout/indentation).

export type TokKind =
  | "name" | "num" | "wild"
  | "arrow" | "lparen" | "rparen" | "lbrack" | "rbrack"
  | "comma" | "eq" | "bang" | "amp" | "pipe"
  | "where" | "experiment" | "eof";

export interface Tok {
  kind: TokKind;
  value: string;
  pos: number;
}

const KEYWORDS: Record<string, TokKind> = {
  where: "where",
  experiment: "experiment",
};

export class LexError extends Error {}

export function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "-" && src[i + 1] === "-") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    const start = i;
    if (/[A-Za-z]/.test(c)) {
      i++;
      while (i < n && /[A-Za-z0-9]/.test(src[i]!)) i++;
      const word = src.slice(start, i);
      // "<Bit>" style type token is handled by matching '<' below, but
      // "Bit" itself never appears bare, so plain names fall through here.
      toks.push({ kind: KEYWORDS[word] ?? "name", value: word, pos: start });
      continue;
    }
    if (c === "_") {
      i++;
      toks.push({ kind: "wild", value: "_", pos: start });
      continue;
    }
    if (/[0-9]/.test(c)) {
      i++;
      while (i < n && /[0-9]/.test(src[i]!)) i++;
      const word = src.slice(start, i);
      if (word !== "0" && word !== "1") {
        throw new LexError(`invalid numeral '${word}' at ${start}`);
      }
      toks.push({ kind: "num", value: word, pos: start });
      continue;
    }
    if (c === "<") {
      // expect <Bit>
      const m = /^<Bit>/.exec(src.slice(i));
      if (!m) throw new LexError(`expected <Bit> at ${i}`);
      i += m[0].length;
      toks.push({ kind: "name", value: "<Bit>", pos: start });
      continue;
    }
    if (c === "-" && src[i + 1] === ">") {
      i += 2;
      toks.push({ kind: "arrow", value: "->", pos: start });
      continue;
    }
    const single: Record<string, TokKind> = {
      "(": "lparen", ")": "rparen", "[": "lbrack", "]": "rbrack",
      ",": "comma", "=": "eq", "!": "bang", "&": "amp", "|": "pipe",
    };
    const singleKind = single[c];
    if (singleKind) {
      i++;
      toks.push({ kind: singleKind, value: c, pos: start });
      continue;
    }
    throw new LexError(`unexpected character '${c}' at ${i}`);
  }
  toks.push({ kind: "eof", value: "", pos: n });
  return toks;
}

// The <Bit> token is lexed above with kind "name" value "<Bit>"; give it a
// dedicated predicate so the parser can tell it apart from a real name.
export function isBitTok(t: Tok): boolean {
  return t.kind === "name" && t.value === "<Bit>";
}
