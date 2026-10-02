// Statement handlers: typing, print, anf, dnf, simplify, cost, definition.
import type { Ctx } from "./ctx";
import type { Message } from "./doc";
import type { NameStmt, CostStmt, DefinitionStmt } from "./ast";

const todo = (what: string): Message[] => [{ level: "internal", doc: `${what} is not implemented yet` }];

export function runTyping(_c: Ctx, s: NameStmt): Message[] { return todo(s.k); }
export function runPrint(_c: Ctx, s: NameStmt): Message[] { return todo(s.k); }
export function runAnf(_c: Ctx, s: NameStmt): Message[] { return todo(s.k); }
export function runDnf(_c: Ctx, s: NameStmt): Message[] { return todo(s.k); }
export function runSimplify(_c: Ctx, s: NameStmt): Message[] { return todo(s.k); }
export function runCost(_c: Ctx, s: CostStmt): Message[] { return todo(s.k); }
export function runDefinition(_c: Ctx, s: DefinitionStmt): Message[] { return todo(s.k); }
