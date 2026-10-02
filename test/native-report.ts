// bun test/native-report.ts [name...]   -> pass/fail per golden; with names, show a diff
import { cases } from "./native-lib";
import { writeFileSync } from "node:fs";

const want = new Set(process.argv.slice(2));
const all = await cases();
let pass = 0;
const failing: string[] = [];
for (const c of all) {
  let actual: string;
  try {
    actual = c.actual();
  } catch (e) {
    actual = `THROWN: ${(e as Error).stack}`;
  }
  const ok = actual === c.expected;
  if (ok) pass++;
  else failing.push(c.name);
  if (want.has(c.name)) {
    writeFileSync(`/tmp/golden-${c.name}.actual`, actual);
    writeFileSync(`/tmp/golden-${c.name}.expected`, c.expected);
    console.log(`--- ${c.name}: ${ok ? "ok" : "DIFF"}  (diff /tmp/golden-${c.name}.{expected,actual})`);
  }
}
console.log(`${pass}/${all.length} pass`);
if (!want.size) console.log("failing:", failing.join(" "));
