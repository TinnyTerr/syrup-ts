// Highlighting tokens for `ask` (msp-strath/ask), the CS103 proof assistant.
// Mirrors askLang in Marx's marx.js, minus the per-page lists of constructors
// and functions it gets injected: here capitalised words are constructors,
// as ask itself treats them. Regex sources only, same as tokens.ts. Block
// comments nest ({- {- -} -}), so they're handled by each consumer rather
// than being a RULES entry.

export const ASK_BLOCK_OPEN = "\\{-";
export const ASK_BLOCK_CLOSE = "-\\}";

const words = (w: string[]) => `\\b(?:${w.join("|")})\\b`;

export const ASK_RULES = {
  comment: "--.*",
  string: '"[^"]*"',
  success: words(["proven", "defined", "parsed"]),
  primary: `\\?|${words(["prove", "define", "parse"])}`,
  assumption: words(["given"]),
  keyword:
    "::|->|=|\\||" +
    words(["data", "grammar", "prop", "where", "from", "by", "inductively", "tested", "test", "under", "infixl", "infixr"]),
  nonterminal: "<[A-Za-z][A-Za-z_0-9]+>",
  constructor: "\\b[A-Z][A-Za-z0-9_']*",
  punctuation: "[()\\[\\]]",
} as const;
