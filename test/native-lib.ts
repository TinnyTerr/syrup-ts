// Shared by native.test.ts and native-report.ts: run one golden case.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/run";
import { parseOptions, defaultOptions } from "../src/options";

export const DIR = join(import.meta.dir, "native");

export interface Case {
  name: string;
  expected: string;
  actual: () => string;
}

export async function cases(): Promise<Case[]> {
  const names = readdirSync(DIR).filter((f) => f.endsWith(".syrup")).map((f) => f.slice(0, -6)).sort();
  const out: Case[] = [];
  for (const name of names) {
    const src = await Bun.file(join(DIR, `${name}.syrup`)).text();
    const flagsFile = Bun.file(join(DIR, `${name}.flags`));
    const flags = (await flagsFile.exists()) ? (await flagsFile.text()).split(/\s+/).filter(Boolean) : [];
    // goldens are upstream's output: its plaintext unless --html is given
    const parsed = parseOptions({ ...defaultOptions, format: "syrup" }, flags);
    if (typeof parsed === "string") throw new Error(`${name}: ${parsed}`);
    out.push({
      name,
      expected: await Bun.file(join(DIR, `${name}.out`)).text(),
      actual: () => run(src, parsed).output,
    });
  }
  return out;
}

/** Names of goldens we don't match yet; trimmed as features land. */
export async function knownFailures(): Promise<Set<string>> {
  const f = Bun.file(join(DIR, "known-failures.txt"));
  if (!(await f.exists())) return new Set();
  return new Set((await f.text()).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
}
