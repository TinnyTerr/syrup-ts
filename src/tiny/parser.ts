import type { TinyMachineProgram } from "./ast";

export class TinyMachineParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TinyMachineParseError";
  }
}

export function parseTinyMachine(source: string): TinyMachineProgram {
  throw new TinyMachineParseError("Not Implemented");
}
