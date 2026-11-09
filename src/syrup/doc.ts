// Structured output. Statements produce `Message`s made of `Doc` trees; the
// same tree is rendered to upstream-style plain text ("syrup" format) or to
// the HTML the original playground consumes (css classes `syrup-*`).

export type Level = "happy" | "comment" | "warning" | "error" | "internal";

export type Doc =
  | string
  | { t: "seq"; c: Doc[] }
  | { t: "code"; c: Doc[] }
  | { t: "fn" | "ty" | "var" | "kw"; s: string }
  | { t: "br" }
  | { t: "indent"; c: Doc[] }
  | { t: "codeblock"; c: Doc[] }
  | { t: "table"; table: Table }
  | { t: "raw"; html: string; text: string };

export const br: Doc = { t: "br" };
export const seq = (...c: Doc[]): Doc => ({ t: "seq", c });
export const code = (...c: Doc[]): Doc => ({ t: "code", c });
export const fn = (s: string): Doc => ({ t: "fn", s });
export const ty = (s: string): Doc => ({ t: "ty", s });
export const kw = (s: string): Doc => ({ t: "kw", s });
export const vr = (s: string): Doc => ({ t: "var", s });
export const indent = (...c: Doc[]): Doc => ({ t: "indent", c });
export const codeblock = (...c: Doc[]): Doc => ({ t: "codeblock", c });
export const raw = (html: string, text: string): Doc => ({ t: "raw", html, text });
/** `name` as a circuit reference: <code><span fn>name</span></code> */
export const circ = (name: string): Doc => code(fn(name));
export const lines = (ls: Doc[]): Doc => seq(...ls.flatMap((l, i) => (i ? [br, l] : [l])));
export const sepBy = (items: Doc[], sep: Doc): Doc =>
  seq(...items.flatMap((d, i) => (i ? [sep, d] : [d])));

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export interface TCell {
  text: string;
  /** replaces the inner HTML of the <td>; `text` is still used for widths */
  html?: string;
  /** width override (graphical cells whose text is not their layout width) */
  w?: number;
}

export interface Table {
  headers?: TCell[];
  /** index of the first right-hand column; text draws `||`, html an empty column */
  split?: number;
  /** leading columns that span every row of a group (shown once, in html with rowspan) */
  spanCols?: number;
  /** groups of rows; text separates groups with a rule when `ruled` */
  groups: TCell[][][];
  ruled?: boolean;
  /** first body column is a row header (<th>) */
  rowHead?: boolean;
  /** html cells are not padded to the column width (default: padded) */
  padHtml?: boolean;
}

export const cell = (text: string): TCell => ({ text });

export type Message = {
  level: Level;
  doc: Doc;
  /** text rendering joins to the previous message with a single newline */
  tight?: boolean;
  /** legacy (default CLI) plaintext, when it differs from the syrup rendering */
  legacy?: string;
  /** an error that only adds context to the one after it: not counted */
  noCount?: boolean;
  /** a "defined" notice: adjacent ones merge in the syrup/html renderings */
  define?: { kind: "circuit" | "type"; name: string };
};

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Merging "Circuit `a` is defined." notices
// ---------------------------------------------------------------------------

function listNames(items: Doc[]): Doc {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return seq(items[0]!, " and ", items[1]!);
  return seq(...items.slice(0, -1).flatMap((d) => [d, ", "]), "and ", items[items.length - 1]!);
}

export function definedDoc(kind: "circuit" | "type", names: string[]): Doc {
  const items = names.map((n) => (kind === "circuit" ? circ(n) : code(ty(`<${n}>`))));
  const noun = kind === "circuit" ? "Circuit" : "Type";
  return seq(names.length === 1 ? noun : noun + "s", " ", listNames(items), names.length === 1 ? " is defined." : " are defined.");
}

export function mergeDefined(msgs: Message[]): Message[] {
  const out: Message[] = [];
  let run: { kind: "circuit" | "type"; names: string[] } | undefined;
  const flush = () => {
    if (!run) return;
    out.push({ level: "comment", doc: definedDoc(run.kind, run.names), define: { kind: run.kind, name: run.names[0]! } });
    run = undefined;
  };
  for (const m of msgs) {
    if (m.define) {
      if (run && run.kind !== m.define.kind) flush();
      (run ??= { kind: m.define.kind, names: [] }).names.push(m.define.name);
    } else {
      flush();
      out.push(m);
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

function flat(d: Doc): string {
  return renderText(d);
}

function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - s.length));
}

function colWidths(t: Table, ncols: number): number[] {
  const ws = new Array<number>(ncols).fill(0);
  const bump = (c: TCell | undefined, i: number) => {
    if (c) ws[i] = Math.max(ws[i]!, c.w ?? c.text.length);
  };
  t.headers?.forEach(bump);
  for (const g of t.groups) for (const r of g) r.forEach(bump);
  return ws;
}

function tableText(t: Table): string {
  const ncols = Math.max(t.headers?.length ?? 0, ...t.groups.flatMap((g) => g.map((r) => r.length)));
  const ws = colWidths(t, ncols);
  const bar = (i: number) => (t.split !== undefined && i === t.split - 1 ? "||" : "|");
  const lead = t.split === 0 ? "||" : "|";
  const row = (cells: (TCell | undefined)[]) =>
    lead + ws.map((w, i) => " " + pad(cells[i]?.text ?? "", w) + " " + bar(i)).join("");
  const rule = () =>
    lead + ws.map((w, i) => "-".repeat(w + 2) + (t.split !== undefined && i === t.split - 1 ? "++" : i === ncols - 1 ? "|" : "+")).join("");
  const out: string[] = [];
  if (t.headers) {
    out.push(row(t.headers), rule());
  }
  t.groups.forEach((g, gi) => {
    if (gi > 0 && t.ruled) out.push(rule());
    g.forEach((r, ri) => {
      const cells = r.slice();
      if (ri > 0 && t.spanCols) for (let i = 0; i < t.spanCols; i++) cells[i] = { text: "" };
      out.push(row(cells));
    });
  });
  return out.join("\n");
}

export function renderText(d: Doc): string {
  if (typeof d === "string") return d;
  switch (d.t) {
    case "seq":
      return d.c.map(renderText).join("");
    case "code":
      return "`" + d.c.map(renderText).join("") + "`";
    case "fn":
    case "ty":
    case "var":
    case "kw":
      return d.s;
    case "br":
      return "\n";
    case "indent":
      return d.c
        .map(renderText)
        .join("")
        .split("\n")
        .map((l) => "  " + l)
        .join("\n");
    case "codeblock":
      return d.c.map(renderText).join("");
    case "table":
      return tableText(d.table);
    case "raw":
      return d.text;
  }
}

const PREFIX: Record<Level, string> = {
  happy: "",
  comment: "",
  warning: "Warning: ",
  error: "Error: ",
  internal: "Internal error: ",
};

export function messageText(m: Message): string {
  return PREFIX[m.level] + renderText(m.doc);
}

/** Whole output as upstream plain text. */
export function renderMessagesText(msgs: Message[]): string {
  let out = "";
  msgs.forEach((m, i) => {
    if (i) out += m.tight ? "\n" : "\n\n";
    out += messageText(m);
  });
  return out;
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function th(c: TCell, w: number, padded = true): string {
  return `<th>${c.html ?? `<code>${esc(padded ? pad(c.text, w) : c.text)}</code>`}</th>`;
}

function td(c: TCell | undefined, w: number, rowspan?: number, padded = true): string {
  const rs = rowspan && rowspan > 1 ? ` rowspan="${rowspan}"` : "";
  const inner = c?.html ?? `<code>${esc(padded ? pad(c?.text ?? "", w) : c?.text ?? "")}</code>`;
  return `<td${rs}>${inner}</td>`;
}

function tableHtml(t: Table): string {
  const ncols = Math.max(t.headers?.length ?? 0, ...t.groups.flatMap((g) => g.map((r) => r.length)));
  const ws = colWidths(t, ncols);
  const withMid = <T>(items: T[], mid: T, skipped = 0): T[] =>
    t.split === undefined ? items : [...items.slice(0, t.split - skipped), mid, ...items.slice(t.split - skipped)];
  const padded = t.padHtml !== false;
  let s = '<div class="syrup-table"><table>';
  if (t.headers) {
    const hs = t.headers.map((h, i) => th(h, ws[i]!, false));
    s += "<thead><tr>" + withMid(hs, "<th><code></code></th>").join("") + "</tr></thead>";
  }
  s += "<tbody>";
  s += t.groups
    .map((g) =>
      g
        .map((r, ri) => {
          const cs: string[] = [];
          for (let i = 0; i < ncols; i++) {
            if (t.rowHead && i === 0) cs.push(th(r[0] ?? { text: "" }, ws[0]!, padded));
            else if (i < (t.spanCols ?? 0)) {
              if (ri === 0) cs.push(td(r[i], ws[i]!, g.length, padded));
            } else cs.push(td(r[i], ws[i]!, undefined, padded));
          }
          return "<tr>" + withMid(cs, "<td><code></code></td>", ri > 0 ? t.spanCols ?? 0 : 0).join("") + "</tr>";
        })
        .join(""),
    )
    .join("\n");
  s += "</tbody></table></div>";
  return s;
}

export function renderHtml(d: Doc): string {
  if (typeof d === "string") return esc(d);
  switch (d.t) {
    case "seq":
      return d.c.map(renderHtml).join("");
    case "code":
      return "<code>" + d.c.map(renderHtml).join("") + "</code>";
    case "fn":
      return `<span class="syrup-function">${esc(d.s)}</span>`;
    case "ty":
      return `<span class="syrup-type">${esc(d.s)}</span>`;
    case "var":
      return `<span class="syrup-variable">${esc(d.s)}</span>`;
    case "kw":
      return `<span class="syrup-keyword">${esc(d.s)}</span>`;
    case "br":
      return "\n<br>\n";
    case "indent":
      return `<div style="padding-left: 2ch">${d.c.map(renderHtml).join("")}</div>`;
    case "codeblock":
      return `<div class="syrup-code">${d.c.map(renderHtml).join("")}</div>`;
    case "table":
      return tableHtml(d.table);
    case "raw":
      return d.html;
  }
}

export function messageHtml(m: Message): string {
  return `<div class="syrup-${m.level}">${renderHtml(m.doc)}</div>`;
}

export function renderMessagesHtml(msgs: Message[]): string {
  return msgs.map(messageHtml).join("\n<br>\n");
}
