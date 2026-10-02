import { test, expect } from "bun:test";
import { run } from "./run";

const PRE = `
not(<Bit>) -> <Bit>
not(X) = nand(X,X)
and(<Bit>, <Bit>) -> <Bit>
and(X,Y) = !nand(X,Y)
or(<Bit>, <Bit>) -> <Bit>
or(X,Y) = nand(!X,!Y)
`;
const out = (s: string) => run(PRE + s, { format: "syrup", quiet: true }).output;

test("simplify removes double negation", () => {
  expect(out("f(<Bit>) -> <Bit>\nf(X) = !!!X\nsimplify f")).toBe(
    "Simplification of `f`:\n  f(<Bit>) -> <Bit>\n  f(X) = !X\n",
  );
});

test("cost unfolds except for listed circuits", () => {
  expect(out("cost [] and")).toContain("2 copies of `nand`");
  expect(out("cost [not] or")).toContain("1 copy of `nand`\n  2 copies of `not`");
});

test("dnf of xor", () => {
  expect(out("x(<Bit>,<Bit>) -> <Bit>\nx(A,B) = A&!B | !A&B\ndnf x")).toContain("x(A, B) = A & !B | !A & B");
});

test("anf makes fan-out explicit", () => {
  expect(out("d(<Bit>) -> <Bit>\nd(X) = nand(X,X)\nanf d")).toContain("__VIRTUAL__1, __VIRTUAL__2 = [X, X]");
});

test("definition builds a circuit from a truth table", () => {
  expect(out("definition g [A] [1,0]")).toContain("g(A) = !A");
});
