import { RULES } from "../shared/tokens";

// Prism grammar, for our own rendering in reading view.
export const prismGrammar = {
  comment: new RegExp(RULES.comment),
  type: new RegExp(RULES.type),
  keyword: new RegExp(RULES.keyword),
  builtin: new RegExp(RULES.builtin),
  function: new RegExp(RULES.func),
  number: new RegExp(RULES.number),
  operator: new RegExp(RULES.operator),
  punctuation: new RegExp(RULES.punctuation),
};

// CodeMirror 5 mode, which Obsidian's editor still uses for fenced blocks
// in live preview / source mode. Token names map to cm-<name> classes.
const cmRules: [string, RegExp][] = [
  ["comment", RULES.comment],
  ["type", RULES.type],
  ["keyword", RULES.keyword],
  ["builtin", RULES.builtin],
  ["variable-2", RULES.func],
  ["number", RULES.number],
  ["operator", RULES.operator],
  ["bracket", RULES.punctuation],
].map(([name, src]) => [name as string, new RegExp("^(?:" + src + ")")]);

export function defineCm5Mode(): boolean {
  const CM = (window as any).CodeMirror;
  if (!CM?.defineMode) return false;
  CM.defineMode("syrup", () => ({
    token(stream: any) {
      if (stream.eatSpace()) return null;
      for (const [name, re] of cmRules) if (stream.match(re)) return name;
      stream.next();
      return null;
    },
    lineComment: "--",
  }));
  CM.defineMIME?.("text/x-syrup", "syrup");
  return true;
}
