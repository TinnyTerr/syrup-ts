import { MarkdownRenderer, Plugin, loadPrism } from "obsidian";
import { run } from "../src/index";
import { askPrismGrammar, defineAskCm5Mode, defineCm5Mode, prismGrammar } from "./highlight";

// every ```syrup block in the note, in order; `hidden` ones sit inside %% comments %%
function noteBlocks(text: string) {
  const blocks: { line: number; code: string; hidden: boolean }[] = [];
  const re = /^```syrup[^\n]*\n([\s\S]*?)^```/gm;
  for (let m; (m = re.exec(text)); ) {
    const before = text.slice(0, m.index);
    blocks.push({
      line: before.split("\n").length - 1,
      code: m[1]!,
      hidden: (before.match(/%%/g)?.length ?? 0) % 2 === 1,
    });
  }
  return blocks;
}

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
        // earlier blocks (shown or hidden in %% comments %%) form one file with this one
        const info = ctx.getSectionInfo(el);
        const prior = info
          ? noteBlocks(info.text).filter((b) => b.line < info.lineStart).map((b) => b.code)
          : [];
        if (prior.length === 0) log = run(source).log;
        else {
          const head = prior.join("\n\n");
          const before = run(head);
          const all = run(`${head}\n\n${source}`).log;
          // only show this block's output; if the code above it is broken, show that instead
          log = before.errorCount > 0 ? before.log : all.slice(before.log.length);
        }
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
