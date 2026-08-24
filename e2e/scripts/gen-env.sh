#!/usr/bin/env bash
# Writes e2e/.env from the running local stack (`supabase start` in e2e/).
# These are the standard variable names @supabase/server reads via
# resolveEnv() — exactly what you'd set on Vercel / Cloudflare / Railway.
set -euo pipefail

e2e_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$e2e_dir"

eval "$(supabase status -o env | sed 's/^/export SB_/')"

cat > .env <<EOF
# LOCAL-ONLY, gitignored. Regenerate with: pnpm gen:env
SUPABASE_URL=$SB_API_URL
SUPABASE_PUBLISHABLE_KEY=$SB_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=$SB_SECRET_KEY
SUPABASE_JWKS_URL=$SB_API_URL/auth/v1/.well-known/jwks.json
SUPABASE_ANON_KEY=$SB_ANON_KEY
# Read by withPostgresClient (@supabase/server/middleware/postgres) for its direct
# pg connection. On the edge runtime the CLI injects its own container-
# reachable value; this one is for the Node apps on the host.
SUPABASE_DB_URL=$SB_DB_URL
EOF

echo "Wrote e2e/.env"
