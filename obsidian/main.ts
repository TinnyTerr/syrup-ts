import { MarkdownRenderer, Plugin, loadPrism } from "obsidian";
import { run } from "../src/index";
import { askPrismGrammar, defineAskCm5Mode, defineCm5Mode, prismGrammar } from "./highlight";

export default class SyrupPlugin extends Plugin {
  override async onload() {
    defineCm5Mode();
    defineAskCm5Mode();
    const prism = await loadPrism();
    prism.languages.syrup = prismGrammar;
    prism.languages.ask = askPrismGrammar;

    this.registerMarkdownCodeBlockProcessor("ask", (source, el) => {
      const pre = el.createEl("pre", { cls: "ask-source language-ask" });
      const code = pre.createEl("code", { cls: "language-ask" });
      code.innerHTML = prism.highlight(source, prism.languages.ask, "ask");
    });

    this.registerMarkdownCodeBlockProcessor("syrup", async (source, el, ctx) => {
      const pre = el.createEl("pre", { cls: "syrup-source language-syrup" });
      const code = pre.createEl("code", { cls: "language-syrup" });
      code.innerHTML = prism.highlight(source, prism.languages.syrup, "syrup");

      const out = el.createDiv({ cls: "syrup-output" });
      let log: string[];
      try {
        log = run(source).log;
      } catch (e) {
        log = [`Error: ${(e as Error).message}`];
      }
      for (const entry of log) {
        if (entry.startsWith("```")) {
          // mermaid fences etc: let Obsidian render them
          const box = out.createDiv({ cls: "syrup-block" });
          await MarkdownRenderer.render(this.app, entry, box, ctx.sourcePath, this);
        } else {
          // truth tables are column-aligned plain text; markdown would mangle them
          out.createEl("pre", {
            cls: entry.startsWith("Error:") ? "syrup-entry syrup-error" : "syrup-entry",
            text: entry,
          });
        }
      }
    });
  }
}
