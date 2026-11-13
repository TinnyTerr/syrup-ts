#!/usr/bin/env bun
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";

const BANNER =
	"/* Made by tinnyterr (tinnyterr@tinnyterr.com) Licenced under GPL-3.0-only */";

const args = new Set(Bun.argv.slice(2));
const hasFlags = args.size > 0;
const buildAll = args.has("--all");
const buildLib =
	buildAll || args.has("--lib") || (!hasFlags && !args.has("--help"));
const buildCli =
	buildAll || args.has("--cli") || (!hasFlags && !args.has("--help"));
const buildWeb = buildAll || args.has("--web");
const buildObsidian = buildAll || args.has("--obsidian");
const buildVscode = buildAll || args.has("--vscode");

if (args.has("--help") || args.has("-h")) {
	console.log(`
Usage: bun run build [options]

Options:
  --lib        Build Syrup and Tiny libraries + TypeScript declarations (default)
  --cli        Build Syrup CLI binary script (default)
  --web        Build browser bundles and demo assets
  --obsidian   Build Obsidian plugin and sync to ../syrup-obsidian
  --vscode     Package VS Code extension (.vsix)
  --all        Build all targets
  --clean      Clean dist directory before building
  --help, -h   Show this help message
`);
	process.exit(0);
}

const rootDir = resolve(import.meta.dir, "..");

// Ensure dist exists / clean
if (args.has("--clean") || (!hasFlags && !args.has("--help")) || buildAll) {
	console.log("🧹 Cleaning dist/...");
	rmSync(resolve(rootDir, "dist"), { recursive: true, force: true });
}

// 1. Core Libraries
if (buildLib) {
	console.log("📦 Building core libraries (syrup + tiny)...");
	const [syrupResult, tinyResult] = await Promise.all([
		Bun.build({
			entrypoints: [resolve(rootDir, "src/syrup/index.ts")],
			outdir: resolve(rootDir, "dist"),
			target: "browser",
			format: "esm",
			banner: BANNER,
			external: ["mermaid"],
		}),
		Bun.build({
			entrypoints: [resolve(rootDir, "src/tiny/index.ts")],
			naming: "tiny.js",
			outdir: resolve(rootDir, "dist"),
			target: "browser",
			format: "esm",
			banner: BANNER,
		}),
	]);

	if (!syrupResult.success) {
		console.error("❌ Failed to build syrup library:", syrupResult.logs);
		process.exit(1);
	}
	if (!tinyResult.success) {
		console.error("❌ Failed to build tiny library:", tinyResult.logs);
		process.exit(1);
	}

	console.log("📝 Generating type declarations...");
	await $`bunx tsc -p tsconfig.build.json`.cwd(rootDir);
	await $`bunx tsc -p tsconfig.tiny-build.json`.cwd(rootDir);
}

// 2. CLI
if (buildCli) {
	console.log("💻 Building CLI...");
	const cliResult = await Bun.build({
		entrypoints: [resolve(rootDir, "index.ts")],
		naming: "cli.js",
		outdir: resolve(rootDir, "dist"),
		target: "bun",
		format: "esm",
		banner: BANNER,
		external: ["mermaid"],
	});

	if (!cliResult.success) {
		console.error("❌ Failed to build CLI:", cliResult.logs);
		process.exit(1);
	}

	const cliPath = resolve(rootDir, "dist/cli.js");
	chmodSync(cliPath, 0o755);
}

// 3. Web assets
if (buildWeb) {
	console.log("🌐 Building web distribution & demo...");
	const webDist = resolve(rootDir, "dist/web");
	mkdirSync(webDist, { recursive: true });

	const [esmResult, iifeResult, demoResult] = await Promise.all([
		Bun.build({
			entrypoints: [resolve(rootDir, "src/syrup/index.ts")],
			naming: "syrup.esm.js",
			outdir: webDist,
			target: "browser",
			format: "esm",
			minify: true,
			banner: BANNER,
		}),
		Bun.build({
			entrypoints: [resolve(rootDir, "web/global.ts")],
			naming: "syrup.js",
			outdir: webDist,
			target: "browser",
			format: "iife",
			minify: true,
		}),
		Bun.build({
			entrypoints: [resolve(rootDir, "web/demo.tsx")],
			naming: "demo.js",
			outdir: webDist,
			target: "browser",
			format: "esm",
			minify: true,
		}),
	]);

	if (!esmResult.success || !iifeResult.success || !demoResult.success) {
		console.error("❌ Failed to build web assets");
		process.exit(1);
	}

	cpSync(resolve(rootDir, "web/demo.css"), resolve(webDist, "demo.css"));
}

// 4. Obsidian Plugin
if (buildObsidian) {
	console.log("💎 Building Obsidian plugin...");
	const obsResult = await Bun.build({
		entrypoints: [resolve(rootDir, "obsidian/main.ts")],
		naming: "main.js",
		outdir: resolve(rootDir, "obsidian"),
		target: "node",
		format: "cjs",
		external: ["obsidian", "electron"],
	});

	if (!obsResult.success) {
		console.error("❌ Failed to build Obsidian plugin:", obsResult.logs);
		process.exit(1);
	}

	// Sync to ../syrup-obsidian if the directory exists
	const extObsidianDir = resolve(rootDir, "../syrup-obsidian");
	if (existsSync(extObsidianDir)) {
		console.log("🔄 Syncing to ../syrup-obsidian...");
		cpSync(
			resolve(rootDir, "obsidian/main.js"),
			resolve(extObsidianDir, "main.js"),
		);
		cpSync(
			resolve(rootDir, "obsidian/manifest.json"),
			resolve(extObsidianDir, "manifest.json"),
		);
		cpSync(
			resolve(rootDir, "obsidian/styles.css"),
			resolve(extObsidianDir, "styles.css"),
		);
		if (existsSync(resolve(extObsidianDir, "plugin"))) {
			cpSync(
				resolve(rootDir, "obsidian/main.ts"),
				resolve(extObsidianDir, "plugin/main.ts"),
			);
			cpSync(
				resolve(rootDir, "obsidian/highlight.ts"),
				resolve(extObsidianDir, "plugin/highlight.ts"),
			);
		}
	}
}

// 5. VS Code extension
if (buildVscode) {
	console.log("🔌 Packaging VS Code extension...");
	await $`bun ./shared/gen-textmate.ts`.cwd(rootDir);
	await $`bunx @vscode/vsce package --no-dependencies`.cwd(
		resolve(rootDir, "vscode"),
	);
}

console.log("✅ Build finished successfully!");
