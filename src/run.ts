import { splitStatements, parseChunk, ParseError } from "./parser";
import { newRegistry, registerDecl, registerDef, RuntimeError, type Registry } from "./eval";
import { truthTable, simulate, equivalence } from "./experiments";
import { toMermaid } from "./diagram";
import { PRELUDE } from "./prelude";
import type { Value } from "./values";

export interface RunResult {
  log: string[]; // output and errors, interleaved in program order
  errorCount: number;
  registry: Registry;
}

function loadStatements(reg: Registry, src: string, log: string[]): number {
  let chunks: string[];
  let errorCount = 0;
  try {
    chunks = splitStatements(src);
  } catch (e) {
    if (e instanceof ParseError) {
      log.push(`Error: ${e.message}`);
      return 1;
    }
    throw e;
  }

  for (const chunk of chunks) {
    try {
      const stmt = parseChunk(chunk);
      switch (stmt.k) {
        case "decl":
          registerDecl(reg, stmt);
          break;
        case "def":
          registerDef(reg, stmt);
          log.push(`Circuit \`${stmt.name}\` is defined.`);
          break;
        case "expTruth":
          log.push(truthTable(reg, stmt.name));
          break;
        case "expEquiv":
          log.push(equivalence(reg, stmt.a, stmt.b));
          break;
        case "expSim":
          log.push(simulate(reg, stmt.name, stmt.steps as Value[][]));
          break;
        case "display":
          log.push("```mermaid\n" + toMermaid(reg, stmt.name) + "\n```");
          break;
        case "skip":
          log.push(`(skipped unsupported \`${stmt.reason}\` command)`);
          break;
      }
    } catch (e) {
      if (e instanceof RuntimeError || e instanceof ParseError) {
        log.push(`Error: ${e.message}`);
        errorCount++;
      } else {
        throw e;
      }
    }
  }
  return errorCount;
}

export function run(userSource: string): RunResult {
  const reg = newRegistry();
  const preludeLog: string[] = [];
  loadStatements(reg, PRELUDE, preludeLog); // discarded: prelude is not user output
  const log: string[] = [];
  const errorCount = loadStatements(reg, userSource, log);
  return { log, errorCount, registry: reg };
}
