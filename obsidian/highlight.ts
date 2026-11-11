import { ASK_RULES as ASK_RULES_SRC } from "../shared/ask-tokens";
import { RULES as RULES_SRC } from "../shared/tokens";

// the token lists live in the syrup-ts checkout (copied in at release time); the
// shapes are spelled out here so nothing downstream is typed `any`
type SyrupRuleName =
	| "comment"
	| "type"
	| "keyword"
	| "builtin"
	| "func"
	| "number"
	| "operator"
	| "punctuation";
type AskRuleName =
	| "comment"
	| "string"
	| "success"
	| "primary"
	| "assumption"
	| "keyword"
	| "nonterminal"
	| "constructor"
	| "punctuation";

const RULES = RULES_SRC as Record<SyrupRuleName, string>;
const ASK_RULES = ASK_RULES_SRC as Record<AskRuleName, string>;

// Prism grammar, for our own rendering in reading view.
export const prismGrammar = {
	comment: new RegExp(RULES.comment),
	type: new RegExp(RULES.type),
	keyword: new RegExp(RULES.keyword),
	builtin: new RegExp(RULES.builtin),
	function: new RegExp(RULES.func),
	number: new RegExp(RULES.number),
	operator: new RegExp(RULES.operator),
	punctuation: new RegExp(RULES.punctuation),
};

// the parts of CodeMirror 5 Obsidian's editor still uses for fenced blocks
export interface CMStream {
	eatSpace(): boolean;
	eol(): boolean;
	match(pattern: string | RegExp): boolean | RegExpMatchArray | null;
	next(): string | void;
}

interface CodeMirrorStatic {
	defineMode(name: string, factory: (cfg: unknown) => object): void;
	getMode(cfg: unknown, spec: string): object;
	defineMIME?(mime: string, spec: string): void;
}

function codeMirror(): CodeMirrorStatic | undefined {
	return (window as Window & { CodeMirror?: CodeMirrorStatic }).CodeMirror;
}

// CodeMirror 5 mode. Token names map to cm-<name> classes.
const cmSources: [string, string][] = [
	["comment", RULES.comment],
	["type", RULES.type],
	["keyword", RULES.keyword],
	["builtin", RULES.builtin],
	["variable-2", RULES.func],
	["number", RULES.number],
	["operator", RULES.operator],
	["bracket", RULES.punctuation],
];
const cmRules = cmSources.map(([name, src]): [string, RegExp] => [name, new RegExp("^(?:" + src + ")")]);

export function defineCm5Mode(): boolean {
	const CM = codeMirror();
	if (!CM?.defineMode) return false;
	// every fence flavour highlights the same way
	for (const name of [
		"syrup-add",
		"syrup-compute",
		"syrup-compute-add",
		"syrup-add-compute",
	]) {
		CM.defineMode(name, (cfg) => CM.getMode(cfg, "syrup"));
	}
	CM.defineMode("syrup", () => ({
		token(stream: CMStream) {
			if (stream.eatSpace()) return null;
			for (const [name, re] of cmRules) if (stream.match(re)) return name;
			stream.next();
			return null;
		},
		lineComment: "--",
	}));
	CM.defineMIME?.("text/x-syrup", "syrup");
	return true;
}

// ask: block comments nest, which Prism can't do, so reading view only gets
// the flat approximation; the CM5 mode below tracks depth properly.
export const askPrismGrammar = {
	comment: new RegExp(`${ASK_RULES.comment}|\\{-[\\s\\S]*?-\\}`),
	string: new RegExp(ASK_RULES.string),
	success: new RegExp(ASK_RULES.success),
	primary: new RegExp(ASK_RULES.primary),
	assumption: new RegExp(ASK_RULES.assumption),
	keyword: new RegExp(ASK_RULES.keyword),
	type: new RegExp(ASK_RULES.nonterminal),
	constructor: new RegExp(ASK_RULES.constructor),
	punctuation: new RegExp(ASK_RULES.punctuation),
};

const askCmSources: [string, string][] = [
	["comment", ASK_RULES.comment],
	["string", ASK_RULES.string],
	["positive", ASK_RULES.success],
	["keyword", ASK_RULES.primary],
	["variable-3", ASK_RULES.assumption],
	["keyword", ASK_RULES.keyword],
	["tag", ASK_RULES.nonterminal],
	["variable-2", ASK_RULES.constructor],
	["bracket", ASK_RULES.punctuation],
];
const askCmRules = askCmSources.map(([name, src]): [string, RegExp] => [name, new RegExp("^(?:" + src + ")")]);

export function defineAskCm5Mode(): boolean {
	const CM = codeMirror();
	if (!CM?.defineMode) return false;
	CM.defineMode("ask", () => ({
		startState: () => ({ depth: 0 }),
		token(stream: CMStream, state: { depth: number }) {
			if (state.depth > 0) {
				while (!stream.eol()) {
					if (stream.match("{-")) state.depth++;
					else if (stream.match("-}")) {
						if (--state.depth === 0) break;
					} else stream.next();
				}
				return "comment";
			}
			if (stream.eatSpace()) return null;
			if (stream.match("{-")) {
				state.depth = 1;
				while (!stream.eol() && state.depth > 0) {
					if (stream.match("{-")) state.depth++;
					else if (stream.match("-}")) state.depth--;
					else stream.next();
				}
				return "comment";
			}
			for (const [name, re] of askCmRules) if (stream.match(re)) return name;
			stream.next();
			return null;
		},
		lineComment: "--",
		blockCommentStart: "{-",
		blockCommentEnd: "-}",
	}));
	CM.defineMIME?.("text/x-ask", "ask");
	return true;
}
