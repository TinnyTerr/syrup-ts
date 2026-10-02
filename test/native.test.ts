import { test, expect } from "bun:test";
import { cases, knownFailures } from "./native-lib";

const known = await knownFailures();

for (const c of await cases()) {
  const t = known.has(c.name) ? test.skip : test;
  t(`native: ${c.name}`, () => {
    expect(c.actual()).toBe(c.expected);
  });
}
