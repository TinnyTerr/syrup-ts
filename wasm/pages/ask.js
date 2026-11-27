import jsffi from "../build/ask.jsffi.js";
import wasmUrl from "../build/ask.wasm";
import basics from "../vendor/ask/eg/Basics.ask" with { type: "text" };
import bst from "../vendor/ask/eg/BST.ask" with { type: "text" };
import nat from "../vendor/ask/eg/Nat.ask" with { type: "text" };
import proofs from "../vendor/ask/eg/Proofs.ask" with { type: "text" };
import { editor } from "./editor.js";
import { loadHs } from "./hs.js";

const examples = { Proofs: proofs, Basics: basics, Nat: nat, BST: bst };
const $ = (id) => document.getElementById(id);
const [input, output, status, example] = [
	"input",
	"output",
	"status",
	"example",
].map($);

for (const name of Object.keys(examples)) example.add(new Option(name, name));

const hs = await loadHs(wasmUrl, jsffi);

const ed = editor({
	input,
	runBtn: $("run"),
	live: $("live"),
	status,
	async check() {
		output.textContent = await hs.filth(input.value);
	},
});

example.addEventListener("change", () => {
	input.value = examples[example.value];
	ed.run();
});

input.value = proofs;
status.textContent = "ready (ctrl+enter to check)";
ed.run();
