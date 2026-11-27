import { run } from "../../src/tiny/index.ts";
import { editor } from "./editor.js";

const $ = (id) => document.getElementById(id);
const [input, output, status, inputs] = [
	"input",
	"output",
	"status",
	"inputs",
].map($);

const ed = editor({
	input,
	runBtn: $("run"),
	live: $("live"),
	status,
	async check() {
		const ins = inputs.value.split(/[\s,]+/).filter(Boolean);
		try {
			output.textContent = run(input.value, ins, { dots: $("dots").checked });
		} catch (e) {
			output.textContent = `${e?.name ?? "Error"}: ${e?.message ?? e}`;
		}
	},
});

inputs.addEventListener("input", ed.onChange);
$("dots").addEventListener("change", ed.run);

input.value = "0 0 0 0  65F65E65D65C8F70";
inputs.value = "0 0 1 C 0 7 C A";
status.textContent = "ready (ctrl+enter to run)";
ed.run();
