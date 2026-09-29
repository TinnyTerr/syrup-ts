# syrup

A from-scratch TypeScript/Bun implementation of [Syrup](https://github.com/pigworker/Syrup),
Conor McBride's small language for digital circuits, built from the language
manual (`doc/manual/Syrup.tex` in the original repo) rather than a port of the
Haskell implementation.

Supports declarations, definitions (with cables, multi-output components,
`!`/`&`/`|` sugar), and all three experiment forms from the manual: truth
tables, time-sequence simulation, and behavioural equivalence. `nand`,
`zero`, `dff`, and `srff` are the primitives; `not`, `and`, `or`, `xor`, and
`one` are defined from `nand` in Syrup itself (`src/prelude.ts`).

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

## Tests

```bash
bun test
```

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

## Layout

- `src/lexer.ts`, `src/parser.ts` — tokenizer and recursive-descent parser
- `src/ast.ts` — AST types, plus the call-site indexing pass that gives every
  `dff`/`srff` instantiation a stable identity across simulation steps
- `src/eval.ts` — the interpreter (registry, pattern binding, demand-driven
  equation evaluation, primitives)
- `src/experiments.ts` — truth tables, time-sequence simulation, bisimulation-based
  equivalence checking
- `src/prelude.ts` — `not`/`and`/`or`/`xor`/`one`, defined in Syrup itself
- `src/run.ts` — ties parsing + registration + experiments together, one
  statement at a time so a later syntax error doesn't lose earlier results
- `src/index.ts` — the library's public entry point (barrel export)
- `index.ts` — CLI entry point

## Editor integrations

Separate from the library and CLI; each has its own manifest and build, and
nothing in `src/` depends on them. `shared/tokens.ts` is the one token list
both highlighters use.

- `vscode/` — highlighting for `.syrup` files and ```` ```syrup ```` fences.
  `cd vscode && bun run package` regenerates the TextMate grammar
  (`shared/gen-textmate.ts`) and builds a `.vsix`.
- `obsidian/` — a ```` ```syrup ```` block runs the program and shows the
  highlighted source, then the output (mermaid diagrams render natively).
  `cd obsidian && bun install && bun run build`, then copy or symlink
  `manifest.json`, `main.js`, `styles.css` into
  `<vault>/.obsidian/plugins/syrup/`. Editor (live preview) highlighting uses
  the legacy CodeMirror 5 mode API, which is untested against current Obsidian.
