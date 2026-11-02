import { MarkdownRenderer, type MarkdownPostProcessorContext, Plugin, loadPrism } from "obsidian";
import { run } from "../src/index";
import { askPrismGrammar, defineAskCm5Mode, defineCm5Mode, prismGrammar } from "./highlight";

// fence flavours: plain `syrup` only highlights; `add` feeds the note's shared file;
// `compute` shows output below; the combined ones do both
const ADD = ["syrup-add", "syrup-compute-add", "syrup-add-compute"];
const COMPUTE = ["syrup-compute", "syrup-compute-add", "syrup-add-compute"];

// every block in the note that feeds the shared file, in order; `hidden` ones sit inside %% comments %%
function noteBlocks(text: string) {
  const blocks: { line: number; code: string; hidden: boolean }[] = [];
  const re = /^```(?:syrup-add|syrup-compute-add|syrup-add-compute)(?![^\s])[^\n]*\n([\s\S]*?)^```/gm;
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

const tag = "[syrup]";
const dbg = (...a: unknown[]) => console.debug(tag, ...a);

export default class SyrupPlugin extends Plugin {
  override async onload() {
    dbg("loaded");
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

    const showSource = (source: string, el: HTMLElement) => {
      const pre = el.createEl("pre", { cls: "syrup-source language-syrup" });
      const code = pre.createEl("code", { cls: "language-syrup" });
      code.innerHTML = prism.highlight(source, prism.languages.syrup, "syrup");
    };

    // highlight only; add-only blocks feed the shared file but never show output
    for (const lang of ["syrup", "syrup-add"]) {
      this.registerMarkdownCodeBlockProcessor(lang, (source, el) => showSource(source, el));
    }

    for (const lang of COMPUTE) {
      this.registerMarkdownCodeBlockProcessor(lang, async (source, el, ctx) => {
        showSource(source, el);
        await this.compute(source, el, ctx);
      });
    }
  }

  async compute(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    {
      const out = el.createDiv({ cls: "syrup-output" });
      let log: string[];
      try {
        // earlier blocks (shown or hidden in %% comments %%) form one file with this one
        const info = ctx.getSectionInfo(el);
        const all_ = info ? noteBlocks(info.text) : [];
        const prior = info ? all_.filter((b) => b.line < info.lineStart).map((b) => b.code) : [];
        dbg("compute block", {
          path: ctx.sourcePath, lineStart: info?.lineStart, hasInfo: !!info,
          noteBlocks: all_.map((b) => ({ line: b.line, hidden: b.hidden, chars: b.code.length })),
          priorCount: prior.length,
        });
        if (prior.length === 0) log = run(source).log;
        else {
          const head = prior.join("\n\n");
          const before = run(head);
          const all = run(`${head}\n\n${source}`).log;
          // only this block's output: drop everything the code above it already said
          // (multiset diff, since end-of-run notices like unfinished declarations can move)
          const seen = new Map<string, number>();
          for (const l of before.log) seen.set(l, (seen.get(l) ?? 0) + 1);
          log = all.filter((l) => {
            const n = seen.get(l) ?? 0;
            if (n > 0) { seen.set(l, n - 1); return false; }
            return true;
          });
          dbg("ran", {
            headErrors: before.errorCount, headLog: before.log.length, allLog: all.length,
            shown: log.length,
          });
        }
      } catch (e) {
        console.error(tag, "compute failed", e);
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
    }
  }
}
