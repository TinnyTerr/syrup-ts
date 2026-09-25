import { type Ty } from "./ast";
import {
  type Registry, runComponent, discoverMemPaths, RuntimeError,
} from "./eval";
import {
  type Bit, type Value, reshapeList, formatValue, formatValues,
  flattenValues, allBitCombos, widthOfTys,
} from "./values";

function stateKey(m: Map<string, Bit>, paths: string[]): string {
  return paths.map((p) => m.get(p) ?? 0).join("") || "-";
}

export function truthTable(reg: Registry, name: string): string {
  const c = reg.get(name);
  if (!c) throw new RuntimeError(`\`${name}\` is not declared`);
  if (!c.def && !c.isPrimitive) throw new RuntimeError(`Circuit \`${name}\` is a stub (has no definition).`);
  const memPaths = discoverMemPaths(reg, name);
  const width = widthOfTys(c.ins);
  const lines: string[] = [`Truth table for \`${name}\`:`];

  if (memPaths.length === 0) {
    for (const flat of allBitCombos(width)) {
      const inputs = reshapeList(flat, c.ins);
      const { outputs } = runComponent(reg, name, inputs, new Map());
      lines.push(`  ${formatValues(inputs)} | ${formatValues(outputs)}`);
    }
    return lines.join("\n");
  }

  lines.push(`  (stateful: ${memPaths.length} memory cell(s), state shown as {bits})`);
  for (const stateFlat of allBitCombos(memPaths.length)) {
    const mem = new Map<string, Bit>(memPaths.map((p, i) => [p, stateFlat[i]!]));
    const key = stateKey(mem, memPaths);
    for (const flat of allBitCombos(width)) {
      const inputs = reshapeList(flat, c.ins);
      const { outputs, nextMem } = runComponent(reg, name, inputs, mem);
      const nextKey = stateKey(nextMem, memPaths);
      lines.push(`  {${key}} ${formatValues(inputs)} -> ${formatValues(outputs)} {${nextKey}}`);
    }
  }
  return lines.join("\n");
}

export function simulate(reg: Registry, name: string, steps: Value[][]): string {
  const c = reg.get(name);
  if (!c) throw new RuntimeError(`\`${name}\` is not declared`);
  if (!c.def && !c.isPrimitive) throw new RuntimeError(`Circuit \`${name}\` is a stub (has no definition).`);
  const memPaths = discoverMemPaths(reg, name);
  const lines: string[] = [`Simulation for \`${name}\`:`];
  let mem = new Map<string, Bit>();
  steps.forEach((inputs, t) => {
    const key = stateKey(mem, memPaths);
    const { outputs, nextMem } = runComponent(reg, name, inputs, mem);
    lines.push(`  ${t} {${key}} ${formatValues(inputs)} -> ${formatValues(outputs)}`);
    mem = nextMem;
  });
  lines.push(`  ${steps.length} {${stateKey(mem, memPaths)}}`);
  return lines.join("\n");
}

export function equivalence(reg: Registry, a: string, b: string): string {
  const ca = reg.get(a);
  const cb = reg.get(b);
  if (!ca) throw new RuntimeError(`\`${a}\` is not declared`);
  if (!cb) throw new RuntimeError(`\`${b}\` is not declared`);
  if (!ca.def && !ca.isPrimitive) throw new RuntimeError(`Circuit \`${a}\` is a stub (has no definition).`);
  if (!cb.def && !cb.isPrimitive) throw new RuntimeError(`Circuit \`${b}\` is a stub (has no definition).`);

  const widthIn = widthOfTys(ca.ins);
  if (widthIn !== widthOfTys(cb.ins) || widthOfTys(ca.outs) !== widthOfTys(cb.outs)) {
    return `\`${a}\` and \`${b}\` are not comparable: different signal widths.`;
  }

  const pathsA = discoverMemPaths(reg, a);
  const pathsB = discoverMemPaths(reg, b);

  const relation = new Map<string, string>();
  const initA = new Map<string, Bit>();
  const initB = new Map<string, Bit>();
  relation.set(stateKey(initA, pathsA), stateKey(initB, pathsB));
  const worklist: Array<[Map<string, Bit>, Map<string, Bit>]> = [[initA, initB]];
  const pairsFound: string[] = [`\`{${stateKey(initA, pathsA)}}\` ~ \`{${stateKey(initB, pathsB)}}\``];

  while (worklist.length) {
    const [sa, sb] = worklist.pop()!;
    for (const flat of allBitCombos(widthIn)) {
      const inputsA = reshapeList(flat, ca.ins);
      const inputsB = reshapeList(flat, cb.ins);
      const ra = runComponent(reg, a, inputsA, sa);
      const rb = runComponent(reg, b, inputsB, sb);
      if (formatValues(ra.outputs) !== formatValues(rb.outputs)) {
        return [
          `\`${a}\` has a behaviour that \`${b}\` does not match:`,
          `  ${a}(${formatValues(inputsA)}) = ${formatValues(ra.outputs)} but ${b}(${formatValues(inputsB)}) = ${formatValues(rb.outputs)}`,
        ].join("\n");
      }
      const ka = stateKey(ra.nextMem, pathsA);
      const kb = stateKey(rb.nextMem, pathsB);
      const existing = relation.get(ka);
      if (existing === undefined) {
        relation.set(ka, kb);
        worklist.push([ra.nextMem, rb.nextMem]);
        pairsFound.push(`\`{${ka}}\` ~ \`{${kb}}\``);
      } else if (existing !== kb) {
        return [
          `\`${a}\` and \`${b}\` diverge in how their memory lines up:`,
          `  state {${ka}} of \`${a}\` matches both {${existing}} and {${kb}} of \`${b}\``,
        ].join("\n");
      }
    }
  }

  return [`\`${a}\` behaves like \`${b}\``, ...pairsFound.map((p) => `  ${p}`)].join("\n");
}
