import { test, expect } from "bun:test";
import { run } from "./run";

test("not/and/or/xor prelude truth tables", () => {
  const { log, errorCount } = run("experiment xor\nexperiment and\nexperiment or\nexperiment not");
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
    ].join("\n")
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
    ["Simulation for `dff2`:", "  0 {0} 1 -> 0", "  1 {1} 1 -> 1", "  2 {1} 0 -> 1", "  3 {0}"].join("\n")
  );
});
