import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./run";
import { DotBuilder } from "./dot";
import { graphicalCell } from "./display";
import type { Ty } from "./ast";
import { BIT, cable } from "./ast";
import type { Value } from "./values";

const NATIVE = join(import.meta.dir, "..", "test", "native");
const read = (f: string) => readFileSync(join(NATIVE, f), "latin1");
const jsonDots = (s: string) =>
  [...s.matchAll(/const dot_(\d+) = ("(?:[^"\\]|\\.)*");/g)].map((m) => JSON.parse(m[2]!) as string);

// ids are the order of definition, counting from 4 (nand, dff, zero, srff come first)
function builderFor(file: string, defined: string[], unfold: string[] = []): DotBuilder {
  const { registry } = run(read(file));
  defined.forEach((n, i) => ((registry.get(n) as { id?: number }).id = 4 + i));
  return new DotBuilder(registry, new Set(unfold));
}

test("dot: adc2par-html goldens, byte for byte", () => {
  const order = ["not", "and", "or", "nor", "xor", "hadd", "fadd", "adc2", "one", "mux", "adc2par"];
  const b = builderFor("adc2par-html.syrup", order);
  const want = jsonDots(read("adc2par-html.out"));
  const shown = ["not", "and", "or", "nor", "xor", "hadd", "fadd", "adc2", "one", "mux", "adc2par"];
  shown.forEach((n, i) => expect(b.dot(n)).toBe(want[i]!));
});

test("dot: unfolding a sub-circuit (diagram-source golden)", () => {
  const golden = read("diagram-source.out");
  const parts = golden.split(/Displaying `[^`]*`[^:\n]*:\n/).slice(1).map((p) => p.replace(/\n+$/, "\n"));
  const plain = builderFor("diagram-source.syrup", ["not", "or"]);
  expect(plain.dot("not")).toBe(parts[0]!);
  expect(plain.dot("or")).toBe(parts[1]!);
  const unfolded = builderFor("diagram-source.syrup", ["not", "or"], ["not"]);
  expect(unfolded.dot("or")).toBe(parts[2]!);
});

test("display: stubbed callees give a warning instead of a diagram", () => {
  const { output } = run("g(<Bit>) -> <Bit>\nf(<Bit>) -> <Bit>\n\nf(X) = g(X)\n\ndisplay f", { format: "syrup" });
  expect(output).toContain("When displaying `f`:\n  I don't have an implementation for `g`.");
});

test("display: primitives and stubs have no implementation to draw", () => {
  const { output } = run("display nand", { format: "syrup" });
  expect(output).toBe("Warning: I don't have an implementation for `nand`.\n");
});

// -- graphical cells --------------------------------------------------------

const seg7: Ty = { ...cable(Array.from({ length: 7 }, () => BIT)), alias: "7Segments" };
const braille: Ty = { ...cable(Array.from({ length: 6 }, () => BIT)), alias: "Braille" };

test("graphicalCell: one 7-segment display (7segments golden, X=0 row)", () => {
  const g = read("7segments.out");
  const want = /<tr><td><code>0<\/code><\/td><td><code><\/code><\/td><td>(<div style="display: flex[^]*?<\/div><\/div>)<\/td><\/tr>/.exec(g)![1]!;
  const cell = graphicalCell(seg7, [1, 1, 1, 0, 1, 1, 1], true)!;
  expect(cell.html).toBe(want);
  expect(cell.w).toBe(7);
});

test("graphicalCell: braille (braille golden, X=0 row)", () => {
  const g = read("braille.out");
  const want = /<tr><td><code>0<\/code><\/td><td><code><\/code><\/td><td>(<div style="display: flex[^]*?<\/div><\/div>)<\/td>/.exec(g)![1]!;
  expect(graphicalCell(braille, [0, 1, 1, 1, 0, 0], true)!.html).toBe(want);
});

test("graphicalCell: a cable of displays is bracketed and space separated", () => {
  const two = cable([seg7, seg7]);
  const d: Value = [1, 1, 1, 0, 1, 1, 1];
  const cell = graphicalCell(two, [d, d], true)!;
  expect(cell.w).toBe(14);
  expect(cell.html!.startsWith('<div style="display: flex; align-items: center;">[<div class="syrup-7segmentsdisplay">')).toBe(true);
  expect(cell.html!.endsWith("</div>]</div>")).toBe(true);
  expect(cell.html!).toContain("</div> <div class=\"syrup-7segmentsdisplay\">");
});

test("graphicalCell: plain bits and text formats are left alone", () => {
  expect(graphicalCell(cable([BIT, BIT]), [0, 1], true)).toBeUndefined();
  expect(graphicalCell(seg7, [1, 1, 1, 0, 1, 1, 1], false)).toBeUndefined();
});
