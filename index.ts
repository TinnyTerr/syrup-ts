#!/usr/bin/env bun
import { run } from "./src/run";
import { BUILTIN_PRESETS } from "./src/prelude";
import { defaultOptions, parseOptions } from "./src/options";

const USAGE = `usage: syrup [options] <file.syrup>

  --format plain|syrup|html   output style (default plain)
  --syrup                     upstream-style plaintext (ascii-bordered tables)
  --html                      the markup the playground page uses
  --preset a,b                enable presets (builtin: gates); nothing is predefined by default
  --no-preset a,b             disable presets again
  --preset-def name=file      define your own preset from a .syrup file (then enable it with --preset)
  --test file                 run a file of tests (syrup: experiments, "table f" rows; or .js) against the program
  --list-presets              list the available presets
  -q, --quiet                 hide "is defined" notices
  --source-dot                print Graphviz source for \`display\` instead of rendering`;

const args = process.argv.slice(2);
const flags: string[] = [];
let path: string | undefined;
const testFiles: string[] = [];
const presetDefFlags: string[] = [];
let listPresets = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--format" || a === "--preset" || a === "--no-preset") flags.push(a, args[++i] ?? "");
  else if (a === "--preset-def") presetDefFlags.push(args[++i] ?? "");
  else if (a.startsWith("--preset-def=")) presetDefFlags.push(a.slice(13));
  else if (a === "--test") testFiles.push(args[++i] ?? "");
  else if (a.startsWith("--test=")) testFiles.push(a.slice(7));
  else if (a === "--list-presets") listPresets = true;
  else if (a.startsWith("-")) flags.push(a);
  else path = a;
}
const presetDefs: Record<string, string> = {};
for (const d of presetDefFlags) {
  const eq = d.indexOf("=");
  if (eq < 1) {
    console.error(`syrup: --preset-def wants name=file, got '${d}'`);
    process.exit(1);
  }
  presetDefs[d.slice(0, eq)] = await Bun.file(d.slice(eq + 1)).text();
}
if (listPresets) {
  for (const n of Object.keys({ ...BUILTIN_PRESETS, ...presetDefs })) console.log(n);
  process.exit(0);
}
if (!path) {
  console.error(USAGE);
  process.exit(1);
}

const opts = parseOptions({ ...defaultOptions, presetDefs }, flags);
if (typeof opts === "string") {
  console.error(`syrup: ${opts}\n${USAGE}`);
  process.exit(1);
}

// plaintext formats draw `display` through Graphviz when it is installed
const renderDot = (dot: string): string => {
  const r = Bun.spawnSync(["dot", "-Tsvg"], { stdin: new TextEncoder().encode(dot) });
  return r.exitCode === 0 ? r.stdout.toString() : dot;
};
if (opts.format === "syrup" && Bun.which("dot")) opts.renderDot = renderDot;

const isJs = (f: string) => /\.[cm]?js$/.test(f);
if (testFiles.some(isJs) && !testFiles.every(isJs)) {
  console.error("syrup: --test files must be all .js or all syrup");
  process.exit(1);
}
opts.testsLang = testFiles.length && testFiles.every(isJs) ? "js" : "syrup";
opts.tests = (await Promise.all(testFiles.map((f) => Bun.file(f).text()))).join("\n\n");
const source = await Bun.file(path).text();
const { log, errorCount, output, tests } = run(source, opts);

if (opts.format === "plain") {
  for (const block of log) {
    console.log(block);
    console.log();
  }
} else if (output) {
  console.log(output);
}

if (testFiles.length) {
  for (const t of tests.results.filter((t) => !t.ok)) console.error(t.text + "\n");
  console.error(`tests: ${tests.passed} passed, ${tests.failed} failed`);
}
if (errorCount || tests.failed) process.exit(1);
