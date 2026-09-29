// Highlighting token list shared by the editor integrations. Regex sources
// only (no flags, no anchors) so each consumer can wrap them: the VS Code
// grammar is generated from this (shared/gen-textmate.ts), the Obsidian
// plugin imports it directly. Mirrors src/lexer.ts and the statement heads
// in src/parser.ts.

export const KEYWORDS = ["experiment", "where", "display", "type", "print"];
// primitives (src/eval.ts) and prelude circuits (src/prelude.ts)
export const BUILTINS = ["nand", "zero", "dff", "srff", "not", "and", "or", "xor", "one"];

const words = (w: string[]) => `\\b(?:${w.join("|")})\\b`;

export const RULES = {
  comment: "--.*",
  type: "<[A-Za-z][A-Za-z0-9]*>",
  keyword: words(KEYWORDS),
  builtin: words(BUILTINS),
  func: "\\b[A-Za-z][A-Za-z0-9]*(?=\\()",
  number: "\\b[0-9]+\\b",
  operator: "->|[=!&|@]",
  punctuation: "[()\\[\\],]",
} as const;
