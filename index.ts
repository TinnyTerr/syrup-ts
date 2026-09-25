#!/usr/bin/env bun
import { run } from "./src/run";

const path = process.argv[2];
if (!path) {
  console.error("usage: syrup <file.syrup>");
  process.exit(1);
}

const source = await Bun.file(path).text();
const { log, errorCount } = run(source);

for (const block of log) {
  console.log(block);
  console.log();
}

if (errorCount) process.exit(1);
