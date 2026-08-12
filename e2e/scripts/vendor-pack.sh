#!/usr/bin/env bash
# Vendors the packed library into the edge functions directory. The edge
# runtime container mounts only e2e/supabase/functions/, so the function
# cannot import the repo-root dist/ directly. `pnpm pack` produces the exact
# artifact `npm publish` would ship — the suite keeps testing built output.
# Requires `pnpm build` first.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
vendor_dir="$repo_root/e2e/supabase/functions/_vendor"

if [ ! -f "$repo_root/dist/index.mjs" ]; then
  echo "dist/index.mjs not found — run \`pnpm build\` first" >&2
  exit 1
fi

rm -rf "$vendor_dir"
mkdir -p "$vendor_dir"

tarball="$(pnpm --dir "$repo_root" pack --pack-destination "$vendor_dir" | tail -n1)"
tar -xzf "$tarball" -C "$vendor_dir"
rm "$tarball"

echo "Vendored $(basename "$tarball") -> ${vendor_dir#"$repo_root/"}/package"
