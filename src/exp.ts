// Statement handlers for experiments: truth tables, simulation,
// bisimulation, unit tests and property tests.
import type { Ctx } from "./ctx";
import type { Message } from "./doc";
import type { ExpSim, ExpUnit, ExpForall } from "./ast";
import type { Value } from "./values";
import { truthTable, simulate, equivalence } from "./experiments";

const plain = (s: string): Message => ({ level: "happy", doc: s, legacy: s });

export function runTruth(c: Ctx, name: string): Message[] { return [plain(truthTable(c.reg, name))]; }
export function runEquiv(c: Ctx, a: string, b: string): Message[] { return [plain(equivalence(c.reg, a, b))]; }
export function runSim(c: Ctx, s: ExpSim): Message[] { return [plain(simulate(c.reg, s.name, s.steps as Value[][]))]; }
export function runUnit(_c: Ctx, _s: ExpUnit): Message[] { return [{ level: "internal", doc: "unit tests are not implemented yet" }]; }
export function runForall(_c: Ctx, _s: ExpForall): Message[] { return [{ level: "internal", doc: "property tests are not implemented yet" }]; }
