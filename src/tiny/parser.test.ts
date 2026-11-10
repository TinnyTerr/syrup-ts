import { describe, expect, test } from "bun:test";
import { parseTinyMachine, TinyMachineParseError } from "./parser";

describe("parseTinyMachine", () => {
	test("parse case correctly", () => {
		expect(parseTinyMachine("0 0 0 0  65F65E65D65C8F70")).toEqual({
			registers: {
				ip: 0,
				li: 0,
				fr: {
					hf: false,
					of: false,
					zf: false,
					cf: false,
				},
				ac: 0,
			},
			memory: [6, 5, 15, 6, 5, 14, 6, 5, 13, 6, 5, 12, 8, 15, 7, 0],
		});
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
