import {
  splitStatementsDetailed, parseChunk, ParseError, builtinAliases, type TypeAliases,
} from "./parser";
import { newRegistry, registerDef, RuntimeError, type Registry } from "./eval";
import { toMermaid } from "./diagram";
import { PRELUDE } from "./prelude";
import { defaultOptions, type Options } from "./options";
import type { Ctx } from "./ctx";
import { checkDef } from "./check";
import type { Decl, Def, Stmt } from "./ast";
import {
  type Message, type Doc, br, seq, code, circ, indent, lines, sepBy, ty as tyD,
  mergeDefined, messageText, renderMessagesText, renderMessagesHtml,
} from "./doc";
import { tyDoc } from "./pretty";
import { runTruth, runEquiv, runSim, runUnit, runForall } from "./exp";
import { runDisplay } from "./display";
import {
  runTyping, runPrint, runAnf, runDnf, runSimplify, runCost, runDefinition,
} from "./transforms";

export interface RunResult {
  /** one entry per message, in the default (plain) format */
  log: string[];
  errorCount: number;
  registry: Registry;
  /** structured messages, before any merging of "is defined" notices */
  messages: Message[];
  /** the whole output rendered in `options.format` */
  output: string;
}

const err = (doc: Doc, extra: Partial<Message> = {}): Message => ({ level: "error", doc, ...extra });
const warn = (doc: Doc, extra: Partial<Message> = {}): Message => ({ level: "warning", doc, ...extra });

const lc = (s: string): Doc => seq(code(s));

class Engine {
  reg: Registry = newRegistry();
  aliases: TypeAliases = builtinAliases();
  msgs: Message[] = [];
  errorCount = 0;
  defCount = 0;
  // declarations still waiting for their definition, in declaration order
  pending = new Map<string, Decl>();
  lastDecl: string | undefined;
  deferred: Array<() => void> = [];
  queuedLint: Message[] = [];

  constructor(public opts: Options, public user: boolean) {}

  get ctx(): Ctx {
    return { reg: this.reg, aliases: this.aliases, opts: this.opts };
  }

  push(...ms: Message[]): void {
    for (const m of ms) {
      if (m.level === "error" && !m.noCount) this.errorCount++;
      if (m.define && this.opts.quiet) continue;
      this.msgs.push(m);
    }
  }

  // -- parse errors -------------------------------------------------------

  parseFailure(chunk: string, e: ParseError): Message {
    if (e.looking === undefined || e.pos === undefined || !e.because) return err(e.message);
    const before = chunk.slice(0, e.pos);
    const after = chunk.slice(e.pos);
    const hoping = e.because.k === "hoping";
    const stuck = `${hoping ? "... " : ""}${before} {HERE} ${after} ${hoping ? " ..." : ""}`.replace(/ $/, hoping ? "" : " ");
    const why =
      e.because.k === "unexpected"
        ? "it made sense, but then I found stuff I didn't expect."
        : e.because.k === "begin"
          ? "I didn't know where to begin."
          : `I was hoping for ${e.because.hoping} but I found ${e.because.found} which vexed me.`;
    return err(
      seq(
        "I was trying to make sense of the following code:", br, indent(chunk), br,
        "I got stuck here: ", br, indent(stuck), br,
        `I was looking for ${e.looking}.`, br, `At that point, ${why}`,
      ),
      { legacy: `Error: ${e.message}` },
    );
  }

  // -- statements ---------------------------------------------------------

  run(src: string): void {
    let chunks: { text: string; blankBefore: boolean }[];
    try {
      chunks = splitStatementsDetailed(src);
    } catch (e) {
      if (e instanceof ParseError) {
        this.push(err(e.message));
        return;
      }
      throw e;
    }
    for (const c of chunks) this.item(c.text, c.blankBefore);
    this.finish();
  }

  item(chunk: string, blankBefore = false): void {
    let stmt: Stmt;
    try {
      stmt = parseChunk(chunk, this.aliases);
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      const m = this.parseFailure(chunk, e);
      // a malformed definition is reported at once; other junk waits like experiments do
      if (/=/.test(chunk.replace(/->/g, "")) || this.pending.size === 0) this.push(m);
      else this.deferred.push(() => this.push(m));
      return;
    }
    switch (stmt.k) {
      case "decl":
        // consecutive declarations are a forward-declaration block; a decl after a gap ends it
        if (blankBefore) this.flushPending();
        return this.decl(stmt);
      case "def": return this.def(stmt);
      case "typeDef":
        this.push({
          level: "comment", doc: seq("Type ", code(tyD(`<${stmt.name}>`)), " is defined."),
          define: { kind: "type", name: stmt.name },
        });
        return;
      default:
        if (this.pending.size > 0) this.deferred.push(() => this.statement(stmt));
        else this.statement(stmt);
    }
  }

  finish(): void {
    this.flushPending();
  }

  // declarations that never got a definition: report them, then let waiting statements run
  flushPending(): void {
    if (this.pending.size === 0) return;
    this.push(...this.queuedLint.splice(0));
    for (const [name] of this.pending) {
      this.push(err(seq("You haven't defined the circuit ", circ(name), " just now.")));
      this.push(warn(seq("Circuit ", circ(name), " has been stubbed out.")));
    }
    this.pending.clear();
    this.runDeferred();
  }

  runDeferred(): void {
    const ds = this.deferred.splice(0);
    for (const d of ds) d();
  }

  decl(d: Decl): void {
    const old = this.reg.get(d.name);
    if (old && !old.prelude) {
      this.push(err(seq("You are redefining the top-level variable ", d.name, ".")));
    }
    this.reg.set(d.name, { name: d.name, ins: d.ins, outs: d.outs, prev: old });
    this.pending.set(d.name, d);
    this.lastDecl = d.name;
  }

  def(def: Def): void {
    const decl = this.pending.get(def.name);
    const adjacent = this.lastDecl === def.name;
    this.lastDecl = undefined;
    if (!decl) {
      this.push(err(seq("You haven't declared the circuit ", circ(def.name), " just now.")));
      return;
    }
    this.pending.delete(def.name);
    this.check(def, decl, adjacent);
    if (this.pending.size === 0) this.runDeferred();
  }

  check(def: Def, decl: Decl, adjacent: boolean): void {
    const r = checkDef(def, decl, this.reg);
    const lint: Message[] = [];

    if (def.emptyWhere) {
      this.push(
        warn(seq(
          "Empty where clause in the definition of ", def.name, ".", br,
          "Did you forget to indent the block of local definitions using spaces?",
        )),
      );
    }
    const names = (xs: string[]) => sepBy(xs.map((x) => seq(x)), ", ");
    if (r.unused.length) {
      lint.push(warn(seq(
        r.unused.length === 1 ? "the wire " : "the wires ", names(r.unused),
        r.unused.length === 1 ? " is" : " are", " defined but never used.",
      )));
    }
    if (r.splits.length) {
      const ps = sepBy(r.splits.map((p) => seq(patText(p))), ", ");
      lint.push(warn(seq(
        r.splits.length === 1 ? "the cable " : "the cables ", ps,
        r.splits.length === 1 ? " is" : " are", " taken apart only to be reconstructed or unused.", br,
        "Did you consider giving each cable a name without breaking it up?",
      )));
    }

    const problems: Message[] = [];
    for (const d of r.dups) problems.push(err(seq("You are redefining the local variable ", d, ".")));
    for (const s of r.scope) {
      const hint = s.suggestions.length === 0 ? [] : [
        br,
        s.suggestions.length === 1
          ? `Did you mean: ${s.suggestions[0]}?`
          : `Did you mean one of these: ${s.suggestions.join(", ")}?`,
      ];
      problems.push(err(seq("You tried to use ", s.name, " but it is not in scope.", ...hint)));
    }

    if (r.arity && problems.length === 0) problems.push(err(r.arity));

    const failing = problems.length > 0 || r.holes.length > 0;
    if (failing && !adjacent) this.queuedLint.push(...lint);
    else this.push(...lint);

    if (problems.length) {
      const src = `${decl.src ?? ""}\n${def.src ?? ""}\n`;
      this.push(err(seq("I was trying to make sense of the following code:", br, indent(src)), {
        legacy: "",
        noCount: true,
      }));
      problems.forEach((p) => this.push({ ...p, tight: true }));
    }
    if (r.holes.length) {
      this.push(warn(seq(
        "Found holes in circuit ", circ(def.name), ":", br,
        indent(lines(r.holes.map((h) => seq(`?${h.name} : `, tyDoc(h.ty))))),
      )));
    }
    if (failing) {
      this.push(warn(seq("Circuit ", circ(def.name), " has been stubbed out.")));
      return;
    }

    try {
      registerDef(this.reg, def);
    } catch (e) {
      if (e instanceof RuntimeError) {
        this.push(err(e.message));
        return;
      }
      throw e;
    }
    if (!this.user) this.reg.get(def.name)!.prelude = true;
    else this.reg.get(def.name)!.id = 4 + this.defCount++;
    this.push({ level: "comment", doc: seq("Circuit ", circ(def.name), " is defined."), define: { kind: "circuit", name: def.name } });
    this.push(...this.queuedLint.splice(0));
  }

  statement(s: Stmt): void {
    try {
      this.push(...this.dispatch(s));
    } catch (e) {
      if (e instanceof RuntimeError || e instanceof ParseError) this.push(err(e.message));
      else throw e;
    }
  }

  dispatch(s: Stmt): Message[] {
    const c = this.ctx;
    switch (s.k) {
      case "expTruth": return runTruth(c, s.name);
      case "expEquiv": return runEquiv(c, s.a, s.b);
      case "expSim": return runSim(c, s);
      case "expUnit": return runUnit(c, s);
      case "expForall": return runForall(c, s);
      case "display": return runDisplay(c, s);
      case "typing": return runTyping(c, s);
      case "print": return runPrint(c, s);
      case "anf": return runAnf(c, s);
      case "dnf": return runDnf(c, s);
      case "simplify": return runSimplify(c, s);
      case "cost": return runCost(c, s);
      case "definition": return runDefinition(c, s);
      case "skip": return [warn(`(skipped unsupported \`${s.reason}\` command)`)];
      default: return [];
    }
  }
}

function patText(p: import("./ast").Pat): string {
  if (p.k === "var") return p.name;
  if (p.k === "wild") return "_";
  return `[${p.items.map(patText).join(", ")}]`;
}

export function run(userSource: string, options: Partial<Options> = {}): RunResult {
  const opts: Options = { ...defaultOptions, ...options };
  const eng = new Engine({ ...opts, quiet: false }, false);
  eng.run(PRELUDE); // discarded: prelude is not user output
  eng.msgs = [];
  eng.errorCount = 0;
  eng.user = true;
  eng.opts = opts;
  eng.run(userSource);

  const messages = eng.msgs;
  const log = messages
    .map((m) => (m.legacy !== undefined ? m.legacy : messageText(m)))
    .filter((s) => s !== "");
  const merged = mergeDefined(messages);
  const output =
    opts.format === "html" ? renderMessagesHtml(merged)
    : opts.format === "syrup" ? renderMessagesText(merged) + (merged.length ? "\n" : "")
    : log.join("\n\n");
  return { log, errorCount: eng.errorCount, registry: eng.reg, messages, output };
}

export { toMermaid };
