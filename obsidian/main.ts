import { MarkdownRenderer, Plugin, loadPrism } from "obsidian";
import { run } from "../src/index";
import { defineCm5Mode, prismGrammar } from "./highlight";

export default class SyrupPlugin extends Plugin {
  override async onload() {
    defineCm5Mode();
    const prism = await loadPrism();
    prism.languages.syrup = prismGrammar;

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
