// Public library API: parse + evaluate Syrup source without touching the
// filesystem, so this half of the package works in the browser too.

export type { Decl, Def, Ty } from "./ast";
export { toMermaid } from "./diagram";
export type { Doc, Level, Message } from "./doc";
export {
	type Component,
	newRegistry,
	type Registry,
	RuntimeError,
} from "./eval";
export { equivalence, simulate, truthTable } from "./experiments";
export {
	defaultOptions,
	type Format,
	type Options,
	parseOptions,
} from "./options";
export { ParseError } from "./parser";
export { type RunResult, run, type TestReport } from "./run";
export type { Bit, Value } from "./values";
