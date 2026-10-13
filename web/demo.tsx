import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { run } from "../src/index";
import { PRELUDE } from "../src/prelude";
import { messageText } from "../src/doc";
import type { Component, Registry } from "../src/eval";

const DEFAULT_SOURCE = ``;

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
    c: "syrup-commented",
    k: "syrup-keyword",
    f: "syrup-function",
    t: "syrup-type",
    o: "syrup-operator",
    s: "syrup-symbol",
    v: "syrup-variable",
};

function highlight(src: string): ReactNode[] {
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of src.matchAll(TOKEN)) {
        if (m.index > last) out.push(src.slice(last, m.index));
        const key = Object.keys(m.groups!).find(g => m.groups![g] !== undefined)!;
        out.push(
            <span key={m.index} className={CLASSES[key]}>
                {m[0]}
            </span>,
        );
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
                onChange={e => onChange(e.currentTarget.value)}
                onScroll={e => {
                    if (pre.current) {
                        pre.current.scrollTop = e.currentTarget.scrollTop;
                        pre.current.scrollLeft = e.currentTarget.scrollLeft;
                    }
                }}
            />
            <pre ref={pre}>
                <code>{highlight(value)}</code>
            </pre>
        </div>
    );
}

// --- output ---

// The engine's html output carries <script type="module"> blocks (Graphviz for
// `display`); scripts injected through innerHTML never run, so re-create them.
function runScripts(root: HTMLElement) {
    for (const old of root.querySelectorAll("script")) {
        const fresh = document.createElement("script");
        for (const a of old.attributes) fresh.setAttribute(a.name, a.value);
        fresh.textContent = old.textContent;
        old.replaceWith(fresh);
    }
}

function Output({ html }: { html: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (ref.current) runScripts(ref.current);
    }, [html]);
    return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}

function formatType(type: Component["ins"][number]): string {
    if (type.k === "bit") return "bit";
    return `[${type.items.map(formatType).join(", ")}]`;
}

function RegistryDetails({ registry }: { registry: Registry }) {
    const components = [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
    return (
        <details>
            <summary>Registry ({components.length} components)</summary>
            <table className="syrup-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Inputs</th>
                        <th>Outputs</th>
                        <th>Kind</th>
                    </tr>
                </thead>
                <tbody>
                    {components.map(component => (
                        <tr key={component.name}>
                            <td><code>{component.name}</code></td>
                            <td>{component.ins.map(formatType).join(", ") || "-"}</td>
                            <td>{component.outs.map(formatType).join(", ") || "-"}</td>
                            <td>{component.isPrimitive ? "primitive" : component.def ? "defined" : "declared"}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </details>
    );
}

function Playground() {
    const [source, setSource] = useState(DEFAULT_SOURCE);
    const [result, setResult] = useState(() => run(DEFAULT_SOURCE, { format: "html" }));

    return (
        <>
            <h1>Syrup playground</h1>
            <form
                onSubmit={e => {
                    e.preventDefault();
                    setResult(run(source, { format: "html" }));
                }}
            >
                <fieldset>
                    <div className="boxform">
                        <h3>Syrup Playground</h3>
                        <pre>{PRELUDE.trim()}</pre>

                        <details>
                            <summary>
                                Diagnostics ({result.errorCount} errors, {result.messages.length} messages)
                            </summary>
                            {result.messages.length ? (
                                <ul>
                                    {result.messages.map((message, index) => (
                                        <li key={index} className={`syrup-${message.level}`}>
                                            {messageText(message)}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p>No diagnostics.</p>
                            )}
                        </details>
                        <RegistryDetails registry={result.registry} />
                        <table className="syrup-table">
                            <tbody>
                                <tr>
                                    <td className="valign-top syrup-input">
                                        <Editor
                                            value={source}
                                            onChange={value => {
                                                setSource(value);
                                                setResult(run(value, { format: "html" }));
                                            }}
                                        />
                                        <br />
                                        <input type="submit" value="Send" />
                                    </td>
                                    <td className="valign-top syrup-output">
                                        <Output html={result.output} />
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
