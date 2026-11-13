import { describe, expect, test } from "bun:test";
import { testRun } from "./test";

describe("tiny machine execution loop testing", () => {
	test("test 1 - normal operation", () => {
		expect(
			testRun(
				"0 0 0 0  B6A6564A70F71000 ",
				["F", "9"],
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
			),
		).toBe("");
	});
	test("test 1.2 - normal operation", () => {
		expect(
			testRun(
				"0 0 0 0  B6A6564A70F71000 ",
				["F", "9"],
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
				].join("\n"),
			),
		).toBe("");
	});
	test("test 2 - expecting more", () => {
		expect(
			testRun(
				"0 0 0 0  B6A6564A70F71000 ",
				["F", "9"],
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
				].join("\n"),
			),
		).toBe("What next?");
	});

	test("test 3 - faithful error", () => {
		expect(
			testRun(
				"0 0 0 0  B6A6564A70F71000 ",
				["F", "9"],
				[
					`0 0 0 0 B6A6564A70F71000 CCF - - -`,
					`1 0 0 0 B6A6564A70F71000 GET - F -`,
					`2 0 0 F B6A6564A70F71000 ADC 6 - -`,
					`4 0 1 3 B6A6564A70F71000 STA 6 - -`,
					`6 0 1 3 B6A6563A70F71000 JNZ A - -`,
					`A 0 1 3 B6A6563A70F71000 FLA - - -`,
					`B 0 1 C B6A6563A70F71000 PUT - - C`,
					`C 0 1 C B6A6563A70F71000 JMP 0 - -`,
					`0 0 1 C B6A6563A70F71000 CCF - - -`,
					`1 0 0 C B6A6563A70F71000 GET - 9 -`,
					`2 0 0 9 B6A6563A70F71055          `,
				].join("\n"),
			),
		).toBe("Configuration discrepancy: [14] and [15] ");
	});
});
