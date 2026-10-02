#!/usr/bin/env bun
import { run } from "./src/run";
import { defaultOptions, parseOptions } from "./src/options";

const USAGE = `usage: syrup [options] <file.syrup>

  --format plain|syrup|html   output style (default plain)
  --syrup                     upstream-style plaintext (ascii-bordered tables)
  --html                      the markup the playground page uses
  -q, --quiet                 hide "is defined" notices
  --source-dot                print Graphviz source for \`display\` instead of rendering`;

const args = process.argv.slice(2);
const flags: string[] = [];
let path: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--format") flags.push(a, args[++i] ?? "");
  else if (a.startsWith("-")) flags.push(a);
  else path = a;
}
if (!path) {
  console.error(USAGE);
  process.exit(1);
}

const opts = parseOptions(defaultOptions, flags);
if (typeof opts === "string") {
  console.error(`syrup: ${opts}\n${USAGE}`);
  process.exit(1);
}

const source = await Bun.file(path).text();
const { log, errorCount, output } = run(source, opts);

if (opts.format === "plain") {
  for (const block of log) {
    console.log(block);
    console.log();
  }
} else if (output) {
  console.log(output);
}

if (errorCount) process.exit(1);
