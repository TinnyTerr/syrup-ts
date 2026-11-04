#!/usr/bin/env bash
# Mirror the Obsidian plugin into a standalone repo (manifest.json in root) for the community marketplace.
# usage: scripts/sync-obsidian.sh ../syrup-obsidian
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
dst="${1:?target dir}"
mkdir -p "$dst/plugin"
rsync -a --delete "$src/src/" "$dst/src/"
rsync -a --delete "$src/shared/" "$dst/shared/"
cp "$src/obsidian/main.ts" "$src/obsidian/highlight.ts" "$dst/plugin/"
cp "$src/obsidian/manifest.json" "$src/obsidian/styles.css" "$src/obsidian/package.json" "$dst/"
cp "$src/LICENSE" "$dst/"
[ -f "$src/obsidian/versions.json" ] && cp "$src/obsidian/versions.json" "$dst/" || true
# bundled plugin imports ../src and ../shared relative to plugin/, so layout above needs no rewrites
cat > "$dst/tsconfig.json" <<'J'
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"], "target": "ESNext", "module": "Preserve", "moduleResolution": "bundler",
    "jsx": "react-jsx", "strict": true, "noEmit": true, "skipLibCheck": true,
    "verbatimModuleSyntax": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true,
    "allowImportingTsExtensions": true, "types": []
  },
  "include": ["plugin"]
}
J
sed -i 's#main.ts --outfile main.js#plugin/main.ts --outfile main.js#' "$dst/package.json"
sed -i 's#"private": true#"private": false#' "$dst/package.json"
# deps the shared src pulls in
node -e '
const f=process.argv[1],p=JSON.parse(require("fs").readFileSync(f));
const root=JSON.parse(require("fs").readFileSync(process.argv[2]));
p.dependencies=root.dependencies;p.devDependencies={...p.devDependencies,"@types/react":root.devDependencies["@types/react"],"@types/react-dom":root.devDependencies["@types/react-dom"]};
require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\n")' "$dst/package.json" "$src/package.json"
mkdir -p "$dst/.github/workflows"
cp "$src/scripts/obsidian-release.yml" "$dst/.github/workflows/release.yml"
printf 'node_modules\nmain.js\n' > "$dst/.gitignore"
echo "synced to $dst"
