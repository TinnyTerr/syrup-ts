// bun shared/gen-textmate.ts -> vscode/syntaxes/syrup.tmLanguage.json
import { RULES } from "./tokens";

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
