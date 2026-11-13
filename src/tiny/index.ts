export type { TinyMachineProgram } from "./ast";
export {
	Instructions,
	TinyMachineParseError,
	TinyMachineRuntimeError,
} from "./ast";
export { parseTinyMachine } from "./parser";
export { run, runSteps } from "./run";
