import { Graphviz } from "@hpcc-js/wasm-graphviz";
import jsffi from "../build/syrup.jsffi.js";
import wasmUrl from "../build/syrup.wasm";
import segments from "../vendor/Syrup/test/7segments.syrup" with {
	type: "text",
};
import diagram from "../vendor/Syrup/test/diagram-html.syrup" with {
	type: "text",
};
import samples from "../vendor/Syrup/test/samples.syrup" with { type: "text" };
import stopwatch from "../vendor/Syrup/test/stopwatch.syrup" with {
	type: "text",
};
import { editor } from "./editor.js";
import { loadHs } from "./hs.js";
import { readHsString } from "./hsstring.js";

const examples = { samples, diagram, "7segments": segments, stopwatch };
const $ = (id) => document.getElementById(id);
const [input, output, status, example] = [
	"input",
	"output",
	"status",
	"example",
].map($);

for (const name of Object.keys(examples)) example.add(new Option(name, name));

const [hs, graphviz] = await Promise.all([
	loadHs(wasmUrl, jsffi),
	Graphviz.load(),
]);

function args() {
	// always source dot: there is no `dot` executable, graphs render here instead
	const a = ["--source-dot", $("html").checked ? "--html" : "--text"];
	if ($("quiet").checked) a.push("-q");
	if ($("limit").value !== "") a.push("--experiment-limit", $("limit").value);
	return a.join("\n");
}

// upstream's html embeds <script type="module"> blocks that pull graphviz from
// a CDN; innerHTML never runs them, so pull the dot out and render it locally
function renderGraphs(root) {
	for (const script of root.querySelectorAll("script")) {
		const code = script.textContent;
		const dot = /const dot_\d+ = ("(?:[^"\\]|\\.)*");/.exec(code);
		const target = /getElementById\("([^"]+)"\)/.exec(code);
		script.remove();
		if (!dot || !target) continue;
		const el = root.querySelector(`#${CSS.escape(target[1])}`);
		if (!el) continue;
		try {
			el.innerHTML = graphviz.dot(readHsString(dot[1]));
		} catch (e) {
			el.textContent = `graphviz: ${e?.message ?? e}`;
		}
	}
}

const ed = editor({
	input,
	runBtn: $("run"),
	live: $("live"),
	status,
	async check() {
		const out = await hs.syrup(args(), input.value);
		if ($("html").checked) {
			output.style.whiteSpace = "";
			output.innerHTML = out;
			renderGraphs(output);
		} else {
			output.style.whiteSpace = "pre";
			output.textContent = out;
		}
	},
});

for (const id of ["html", "quiet", "limit"])
	$(id).addEventListener("change", ed.run);
example.addEventListener("change", () => {
	input.value = examples[example.value];
	ed.run();
});

input.value = samples;
status.textContent = "ready (ctrl+enter to run)";
ed.run();
