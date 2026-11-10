import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { messageText } from "../src/syrup/doc";
import type { Component, Registry } from "../src/syrup/eval";
import { run } from "../src/syrup/index";
import { BUILTIN_PRESETS } from "../src/syrup/prelude";

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
		const key = Object.keys(m.groups!).find(
			(g) => m.groups?.[g] !== undefined,
		)!;
		out.push(
			<span key={m.index} className={CLASSES[key]}>
				{m[0]}
			</span>,
		);
		last = m.index + m[0].length;
	}
	out.push(`${src.slice(last)}\n `);
	return out;
}

function Editor({
	value,
	onChange,
}: {
	value: string;
	onChange: (v: string) => void;
}) {
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
	}, []);
	return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}

function formatType(type: Component["ins"][number]): string {
	if (type.k === "bit") return "bit";
	return `[${type.items.map(formatType).join(", ")}]`;
}

function RegistryDetails({ registry }: { registry: Registry }) {
	const components = [...registry.values()].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
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
					{components.map((component) => (
						<tr key={component.name}>
							<td>
								<code>{component.name}</code>
							</td>
							<td>{component.ins.map(formatType).join(", ") || "-"}</td>
							<td>{component.outs.map(formatType).join(", ") || "-"}</td>
							<td>
								{component.isPrimitive
									? "primitive"
									: component.def
										? "defined"
										: "declared"}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</details>
	);
}

function Playground() {
	const [source, setSource] = useState(DEFAULT_SOURCE);
	const [tests, setTests] = useState("");
	const [testsLang, setTestsLang] = useState<"syrup" | "js">("syrup");
	// presets, diagnostics, tests and the registry are hidden until F9 (they all keep working while hidden)
	const [showPresets, setShowPresets] = useState(false);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "F9") {
				e.preventDefault();
				setShowPresets((s) => !s);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	// nothing is predefined: presets are off until switched on here
	const [enabled, setEnabled] = useState<string[]>([]);
	const [custom, setCustom] = useState<Record<string, string>>({});
	const [draftName, setDraftName] = useState("");
	const [draftSrc, setDraftSrc] = useState("");
	const all: Record<string, string> = { ...BUILTIN_PRESETS, ...custom };
	const result = useMemo(
		() =>
			run(source, {
				format: "html",
				presets: enabled,
				presetDefs: custom,
				tests,
				testsLang,
			}),
		[source, tests, testsLang, enabled, custom],
	);
	const toggle = (n: string) =>
		setEnabled((e) => (e.includes(n) ? e.filter((x) => x !== n) : [...e, n]));
	const addPreset = () => {
		const n = draftName.trim();
		if (!n || !draftSrc.trim()) return;
		setCustom((c) => ({ ...c, [n]: draftSrc }));
		setEnabled((e) => (e.includes(n) ? e : [...e, n]));
		setDraftName("");
		setDraftSrc("");
	};
	const removePreset = (n: string) => {
		setCustom((c) =>
			Object.fromEntries(Object.entries(c).filter(([k]) => k !== n)),
		);
		setEnabled((e) => e.filter((x) => x !== n));
	};

	return (
		<>
			<h1>Syrup playground</h1>
			<form
				onSubmit={(e) => {
					e.preventDefault();
				}}
			>
				<fieldset>
					<div className="boxform">
						<h3>Syrup Playground</h3>
						{showPresets && (
							<>
								<details open>
									<summary>Presets ({enabled.length} enabled)</summary>
									<p>
										Named bundles of definitions, off until you tick them. Add
										your own below.
									</p>
									<ul>
										{Object.keys(all).map((n) => (
											<li key={n}>
												<label>
													<input
														type="checkbox"
														checked={enabled.includes(n)}
														onChange={() => toggle(n)}
													/>{" "}
													{n}
													{n in custom && n in BUILTIN_PRESETS
														? " (overrides builtin)"
														: n in custom
															? ""
															: " (builtin)"}
												</label>
												{n in custom && (
													<button type="button" onClick={() => removePreset(n)}>
														remove
													</button>
												)}
												<details>
													<summary>source</summary>
													<pre>{all[n]?.trim()}</pre>
												</details>
											</li>
										))}
									</ul>
									<input
										placeholder="preset name"
										value={draftName}
										onChange={(e) => setDraftName(e.target.value)}
									/>
									<Editor value={draftSrc} onChange={setDraftSrc} />
									<button type="button" onClick={addPreset}>
										Add preset
									</button>
								</details>

								<details>
									<summary>
										Diagnostics ({result.errorCount} errors,{" "}
										{result.messages.length} messages)
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
								<details open={result.tests.results.length > 0}>
									<summary>
										Tests ({result.tests.passed} passed, {result.tests.failed}{" "}
										failed)
									</summary>
									<p>
										Syrup: experiments and partial truth tables (
										<code>table f</code> with indented <code>01 | 1</code> rows,{" "}
										<code>_</code> = don't care). JS:{" "}
										<code>table(name, rows)</code>, <code>row</code>,{" "}
										<code>test</code>, <code>assert</code>.{" "}
										<select
											value={testsLang}
											onChange={(e) =>
												setTestsLang(e.target.value as "syrup" | "js")
											}
										>
											<option value="syrup">syrup</option>
											<option value="js">js</option>
										</select>
									</p>
									<Editor
										value={tests}
										onChange={(value) => {
											setTests(value);
										}}
									/>
									<ul>
										{result.tests.results.map((t, index) => (
											<li
												key={index}
												className={t.ok ? "syrup-happy" : "syrup-error"}
											>
												{t.text}
											</li>
										))}
									</ul>
								</details>
								<RegistryDetails registry={result.registry} />
							</>
						)}
						<table className="syrup-table">
							<tbody>
								<tr>
									<td className="valign-top syrup-input">
										<Editor
											value={source}
											onChange={(value) => {
												setSource(value);
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
