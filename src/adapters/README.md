# Adapters

You're in the adapter source folder. Framework adapters wrap `withSupabase` and `createSupabaseContext` for a specific framework's middleware contract — Hono middleware, H3 event handlers, and so on. Implementations live next to this README under `<name>/`; reference docs live at [`docs/adapters/<name>.md`](../../docs/adapters/).

## Available adapters

| Framework | Import                           | Framework version | Docs                                                 |
| --------- | -------------------------------- | ----------------- | ---------------------------------------------------- |
| Hono      | `@supabase/server/adapters/hono` | `^4.0.0`          | [docs/adapters/hono.md](../../docs/adapters/hono.md) |
| H3 / Nuxt | `@supabase/server/adapters/h3`   | `^2.0.0`          | [docs/adapters/h3.md](../../docs/adapters/h3.md)     |

The framework version reflects what the adapter is tested against. It must match the corresponding entry in [`package.json#peerDependencies`](../../package.json) — if you bump the peer-dep range, update this table too.

## Community-maintained

**Every adapter listed above is community-maintained.** Both Hono and H3 originated as community contributions. Adapters live in this repo and ship with the core package, so users get them with a single `npm install @supabase/server` — no separate package per framework.

The Supabase team reviews PRs, runs security and regression triage, and ships releases. The original contributor of an adapter is the de-facto domain expert and is expected to be the first responder on framework-version bumps and bug reports for that adapter.

## Contributing a new adapter

Before you start, **read [`CONTRIBUTING.md`](../../CONTRIBUTING.md) and agree with it.** That covers the development setup, code style, commit conventions, and PR process. The points below are _additional_ requirements specific to adapter contributions.

**Code quality bar:**

- **Tests for every auth mode.** Cover `'user'`, `'publishable'`, `'secret'`, `'none'`, the array form, and the failure paths (missing token, invalid JWT, missing apikey). The Hono adapter's [`hono/middleware.test.ts`](hono/middleware.test.ts) is the canonical reference — your test file should look structurally similar.
- **Strict TypeScript.** No `any`, no `// @ts-ignore`. Public types must be exported from the adapter's `index.ts` so consumers can extend them.
- **No new runtime dependencies** beyond the framework you're adapting. The framework itself goes in `peerDependencies` (and `peerDependenciesMeta` if optional). Don't pull in a wrapper, polyfill, or utility lib just to make the adapter shorter.
- **Match the existing adapter shape.** Export `withSupabase(config, handler)` returning the framework's native middleware/handler type. Use `verifyAuth`, `createContextClient`, and `createAdminClient` from `@supabase/server/core` — never re-implement auth or env handling inside an adapter.
- **Wire up the build outputs.** Add the adapter entry to `package.json#exports`, `jsr.json` (if applicable), and `tsdown.config.ts#entry` so it ships in the published artifact.
- **Docs are required.** Add `docs/adapters/<name>.md` mirroring the structure of [`docs/adapters/hono.md`](../../docs/adapters/hono.md) — at minimum: setup, basic example, per-route auth, CORS note.
- **Update both adapter tables.** Add a row to the table in this `src/adapters/README.md` _and_ the mirror table in the top-level [`README.md`](../../README.md). Keep the framework-version column accurate against `package.json#peerDependencies`. PRs that touch an existing adapter must update the version column if the peer-dep range changed.

The Supabase team will review the PR against these requirements. Once merged, the adapter ships in the next release as part of `@supabase/server` — no separate package, no extra install for users. As the original contributor, you're expected to be the first responder on framework-version bumps and bug reports for your adapter.

## Designing an adapter

The existing adapters at [`hono/middleware.ts`](hono/middleware.ts) and [`h3/middleware.ts`](h3/middleware.ts) (siblings of this README) are the canonical templates. The shape every adapter exposes is `withSupabase(config, handler)` returning a framework-native middleware. Keep all auth logic in `@supabase/server/core` — adapters should only translate request/response shapes between the framework and the core primitives.
