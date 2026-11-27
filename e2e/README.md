# E2E tests

End-to-end coverage for `@supabase/server`: real GoTrue-issued JWTs, real JWKS
validation over HTTP, and real Supabase client operations. Coverage spans the
four framework bridges (Hono, H3, Elysia, NestJS), the core `withSupabase`
fetch wrapper on Node, and the real Deno edge runtime, the programming model
Supabase Edge Functions use.

The framework apps import their bridge straight from `examples/frameworks/`,
so this suite covers the exact files the [frameworks
guide](https://supabase.com/docs/reference/server/frameworks) tells consumers
to copy into their own projects.

Unlike the unit/integration tests (mocked env, `jwks: null`), this suite:

- imports the library from `dist/`, not `src/`, so packaging regressions fail here
- reads config from `process.env` via `resolveEnv()` — no mocked env objects
- verifies JWTs against the local stack's live JWKS endpoint — including
  rejecting a forged token (real `kid`, wrong signing key), so signature
  verification itself is exercised, not just structure checks
- covers both context clients: `supabaseAdmin` (app-layer scoping) and the
  user-scoped `supabase` client, where the caller's JWT travels to PostgREST
  and a Postgres RLS policy scopes the rows
- runs each app on a real HTTP server and asserts over `fetch`

## Running locally

```sh
pnpm build                  # e2e imports from dist/
pnpm vendor:e2e             # packs dist/ for the edge function's import map
cd e2e && supabase start    # local stack (Docker) on ports 5433x
cd .. && pnpm gen:env       # writes e2e/.env from `supabase status`
pnpm test:e2e
```

Run a single app with `pnpm test:e2e h3`.

## Layout

- `supabase/` — local stack config + `notes` table migration
- `apps/<framework>/app.ts` — minimal app per framework, built on that
  framework's bridge from `examples/frameworks/`. Every app serves the same
  route surface:
  - `GET /health` — public, no entries
  - `GET /me` — `withRequiredClaims`
  - `GET /me-optional` — `withClaims`, anonymous allowed through with
    `jwtClaims: null`
  - `GET|POST /notes` — gated, admin client scoped by `jwtClaims.sub`
  - `GET /my-notes` — user, RLS-scoped client with no WHERE clause
  - `GET /all-notes` — user, admin client with no filter, which proves the
    admin client is not scoped to the caller
- `apps/core/app.ts` — same surface on the core `withSupabase(config, handler)`
  fetch wrapper (no bridge) — what an Edge Function deploys, running on Node.
  Plus `GET /my-notes-pg` (user, `pipeline([withSupabase({ auth: 'user' }), withPostgresClient()], …)` — a real `pg`
  connection, same unfiltered query, rows scoped by RLS alone). Only the core
  and edge apps carry this route: `pg` needs raw TCP, which is precisely the
  runtime claim under test.
- `supabase/functions/server-e2e/` — the same surface again, but on the real
  Deno edge runtime, served by `supabase start` through the Kong gateway and
  covered by `edge.e2e.ts`. Imports the library from a vendored `pnpm pack`
  artifact (`pnpm vendor:e2e` → `functions/_vendor/`, gitignored) — the exact
  bytes `npm publish` ships. `verify_jwt = false` in `supabase/config.toml`
  keeps the gateway's JWT pre-check out of the way so the middleware's own
  401 behavior is what the scenarios exercise. Needs Supabase CLI ≥ 2.109 —
  older local edge runtimes don't inject the new-key env
  (`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` / `SUPABASE_JWKS`)
  the library reads.
- `scenarios.ts` — the single scenario set run against every app
  (`runAppScenarios`), plus `runPostgresScenarios` for the `ctx.postgres`
  route, run only by `core.e2e.ts` and `edge.e2e.ts`
- `apps/claims.ts` — rebuilds the `{ id, email, role }` identity view from the
  raw `jwtClaims` the entries contribute. `sub` carries what `id` carried.
- `setup/global-setup.ts` — checks the stack is up, signs in two test users,
  provides their tokens to the tests
- `scripts/gen-env.sh` — writes `.env` (gitignored) from the running stack
- `scripts/get-token.ts` — prints a real user JWT for manual curl testing:
  `TOKEN=$(node e2e/scripts/get-token.ts)` (Node 22.18+)

Elysia is Bun-first, but its `app.handle` is a plain fetch handler, so the app
runs behind a `node:http` server (via `srvx`) and CI needs no Bun.
