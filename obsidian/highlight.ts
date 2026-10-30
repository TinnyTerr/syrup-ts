import { RULES } from "../shared/tokens";
import { ASK_RULES } from "../shared/ask-tokens";

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

// ask: block comments nest, which Prism can't do, so reading view only gets
// the flat approximation; the CM5 mode below tracks depth properly.
export const askPrismGrammar = {
  comment: new RegExp(`${ASK_RULES.comment}|\\{-[\\s\\S]*?-\\}`),
  string: new RegExp(ASK_RULES.string),
  success: new RegExp(ASK_RULES.success),
  primary: new RegExp(ASK_RULES.primary),
  assumption: new RegExp(ASK_RULES.assumption),
  keyword: new RegExp(ASK_RULES.keyword),
  type: new RegExp(ASK_RULES.nonterminal),
  constructor: new RegExp(ASK_RULES.constructor),
  punctuation: new RegExp(ASK_RULES.punctuation),
};

const askCmRules: [string, RegExp][] = [
  ["comment", ASK_RULES.comment],
  ["string", ASK_RULES.string],
  ["positive", ASK_RULES.success],
  ["keyword", ASK_RULES.primary],
  ["variable-3", ASK_RULES.assumption],
  ["keyword", ASK_RULES.keyword],
  ["tag", ASK_RULES.nonterminal],
  ["variable-2", ASK_RULES.constructor],
  ["bracket", ASK_RULES.punctuation],
].map(([name, src]) => [name as string, new RegExp("^(?:" + src + ")")]);

export function defineAskCm5Mode(): boolean {
  const CM = (window as any).CodeMirror;
  if (!CM?.defineMode) return false;
  CM.defineMode("ask", () => ({
    startState: () => ({ depth: 0 }),
    token(stream: any, state: { depth: number }) {
      if (state.depth > 0) {
        while (!stream.eol()) {
          if (stream.match("{-")) state.depth++;
          else if (stream.match("-}")) {
            if (--state.depth === 0) break;
          } else stream.next();
        }
        return "comment";
      }
      if (stream.eatSpace()) return null;
      if (stream.match("{-")) {
        state.depth = 1;
        while (!stream.eol() && state.depth > 0) {
          if (stream.match("{-")) state.depth++;
          else if (stream.match("-}")) state.depth--;
          else stream.next();
        }
        return "comment";
      }
      for (const [name, re] of askCmRules) if (stream.match(re)) return name;
      stream.next();
      return null;
    },
    lineComment: "--",
    blockCommentStart: "{-",
    blockCommentEnd: "-}",
  }));
  CM.defineMIME?.("text/x-ask", "ask");
  return true;
}
