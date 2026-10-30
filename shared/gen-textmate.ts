// bun shared/gen-textmate.ts -> vscode/syntaxes/{syrup,ask}.tmLanguage.json
import { RULES } from "./tokens";
import { ASK_BLOCK_CLOSE, ASK_BLOCK_OPEN, ASK_RULES } from "./ask-tokens";

const scope: Record<keyof typeof RULES, string> = {
  comment: "comment.line.double-dash.syrup",
  type: "storage.type.syrup",
  keyword: "keyword.control.syrup",
  builtin: "support.function.builtin.syrup",
  func: "entity.name.function.syrup",
  number: "constant.numeric.syrup",
  operator: "keyword.operator.syrup",
  punctuation: "punctuation.syrup",
};

const grammar = {
  $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  name: "Syrup",
  scopeName: "source.syrup",
  patterns: (Object.keys(RULES) as (keyof typeof RULES)[]).map((k) => ({
    name: scope[k],
    match: RULES[k],
  })),
};

await Bun.write(
  new URL("../vscode/syntaxes/syrup.tmLanguage.json", import.meta.url),
  JSON.stringify(grammar, null, 2) + "\n",
);

const askScope: Record<keyof typeof ASK_RULES, string> = {
  comment: "comment.line.double-dash.ask",
  string: "string.quoted.double.ask",
  success: "markup.inserted.ask",
  primary: "keyword.other.primary.ask",
  assumption: "storage.modifier.ask",
  keyword: "keyword.control.ask",
  nonterminal: "storage.type.ask",
  constructor: "entity.name.type.ask",
  punctuation: "punctuation.ask",
};

const askGrammar = {
  $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  name: "Ask",
  scopeName: "source.ask",
  patterns: [
    {
      name: "comment.block.ask",
      begin: ASK_BLOCK_OPEN,
      end: ASK_BLOCK_CLOSE,
      patterns: [{ include: "#block" }],
    },
    ...(Object.keys(ASK_RULES) as (keyof typeof ASK_RULES)[]).map((k) => ({
      name: askScope[k],
      match: ASK_RULES[k],
    })),
  ],
  repository: {
    block: {
      name: "comment.block.ask",
      begin: ASK_BLOCK_OPEN,
      end: ASK_BLOCK_CLOSE,
      patterns: [{ include: "#block" }],
    },
  },
};

await Bun.write(
  new URL("../vscode/syntaxes/ask.tmLanguage.json", import.meta.url),
  JSON.stringify(askGrammar, null, 2) + "\n",
);
