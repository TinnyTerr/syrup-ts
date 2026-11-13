import { describe, expect, test } from "bun:test";
import { run } from "./run";

describe("tiny machine execution loop testing", () => {
	test("test 1 - normal operation", () => {
		expect(
			run("0 0 0 0  65F65E65D65C8F70", [
				"0",
				"0",
				"1",
				"C",
				"0",
				"7",
				"C",
				"A",
			]),
		).toBe(
			[
				`0 0 0 0  65F65E65D65C8F70  GET - 0 -`,
				`1 0 2 0  65F65E65D65C8F70  STA F - -`,
				`3 0 2 0  65F65E65D65C8F70  GET - 0 -`,
				`4 0 2 0  65F65E65D65C8F70  STA E - -`,
				`6 0 2 0  65F65E65D65C8F00  GET - 1 -`,
				`7 0 0 1  65F65E65D65C8F00  STA D - -`,
				`9 0 0 1  65F65E65D65C8100  GET - C -`,
				`A 0 0 C  65F65E65D65C8100  STA C - -`,
				`C 0 0 C  65F65E65D65CC100  SCF - - -`,
				`D 0 1 C  65F65E65D65CC100  JMP 0 - -`,
				`0 0 1 C  65F65E65D65CC100  GET - 0 -`,
				`1 0 3 0  65F65E65D65CC100  STA F - -`,
				`3 0 3 0  65F65E65D65CC100  GET - 7 -`,
				`4 0 1 7  65F65E65D65CC100  STA E - -`,
				`6 0 1 7  65F65E65D65CC170  GET - C -`,
				`7 0 1 C  65F65E65D65CC170  STA D - -`,
				`9 0 1 C  65F65E65D65CCC70  GET - A -`,
				`A 0 1 A  65F65E65D65CCC70  STA C - -`,
				`C 0 1 A  65F65E65D65CAC70  ADC C - -`,
				`E 0 5 5  65F65E65D65CAC70  PUT - - 5`,
				`F 0 5 5  65F65E65D65CAC70  HLT - - -`,
				`0 0 5 5  65F65E65D65CAC70`,
			].join("\n"),
		);
	});

	test("test for correct output", () => {
		expect(run("0 0 0 0  B6596A95A70CAF70", ["3", "F", "2"])).toBe(
			[
				`0 0 0 0  B6596A95A70CAF70  CCF - - -`,
				`1 0 0 0  B6596A95A70CAF70  GET - 3 -`,
				`2 0 0 3  B6596A95A70CAF70  STA 9 - -`,
				`4 0 0 3  B6596A95A30CAF70  GET - F -`,
				`5 0 0 F  B6596A95A30CAF70  ADC 9 - -`,
				`7 0 1 2  B6596A95A30CAF70  STA A - -`,
				`9 0 1 2  B6596A95A32CAF70  JNZ 2 - -`,
				`2 0 1 2  B6596A95A32CAF70  STA 9 - -`,
				`4 0 1 2  B6596A95A22CAF70  GET - 2 -`,
				`5 0 1 2  B6596A95A22CAF70  ADC 9 - -`,
				`7 0 0 5  B6596A95A22CAF70  STA A - -`,
				`9 0 0 5  B6596A95A25CAF70  JZE 5 - -`,
				`B 0 0 5  B6596A95A25CAF70  SCF - - -`,
				`C 0 1 5  B6596A95A25CAF70  ADC F - -`,
				`E 0 0 6  B6596A95A25CAF70  PUT - - 6`,
				`F 0 0 6  B6596A95A25CAF70  HLT - - -`,
				`0 0 8 6  B6596A95A25CAF70`,
			].join("\n"),
		);
	});

	test("test 3 - jump operations", () => {
		expect(run("0 0 0 0  B6A6564A70F71000", ["F", "9"])).toBe(
			[
				`0 0 0 0  B6A6564A70F71000  CCF - - -`,
				`1 0 0 0  B6A6564A70F71000  GET - F -`,
				`2 0 0 F  B6A6564A70F71000  ADC 6 - -`,
				`4 0 1 3  B6A6564A70F71000  STA 6 - -`,
				`6 0 1 3  B6A6563A70F71000  JNZ A - -`,
				`A 0 1 3  B6A6563A70F71000  FLA - - -`,
				`B 0 1 C  B6A6563A70F71000  PUT - - C`,
				`C 0 1 C  B6A6563A70F71000  JMP 0 - -`,
				`0 0 1 C  B6A6563A70F71000  CCF - - -`,
				`1 0 0 C  B6A6563A70F71000  GET - 9 -`,
				`2 0 0 9  B6A6563A70F71000  ADC 6 - -`,
				`4 0 0 C  B6A6563A70F71000  STA 6 - -`,
				`6 0 0 C  B6A656CA70F71000  SCF - - -`,
				`7 0 1 C  B6A656CA70F71000  ADC 7 - -`,
				`9 0 5 7  B6A656CA70F71000  HLT - - -`,
				`A 0 D 7  B6A656CA70F71000`,
			].join("\n"),
		);
	});

	test("detects a loop with no way out", () => {
		// JMP 0 forever
		const out = run("0 0 0 0  1000000000000000", []);
		expect(out.split("\n").at(-1)).toBe(
			"Runtime Error: Infinite loop detected",
		);
	});

	test("a loop containing GET is not flagged", () => {
		// GET, JMP 0: runs until inputs are gone
		const out = run("0 0 0 0  6100000000000000", ["1", "1"]);
		expect(out).toContain("Starved of inputs");
		expect(out).not.toContain("Infinite");
	});
});
