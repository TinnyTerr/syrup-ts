// `display`: Graphviz output, plus the graphical 7-segment / braille cells.
import type { Ctx } from "./ctx";
import { type Message, type TCell, type Doc, br, seq, circ, indent, lines, raw } from "./doc";
import type { Display, Ty } from "./ast";
import type { Registry } from "./eval";
import type { Value } from "./values";
import { RuntimeError } from "./eval";
import { DotBuilder } from "./dot";
import { toMermaid } from "./diagram";

// the number in `GRAPH_n` / `dot_n` counts displays across one run
const counters = new WeakMap<Registry, number>();

function listOf(items: Doc[]): Doc {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return seq(items[0]!, " and ", items[1]!);
  return seq(...items.slice(0, -1).flatMap((d) => [d, ", "]), "and ", items[items.length - 1]!);
}

const warn = (doc: Doc): Message => ({ level: "warning", doc });
const noImpl = (name: string): Doc => seq("I don't have an implementation for ", circ(name), ".");

function script(n: number, dot: string): string {
  return (
    `<script type="module">\n` +
    `  import { Graphviz } from "https://cdn.jsdelivr.net/npm/@hpcc-js/wasm/dist/index.js";\n` +
    `  if (Graphviz) {\n` +
    `    const graphviz = await Graphviz.load();\n` +
    `    const dot_${n} = ${JSON.stringify(dot)};\n` +
    `    const svg_${n} = graphviz.dot(dot_${n});\n` +
    `    document.getElementById("GRAPH_${n}").innerHTML = svg_${n};\n` +
    `  }\n` +
    `</script>`
  );
}

export function runDisplay(c: Ctx, s: Display): Message[] {
  const comp = c.reg.get(s.name);
  if (!comp) throw new RuntimeError(`\`${s.name}\` is not declared`);
  if (!comp.def) return [warn(noImpl(s.name))];

  const out: Message[] = [];
  const unfold = s.unfold.filter((u) => {
    const uc = c.reg.get(u);
    if (uc?.def) return true;
    out.push(warn(noImpl(u)));
    return false;
  });

  const b = new DotBuilder(c.reg, new Set(unfold));
  const dot = b.dot(s.name);
  if (b.unimplemented.length) {
    out.push(warn(seq(
      "When displaying ", circ(s.name), ":", br,
      indent(lines(b.unimplemented.map(noImpl))),
    )));
    return out;
  }

  let legacy: string | undefined;
  try {
    legacy = "```mermaid\n" + toMermaid(c.reg, s.name) + "\n```";
  } catch {
    legacy = undefined;
  }

  const title: Doc = seq(
    "Displaying ", circ(s.name),
    unfold.length ? seq(" (with ", listOf(unfold.map(circ)), " unfolded)") : "",
    ":",
  );
  let doc: Doc;
  if (c.opts.format === "html") {
    const n = counters.get(c.reg) ?? 0;
    counters.set(c.reg, n + 1);
    doc = seq(title, br, raw(script(n, dot), dot), br, raw(`<div id="GRAPH_${n}"></div>`, ""));
  } else {
    const body = !c.opts.sourceDot && c.opts.renderDot ? c.opts.renderDot(dot) : dot;
    doc = seq(title, br, body.replace(/\n$/, ""));
  }
  out.push({ level: "happy", doc, ...(legacy !== undefined ? { legacy } : {}) });
  return out;
}

// ---------------------------------------------------------------------------
// Graphical cells
// ---------------------------------------------------------------------------

const SEG7 = ["A", "B", "C", "D", "E", "F", "G"];
const BRAILLE = ["TL", "TR", "ML", "MR", "BL", "BR"];

type Kind = "7Segments" | "Braille";

const kindOf = (t: Ty): Kind | undefined =>
  t.alias === "7Segments" || t.alias === "Braille" ? t.alias : undefined;

function isGraphical(t: Ty): boolean {
  return !!kindOf(t) || (t.k === "cable" && t.items.some(isGraphical));
}

function flatBits(v: Value): number[] {
  return Array.isArray(v) ? v.flatMap(flatBits) : [v === 1 ? 1 : 0];
}

function display(kind: Kind, v: Value): string {
  const bits = flatBits(v);
  if (kind === "7Segments") {
    const segs = SEG7.map((n, i) => `<div class="syrup-segment${n} syrup-segment${bits[i] ?? 0}"></div>`).join("");
    return `<div class="syrup-7segmentsdisplay">${segs}</div>`;
  }
  const dots = BRAILLE.map((n, i) => `<div class="syrup-braille${n} syrup-braille${bits[i] ?? 0}"></div>`).join("");
  return `<div class="syrup-brailledisplay">${dots}</div>`;
}

function inner(t: Ty, v: Value): string {
  const k = kindOf(t);
  if (k) return display(k, v);
  if (t.k === "cable" && Array.isArray(v)) {
    return "[" + t.items.map((it, i) => (isGraphical(it) ? inner(it, v[i]!) : flatBits(v[i]!).join(""))).join(" ") + "]";
  }
  return flatBits(v).join("");
}

/**
 * A table cell drawing `value` of type `ty` when `ty` is (or contains) a
 * graphical type: <7Segments> or <Braille>. Only html output draws; in text
 * formats this returns undefined and the value prints as bits.
 */
export function graphicalCell(ty: Ty, value: Value, html: boolean): TCell | undefined {
  if (!html || !isGraphical(ty)) return undefined;
  const bits = flatBits(value);
  const body = inner(ty, value);
  return {
    text: bits.join(""),
    w: bits.length,
    html: `<div style="display: flex; align-items: center;">${body}</div>`,
  };
}
