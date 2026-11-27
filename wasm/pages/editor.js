// Shared editor wiring: run button, ctrl+enter, live mode, tab inserts spaces.
export function editor({ input, runBtn, live, status, check }) {
	let busy = false;
	async function go() {
		if (busy) return;
		busy = true;
		status.textContent = "running...";
		const t = performance.now();
		try {
			await check();
			status.textContent = `${(performance.now() - t).toFixed(0)} ms`;
		} catch (e) {
			console.error(e);
			status.textContent = `error: ${e?.message ?? e}`;
		}
		busy = false;
	}
	let timer;
	const onChange = () => {
		if (!live.checked) return;
		clearTimeout(timer);
		timer = setTimeout(go, 400);
	};
	input.addEventListener("input", onChange);
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			go();
		}
		if (e.key === "Tab") {
			e.preventDefault();
			input.setRangeText("  ", input.selectionStart, input.selectionEnd, "end");
			onChange();
		}
	});
	runBtn.addEventListener("click", go);
	runBtn.disabled = false;
	return { run: go, onChange };
}
