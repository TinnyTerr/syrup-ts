export {
	Instructions,
	TinyMachineParseError,
	TinyMachineRuntimeError,
} from "./ast";
export type { TinyMachineProgram } from "./ast";
export { parseTinyMachine } from "./parser";
export { run } from "./run";
