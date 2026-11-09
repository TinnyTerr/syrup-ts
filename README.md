# syrup

A from-scratch TypeScript/Bun implementation of [Syrup](https://github.com/pigworker/Syrup),
Conor McBride's small language for digital circuits, built from the language
manual (`doc/manual/Syrup.tex` in the original repo) rather than a port of the
Haskell implementation.

Supports declarations, definitions (with cables, multi-output components,
`!`/`&`/`|` sugar), and all three experiment forms from the manual: truth
tables, time-sequence simulation, and behavioural equivalence. `nand`,
`zero`, `dff`, and `srff` are the primitives. Nothing else is predefined:
`not`, `and`, `or`, `xor`, `one` live in the opt-in `gates` preset
(`src/syrup/prelude.ts`), and you can add your own presets (see Presets).

The evaluator is dynamically shaped rather than statically type-checked:
declared signatures drive experiment generation (arity, cable shapes for
pretty-printing) but component bodies are interpreted directly against
runtime value trees. Memory (`dff`/`srff`) isn't covered by the manual
(that section is marked "will appear soon"), so its output format here is
this implementation's own, not a port of anything.

## Usage

```bash
bun install
bun run index.ts path/to/circuit.syrup
```

### Presets

Presets are named bundles of definitions that are off until you enable them.

```bash
syrup --preset gates file.syrup                      # builtin
syrup --preset-def mine=mine.syrup --preset mine f.syrup   # your own
syrup --preset gates --no-preset gates f.syrup       # disable again
syrup --list-presets
```

Library: `run(src, { presets: ["mine"], presetDefs: { mine: "..." } })`.

### Tests

Tests are ordinary experiments (unit tests, `forall` properties, `f = g`)
kept apart from the program and run against it afterwards.

```bash
syrup --test tests.syrup circuit.syrup     # prints failures + a summary, exits 1 on failure
```

Tests can also be a `.js` file. Either way you can give only some rows of a
truth table; unlisted rows aren't checked. `_` in outputs is a don't-care, `_` in
inputs covers both 0 and 1 (brackets and spaces are ignored).

```
table xor                 # syrup
  01 | 1
  11 | 0
  1_ | _
```

```js
table("xor", { "01": "1", "11": "0" });   // or [["01","1"], ...]
row("xor", "10");                          // -> "1"
test("xor is symmetric", () => assert(row("xor","01") === row("xor","10")));
```

Library: `run(src, { tests: "...", testsLang: "js" }).tests` gives `{ passed, failed, results }`.
The web playground's presets, diagnostics, tests and registry panels are all hidden; press F9 to toggle them. The tests box with a live pass/fail count.

### Tiny Machine

The Tiny Machine parser is available from the separate `syrup-ts/tiny`
entrypoint. Its first format is one line containing four 4-hex-digit memory
words, a 3-letter operation, a 3-hex-digit operand, and an optional
comma-delimited input stream:

```ts
import { parseTinyMachine } from "syrup-ts/tiny";

parseTinyMachine("0000 00af 1234 ffff add 00c,1,2a");
```

### Output formats and flags

```bash
bun run index.ts [--format plain|syrup|html] [-q] [--source-dot] file.syrup
```

- `plain` (default) — compact plaintext, unchanged.
- `--syrup` — upstream's plaintext: ASCII-bordered tables, grouped
  "Circuits `a`, `b`, and `c` are defined." notices. With Graphviz's `dot`
  installed, `display` is drawn as svg; `--source-dot` prints the source instead.
- `--html` — the markup the original playground page uses (`syrup-*` classes,
  Graphviz loaded from a CDN for `display`). The web demo renders this.
- `-q` — hide "is defined" notices.

Beyond truth tables, simulation and `experiment f = g`, it supports unit tests
(`experiment f{0}(1) = {1}0`), property tests (`experiment forall X -> ...`),
holes (`?A`), `anf`, `dnf`, `simplify`, `cost [unfolded] f`, `definition f [X,Y] [bits]`,
`type f`, `print f`, `display [unfolded] f`, and `<7Segments>` / `<Braille>` outputs.
Definitions are checked for scope, redefinitions, dead wires, needlessly split
cables and holes, and failing ones are stubbed out.

## Tests

```bash
bun test                      # unit tests + the native goldens
bun test/native-report.ts     # pass/fail per golden (pass names to get a diff in /tmp)
```

`test/native/` holds the upstream Haskell implementation's golden files
(`.syrup` + `.flags` → `.out`). `test/native.test.ts` runs them in upstream's
plaintext (or html with `--html`); the ones we don't match byte-for-byte are
listed in `test/native/known-failures.txt` with the reason.

## Building

```bash
bun run build
```

Produces `dist/`:

- `dist/index.js` + `dist/index.d.ts` — the library (`run`, `newRegistry`,
  `truthTable`/`simulate`/`equivalence`, AST/value types), bundled for
  `--target browser` so it has no Bun- or Node-specific APIs and can be
  imported from a webpage, bundler, or any JS runtime.
- `dist/cli.js` — the CLI (`index.ts`), a standalone executable script for
  Bun (`./dist/cli.js path/to/circuit.syrup`, or invoke via the `syrup` bin
  once installed).

## Release workflow

`.github/workflows/build.yml` runs on request only (Actions tab -> build -> Run
workflow). It tests, then builds in parallel: the npm tarball, web assets
(`dist/web/syrup.js` global `Syrup` IIFE + `syrup.esm.js`), executables for
linux/mac/windows (x64 + arm64 where Bun supports it, with `SHA256SUMS`), the
Obsidian plugin files and the `.vsix`. Give it a `release_tag` to also cut a
GitHub release with everything attached. `publish_npm` needs an `NPM_TOKEN`
secret and `"private"` removed from `package.json`.

Locally: `bun run build:web`, `bun run build:exe`, `bun run build:editors`.

`.github/workflows/pages.yml` builds `dist/web` (including the React demo bundle)
plus `web/demo.html` and deploys the demo to GitHub Pages on pushes to `main`
(or manually from Actions -> pages -> Run workflow).

## Layout

- `src/syrup/lexer.ts`, `src/syrup/parser.ts` — tokenizer and recursive-descent parser
- `src/syrup/ast.ts` — AST types, plus the call-site indexing pass that gives every
  `dff`/`srff` instantiation a stable identity across simulation steps
- `src/syrup/eval.ts` — the interpreter (registry, pattern binding, demand-driven
  equation evaluation, primitives)
- `src/syrup/experiments.ts` — truth tables, time-sequence simulation, bisimulation-based
  equivalence checking
- `src/syrup/prelude.ts` — builtin presets (`gates`: `not`/`and`/`or`/`xor`/`one`, defined in Syrup itself)
- `src/syrup/run.ts` — the engine: pairs declarations with definitions, checks them
  (`src/syrup/check.ts`), runs statements and collects structured messages
- `src/syrup/doc.ts` — message/Doc model and the plain-text and html renderers
- `src/syrup/pretty.ts` — pretty printer for types, expressions and circuits
- `src/syrup/exp.ts` — truth tables, simulation, bisimulation, unit and property tests
- `src/syrup/transforms.ts`, `src/syrup/normal.ts`, `src/syrup/cost.ts` — typing/print/anf/dnf/simplify/cost/definition
- `src/syrup/display.ts`, `src/syrup/dot.ts` — `display` (Graphviz source) and 7-segment/braille cells
- `src/syrup/options.ts` — output format and flags
- `src/syrup/index.ts` — the library's public entry point (barrel export)
- `index.ts` — CLI entry point

## Editor integrations

Separate from the library and CLI; each has its own manifest and build, and
nothing in `src/` depends on them. `shared/tokens.ts` is the one token list
both highlighters use.

- `vscode/` — highlighting for `.syrup` files and ```` ```syrup ```` fences, and for `.ask` files (the CS103 proof assistant).
  `cd vscode && bun run package` regenerates the TextMate grammar
  (`shared/gen-textmate.ts`) and builds a `.vsix`.
- `obsidian/` — a ```` ```ask ```` block is highlighted only (tokens in `shared/ask-tokens.ts`). Syrup fences:
  `syrup` highlights only; `syrup-add` adds its code to the note's shared file (output hidden);
  `syrup-compute` runs the shared file above it plus itself and shows only its own output below
  (mermaid diagrams render natively); `syrup-compute-add` / `syrup-add-compute` do both.
  Blocks may sit in `%% ... %%` comments and still count.
  `cd obsidian && bun install && bun run build`, then copy or symlink
  `manifest.json`, `main.js`, `styles.css` into
  `<vault>/.obsidian/plugins/syrup/`. Editor (live preview) highlighting uses
  the legacy CodeMirror 5 mode API, which is untested against current Obsidian.
