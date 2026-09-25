// Public library API: parse + evaluate Syrup source without touching the
// filesystem, so this half of the package works in the browser too.
export { run, type RunResult } from "./run";
export { newRegistry, type Registry, type Component, RuntimeError } from "./eval";
export { truthTable, simulate, equivalence } from "./experiments";
export type { Bit, Value } from "./values";
export type { Ty, Decl, Def } from "./ast";
export { ParseError } from "./parser";
