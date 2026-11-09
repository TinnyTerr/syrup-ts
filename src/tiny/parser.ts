import type { TinyMachineProgram } from "./ast";

const PROGRAM =
  /^([0-9a-fA-F]{4}) ([0-9a-fA-F]{4}) ([0-9a-fA-F]{4}) ([0-9a-fA-F]{4}) ([A-Za-z]{3}) ([0-9a-fA-F]{3})(?:,([0-9a-fA-F]+(?:,[0-9a-fA-F]+)*))?$/;

export class TinyMachineParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TinyMachineParseError";
  }
}

export function parseTinyMachine(source: string): TinyMachineProgram {
  if (source.length === 0) {
    throw new TinyMachineParseError("Tiny Machine source is empty");
  }
  if (source.includes("\n") || source.includes("\r")) {
    throw new TinyMachineParseError("Tiny Machine source must be one line");
  }

  const match = PROGRAM.exec(source);
  if (!match) {
    throw new TinyMachineParseError(
      "expected: hhhh hhhh hhhh hhhh OOO ooo[,input[,input...]]",
    );
  }

  return {
    memory: [match[1]!, match[2]!, match[3]!, match[4]!],
    operation: match[5]!.toUpperCase(),
    operand: match[6]!.toUpperCase(),
    input: match[7]?.split(",").map((value) => value.toUpperCase()) ?? [],
  };
}
