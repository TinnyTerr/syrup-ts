#!/usr/bin/env bash
# Sync the Obsidian marketplace repo's plugin-only files. Plugin source (src/, shared/) is NOT copied:
# the marketplace release workflow checks it out from this repo at the matching tag.
# usage: scripts/sync-obsidian.sh ../syrup-obsidian
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
dst="${1:?target dir}"
mkdir -p "$dst/plugin" "$dst/.github/workflows"
cp "$src/obsidian/main.ts" "$src/obsidian/highlight.ts" "$dst/plugin/"
cp "$src/obsidian/manifest.json" "$src/obsidian/styles.css" "$dst/"
cp "$src/LICENSE" "$dst/"
[ -f "$src/obsidian/versions.json" ] && cp "$src/obsidian/versions.json" "$dst/" || true
cp "$src/scripts/obsidian-release.yml" "$dst/.github/workflows/release.yml"
echo "synced to $dst"
