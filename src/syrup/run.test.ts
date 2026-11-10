import { expect, test } from "bun:test";
import type { Options } from "./options";
import { run as run0 } from "./run";

const run = (s: string, o: Partial<Options> = {}) =>
	run0(s, { presets: ["gates"], ...o });

test("not/and/or/xor prelude truth tables", () => {
	const { log, errorCount } = run(
		"experiment xor\nexperiment and\nexperiment or\nexperiment not",
	);
	expect(errorCount).toBe(0);
	expect(log[0]).toContain("00 | 0");
	expect(log[0]).toContain("01 | 1");
	expect(log[0]).toContain("10 | 1");
	expect(log[0]).toContain("11 | 0");
});

test("half adder / full adder / 2-bit adder from the manual", () => {
	const src = `
hadd(<Bit>,<Bit>) -> <Bit>,<Bit>
hadd(X1,Y1) = C2,S1 where
  C2 = X1 & Y1
  S1 = xor(X1,Y1)

fadd(<Bit>,<Bit>,<Bit>) -> <Bit>,<Bit>
fadd(X1,Y1,C1) = C2,Z1 where
  D2,D1 = hadd(X1,Y1)
  E2,Z1 = hadd(D1,C1)
  C2 = xor(D2,E2)

experiment fadd
`;
	const { log, errorCount } = run(src);
	expect(errorCount).toBe(0);
	expect(log[2]).toBe(
		[
			"Truth table for `fadd`:",
			"  000 | 00",
			"  001 | 01",
			"  010 | 01",
			"  011 | 10",
			"  100 | 01",
			"  101 | 10",
			"  110 | 10",
			"  111 | 11",
		].join("\n"),
	);
});

test("cables: 2-bit adder-with-carry", () => {
	const src = `
hadd(<Bit>,<Bit>) -> <Bit>,<Bit>
hadd(X1,Y1) = X1 & Y1, xor(X1,Y1)

fadd(<Bit>,<Bit>,<Bit>) -> <Bit>,<Bit>
fadd(X1,Y1,C1) = C2,Z1 where
  D2,D1 = hadd(X1,Y1)
  E2,Z1 = hadd(D1,C1)
  C2 = xor(D2,E2)

adc2([<Bit>,<Bit>],[<Bit>,<Bit>],<Bit>) -> <Bit>,[<Bit>,<Bit>]
adc2([X2,X1],[Y2,Y1],C1) = C4,[Z2,Z1] where
  C2,Z1 = fadd(X1,Y1,C1)
  C4,Z2 = fadd(X2,Y2,C2)

experiment adc2([11] [10] 1)
`;
	const { log, errorCount } = run(src);
	expect(errorCount).toBe(0);
	// 3 + 2 + 1 = 6 = 1[10]
	expect(log[3]).toContain("[11][10]1 -> 1[10]");
});

test("dff and hand-built srff-based register are equivalent", () => {
	const src = `
dff2(<Bit>) -> <Bit>
dff2(D) = srff(D,!D)

experiment dff = dff2
`;
	const { log, errorCount } = run(src);
	expect(errorCount).toBe(0);
	expect(log[1]).toContain("`dff` behaves like `dff2`");
});

test("or is not equivalent to xor", () => {
	const { log, errorCount } = run("experiment xor = or");
	expect(errorCount).toBe(0);
	expect(log[0]).toContain("does not match");
});

test("duplicate pattern names are rejected", () => {
	const { log, errorCount } = run("f(<Bit>,<Bit>) -> <Bit>\nf(X,X) = X");
	expect(errorCount).toBe(1);
	expect(log[0]).toContain("redefining the local variable X");
});

test("wildcard '_' may repeat in patterns but not appear as an expression", () => {
	const src = `
garbage(<Bit>,<Bit>,<Bit>,<Bit>) -> <Bit>
garbage(_, _, X, _) = Z where
  [_, Z, _] = [X,X,X]

experiment garbage
`;
	const { log, errorCount } = run(src);
	expect(errorCount).toBe(0);
	expect(log[1]).toContain("0010 | 1");
});

test("time-sequence simulation on a dff", () => {
	const src = `
dff2(<Bit>) -> <Bit>
dff2(D) = srff(D,!D)

experiment dff2(1;1;0)
`;
	const { log, errorCount } = run(src);
	expect(errorCount).toBe(0);
	expect(log[1]).toBe(
		[
			"Simulation for `dff2`:",
			"  0 {0} 1 -> 0",
			"  1 {1} 1 -> 1",
			"  2 {1} 0 -> 1",
			"  3 {0}",
		].join("\n"),
	);
});

test("nothing is predefined without presets", () => {
	const { errorCount } = run0("experiment not");
	expect(errorCount).toBeGreaterThan(0);
});

test("custom presets can be defined and enabled", () => {
	const presetDefs = { inv: "inv(<Bit>) -> <Bit>\ninv(X) = nand(X,X)" };
	expect(
		run0("experiment inv", { presetDefs, presets: ["inv"] }).errorCount,
	).toBe(0);
	expect(run0("experiment inv", { presetDefs }).errorCount).toBeGreaterThan(0);
	expect(
		run0("experiment inv", { presets: ["nope"] }).errorCount,
	).toBeGreaterThan(0);
});

test("tests run against the program and are reported", () => {
	const src = "inv(<Bit>) -> <Bit>\ninv(X) = nand(X,X)";
	const good = run0(src, {
		tests: "experiment inv(0) = 1\nexperiment forall X -> inv(inv(X)) = X",
	});
	expect(good.tests.passed).toBe(2);
	expect(good.tests.failed).toBe(0);
	const bad = run0(src, { tests: "experiment inv(0) = 0" });
	expect(bad.tests.failed).toBe(1);
	expect(bad.errorCount).toBeGreaterThan(0);
});

test("partial truth table tests, syrup and js", () => {
	const src = "xor2(<Bit>,<Bit>) -> <Bit>\nxor2(A,B) = (A & !B) | (!A & B)\n";
	const o = { presets: ["gates"] };
	const a = run0(src, {
		...o,
		tests: "table xor2\n  01 | 1\n  1_ | _\n  11 | 1",
	});
	expect([a.tests.passed, a.tests.failed]).toEqual([3, 1]);
	const b = run0(src, {
		...o,
		testsLang: "js",
		tests:
			'table("xor2", {"11":"0"}); test("x", () => assert(row("xor2","10")==="1"))',
	});
	expect([b.tests.passed, b.tests.failed]).toEqual([2, 0]);
});
