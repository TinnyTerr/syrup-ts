// Loads a GHC wasm reactor module built with the JSFFI (see ../Makefile).
import { ConsoleStdout, File, OpenFile, WASI } from "@bjorn3/browser_wasi_shim";

export async function loadHs(wasmUrl, jsffi) {
	const fds = [
		new OpenFile(new File([])),
		ConsoleStdout.lineBuffered((m) => console.log(m)),
		ConsoleStdout.lineBuffered((m) => console.warn(m)), // Debug.Trace
	];
	// empty PATH: System.Directory.findExecutable throws without one
	const wasi = new WASI([], ["PATH="], fds, { debug: false });
	const exportsRef = {};
	const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {
		wasi_snapshot_preview1: wasi.wasiImport,
		ghc_wasm_jsffi: jsffi(exportsRef),
	});
	Object.assign(exportsRef, instance.exports);
	wasi.initialize(instance);
	instance.exports.hs_init(0, 0);
	return instance.exports;
}
