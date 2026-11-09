import { describe, expect, test } from "bun:test";
import { parseTinyMachine, TinyMachineParseError } from "./parser";

describe("parseTinyMachine", () => {
  test("parses memory, operation, operand, and input", () => {
    expect(parseTinyMachine("0000 00af 1234 ffff add 00c,1,2a")).toEqual({
      memory: ["0000", "00af", "1234", "ffff"],
      operation: "ADD",
      operand: "00C",
      input: ["1", "2A"],
    });
  });

  test("allows a program without input", () => {
    expect(parseTinyMachine("0000 0000 0000 0000 NOP 000").input).toEqual([]);
  });

  test("rejects multiline source", () => {
    expect(() => parseTinyMachine("0000 0000 0000 0000 NOP 000\n")).toThrow(
      TinyMachineParseError,
    );
  });

  test("rejects malformed fields", () => {
    expect(() => parseTinyMachine("000 0000 0000 0000 NOP 000")).toThrow(
      TinyMachineParseError,
    );
  });
});
