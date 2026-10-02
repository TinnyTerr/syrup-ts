import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { run, type Registry } from "../src/index";
import { PRELUDE } from "../src/prelude";
import type { Pat } from "../src/ast";

const DEFAULT_SOURCE = `gate1011(<Bit>,<Bit>) -> <Bit>
gate1011(x, y) = (x&y) | (!x&y) | (!x&!y)

experiment gate1011
display gate1011
`;

// --- highlighting: same classes and priorities as the original CodeFlask grammar ---

const TOKEN = new RegExp(
  [
    String.raw`(?<c>--[^\n]*)`,
    String.raw`(?<k>\b(?:where|experiment|print|anf|dnf|simplify|display|type|cost|forall)\b)`,
    String.raw`(?<f>(?<=\b(?:print|anf|dnf|simplify|type|display|cost|experiment)[ \t]+)[_a-zA-Z][0-9_a-zA-Z]*|[_a-zA-Z][0-9_a-zA-Z]*(?=\s*\())`,
    String.raw`(?<t><[0-9_a-zA-Z]+>)`,
    String.raw`(?<o>[!&|])`,
    String.raw`(?<s>->|[=,:@])`,
    String.raw`(?<v>[_a-zA-Z][0-9_a-zA-Z]*)`,
  ].join("|"),
  "g",
);
const CLASSES: Record<string, string> = {
  c: "syrup-commented", k: "syrup-keyword", f: "syrup-function", t: "syrup-type",
  o: "syrup-operator", s: "syrup-symbol", v: "syrup-variable",
};

function highlight(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const key = Object.keys(m.groups!).find((g) => m.groups![g] !== undefined)!;
    out.push(<span key={m.index} className={CLASSES[key]}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  out.push(src.slice(last) + "\n ");
  return out;
}

function Editor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const pre = useRef<HTMLPreElement>(null);
  const height = 20 * Math.max(value.split("\n").length + 2, 10);
  return (
    <div className="syrup-editor" style={{ height }}>
      <textarea
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        onScroll={(e) => {
          if (pre.current) {
            pre.current.scrollTop = e.currentTarget.scrollTop;
            pre.current.scrollLeft = e.currentTarget.scrollLeft;
          }
        }}
      />
      <pre ref={pre}><code>{highlight(value)}</code></pre>
    </div>
  );
}

// --- output ---

// `name` in a log line becomes <code><span class="syrup-function">name</span></code>
function inline(text: string): ReactNode[] {
  return text.split("`").map((part, i) =>
    i % 2 ? <code key={i}><span className="syrup-function">{part}</span></code> : part,
  );
}

function patNames(p: Pat): string[] {
  return p.k === "var" ? [p.name] : p.k === "wild" ? ["_"] : p.items.flatMap(patNames);
}

function TruthTable({ text, reg }: { text: string; reg: Registry }) {
  const [head, ...rows] = text.split("\n");
  const name = /`(.+)`/.exec(head!)?.[1] ?? "";
  if (rows.some((r) => r.includes("{"))) return <pre>{text}</pre>; // stateful: keep the raw layout
  const cells = rows.map((r) => r.split("|").map((s) => [...s.replace(/[\[\]\s]/g, "")]));
  const ins = cells[0]?.[0]?.length ?? 0;
  const names = reg.get(name)?.def?.params.flatMap(patNames) ?? [];
  return (
    <>
      {inline(head!)}
      <br />
      <div style={{ paddingLeft: "2ch" }}>
        <div className="syrup-table">
          <table>
            <thead>
              <tr>
                {Array.from({ length: ins }, (_, i) => (
                  <th key={i}><code>{names.length === ins ? names[i] : ""}</code></th>
                ))}
                {(cells[0]?.[1] ?? []).map((_, i) => <th key={"o" + i}><code>{i ? " " : ""}</code></th>)}
              </tr>
            </thead>
            <tbody>
              {cells.map((c, r) => (
                <tr key={r}>
                  {[...c[0]!, ...c[1]!].map((b, i) => <td key={i}><code>{b}</code></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

let mermaidReady: Promise<any> | undefined;
function loadMermaid() {
  mermaidReady ??= (import(/* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs" as string) as Promise<any>).then((m) => {
    m.default.initialize({
      startOnLoad: false,
      theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default",
    });
    return m.default;
  });
  return mermaidReady;
}

let diagramId = 0;
function Diagram({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    loadMermaid()
      .then((m) => m.render(`syrup-graph-${diagramId++}`, code))
      .then(({ svg }) => { if (live && ref.current) ref.current.innerHTML = svg; })
      .catch((e) => { if (live && ref.current) ref.current.textContent = String(e); });
    return () => { live = false; };
  }, [code]);
  return <div ref={ref} />;
}

function Entry({ text, reg }: { text: string; reg: Registry }) {
  if (text.startsWith("Error:")) return <div className="syrup-error">{text.slice(7)}</div>;
  if (text.startsWith("(skipped")) return <div className="syrup-warning">{inline(text.slice(1, -1))}</div>;
  if (text.startsWith("```mermaid")) {
    const code = text.replace(/^```mermaid\n/, "").replace(/\n```$/, "");
    const name = /subgraph (\S+?)\[/.exec(code)?.[1];
    return (
      <div className="syrup-happy">
        Displaying <code><span className="syrup-function">{name}</span></code>:
        <br />
        <Diagram code={code} />
      </div>
    );
  }
  if (text.startsWith("Truth table for")) return <div className="syrup-happy"><TruthTable text={text} reg={reg} /></div>;
  if (/^(Circuit|Type) `.*` is defined\.$/.test(text)) return <div className="syrup-comment">{inline(text)}</div>;
  const [first, ...rest] = text.split("\n");
  return (
    <div className="syrup-happy">
      {inline(first!)}
      {rest.length > 0 && <div className="syrup-code">{rest.join("\n")}</div>}
    </div>
  );
}

function Playground() {
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [result, setResult] = useState(() => run(DEFAULT_SOURCE));

  return (
    <>
      <h1>Syrup playground</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setResult(run(source));
        }}
      >
        <fieldset>
          <div className="boxform">
            <h3>Building Simple Circuits</h3>
            <pre>{PRELUDE.trim()}</pre>
            <table className="syrup-table">
              <tbody>
                <tr>
                  <td className="valign-top syrup-input">
                    <Editor value={source} onChange={setSource} />
                    <br />
                    <input type="submit" value="Send" />
                  </td>
                  <td className="valign-top syrup-output">
                    {result.log.map((text, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <br />}
                        <Entry text={text} reg={result.registry} />
                      </React.Fragment>
                    ))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </fieldset>
      </form>
    </>
  );
}

const rootEl = document.getElementById("app");
if (!rootEl) throw new Error("Missing #app root");
createRoot(rootEl).render(<Playground />);
