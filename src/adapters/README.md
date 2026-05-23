# Adapters

You're in the adapter source folder. Framework adapters wrap `withSupabase` and `createSupabaseContext` for a specific framework's middleware contract — Hono middleware, H3 event handlers, and so on. Implementations live next to this README under `<name>/`; reference docs live at [`docs/adapters/<name>.md`](../../docs/adapters/).

## Available adapters

| Framework | Import                             | Framework version | Docs                                                     |
| --------- | ---------------------------------- | ----------------- | -------------------------------------------------------- |
| Hono      | `@supabase/server/adapters/hono`   | `^4.0.0`          | [docs/adapters/hono.md](../../docs/adapters/hono.md)     |
| H3 / Nuxt | `@supabase/server/adapters/h3`     | `^2.0.0`          | [docs/adapters/h3.md](../../docs/adapters/h3.md)         |
| Elysia    | `@supabase/server/adapters/elysia` | `^1.4.0`          | [docs/adapters/elysia.md](../../docs/adapters/elysia.md) |

The framework version reflects what the adapter is tested against. It must match the corresponding entry in [`package.json#peerDependencies`](../../package.json) — if you bump the peer-dep range, update this table too.

## Community-maintained

**Every adapter listed above is community-maintained.** Hono, H3, and Elysia all originated as community contributions. Adapters live in this repo and ship with the core package, so users get them with a single `npm install @supabase/server` — no separate package per framework.

The Supabase team reviews PRs, runs security and regression triage, and ships releases. The original contributor of an adapter is the de-facto domain expert and is expected to be the first responder on framework-version bumps and bug reports for that adapter.

## Contributing a new adapter

Before you start, **read [`CONTRIBUTING.md`](../../CONTRIBUTING.md) and agree with it.** That covers the development setup, code style, commit conventions, and PR process. The points below are _additional_ requirements specific to adapter contributions.

**Code quality bar:**

- **Tests for every auth mode.** Cover `'user'`, `'publishable'`, `'secret'`, `'none'`, the array form, and the failure paths (missing token, invalid JWT, missing apikey). The Hono adapter's [`hono/middleware.test.ts`](hono/middleware.test.ts) is the canonical reference — your test file should look structurally similar.
- **Strict TypeScript.** No `any`, no `// @ts-ignore`. Public types must be exported from the adapter's `index.ts` so consumers can extend them.
- **No new runtime dependencies** beyond the framework you're adapting. The framework itself goes in `peerDependencies` (and `peerDependenciesMeta` if optional). Don't pull in a wrapper, polyfill, or utility lib just to make the adapter shorter.
- **Match the existing adapter shape.** Export `withSupabase` with two call forms — `withSupabase(config)` returning the framework's native middleware/plugin, and `withSupabase(config, handler)` returning a dual-mode route handler built via [`defineAdapter`](../core/adapters/define-adapter.ts) (see [Designing an adapter](#designing-an-adapter) below). Use `verifyAuth`, `createContextClient`, and `createAdminClient` from `@supabase/server/core` — never re-implement auth or env handling inside an adapter.
- **Wire up the build outputs.** Add the adapter entry to `package.json#exports`, `jsr.json` (if applicable), and `tsdown.config.ts#entry` so it ships in the published artifact.
- **Docs are required.** Add `docs/adapters/<name>.md` mirroring the structure of [`docs/adapters/hono.md`](../../docs/adapters/hono.md) — at minimum: setup, basic example, per-route auth, CORS note.
- **Update both adapter tables.** Add a row to the table in this `src/adapters/README.md` _and_ the mirror table in the top-level [`README.md`](../../README.md). Keep the framework-version column accurate against `package.json#peerDependencies`. PRs that touch an existing adapter must update the version column if the peer-dep range changed.

The Supabase team will review the PR against these requirements. Once merged, the adapter ships in the next release as part of `@supabase/server` — no separate package, no extra install for users. As the original contributor, you're expected to be the first responder on framework-version bumps and bug reports for your adapter.

## Designing an adapter

Every adapter has two call forms. They share a name (`withSupabase`) but solve different problems and are implemented differently:

### One-arg form — bespoke per framework

`withSupabase(config)` returns framework-native middleware/plugin (e.g. Hono `MiddlewareHandler`, H3 `Middleware`, Elysia plugin). This is the form users apply with `app.use(...)`. Each framework has its own:

- middleware/plugin construction (`createMiddleware`, `defineMiddleware`, `new Elysia().resolve(...)`),
- context-population idiom (`c.set('supabaseContext', ctx)`, `event.context.supabaseContext = ctx`, `.resolve(() => ({ supabaseContext: ctx }))`),
- error-throw shape (`HTTPException`, `HTTPError`, a registered custom error class for Elysia).

There's no useful shared abstraction here — the divergence is structural. Mirror the existing adapter that's closest to your framework's idiom.

Common contract every one-arg implementation must uphold:

- **Skip if a previous middleware already set `supabaseContext`.** Enables route-level overrides via scoped/grouped middleware. See [`hono/middleware.ts`](hono/middleware.ts) for the canonical check.
- **Throw a framework-native error on auth failure**, not a returned Response. The error must carry the original `AuthError` as `.cause` so users can discriminate on `cause.code` / `cause.status` in their `onError` hook.
- **Exclude `cors` from the config type** (`Omit<WithSupabaseConfig, 'cors'>`). CORS belongs to the framework's CORS middleware/plugin, not to the adapter.

### Two-arg form — use `defineAdapter`

`withSupabase(config, handler)` returns a dual-mode route handler that accepts either a `Request` (Web Fetch use) or the framework's native route input (`Context`, `H3Event`, Elysia args), extracts the underlying Request, and runs base `withSupabase` against it. Mountable directly via `app.all(path, withSupabase(config, handler))`.

Don't hand-roll this — [`defineAdapter`](../core/adapters/define-adapter.ts) (exported publicly as `@supabase/server/core/adapters`) encapsulates the entire dual-mode contract, including:

- Request extraction from the framework's native input.
- `cors: false` forced on the base call (the framework owns CORS).
- Optional skip-if-set: when an upstream middleware already populated `supabaseContext`, the inner handler runs with that context instead of re-verifying.
- Optional `throwAuthError`: surfaces auth failures through the framework's error pipeline, matching the one-arg form's behavior.

Wire it up at the top of your adapter file:

```ts
// In-tree (bundled adapters in this repo):
import { defineAdapter } from '../../core/adapters/index.js'

// Third-party adapter published as its own npm package:
// import { defineAdapter } from '@supabase/server/core/adapters'

const adapterWithSupabase = defineAdapter<MyFrameworkContext>({
  name: 'my-framework',
  extractRequest: (ctx) => ctx.request, // required
  getExistingContext: (ctx) => ctx.var?.supabaseContext, // optional: skip-if-set
  throwAuthError: (error) => {
    throw new MyFrameworkError(error) // optional: framework-native errors
  },
})
```

Then in your `withSupabase` implementation, the two-arg branch is one line:

```ts
if (handler) return adapterWithSupabase(config!, handler)
```

The two-arg overload's config type is `Omit<WithSupabaseConfig, 'cors' | 'onAuthError'>` — `defineAdapter` controls both internally. See [`hono/middleware.ts`](hono/middleware.ts) for the canonical pattern.

### Shared rules across both forms

- Keep all auth logic in `@supabase/server/core` — adapters only translate request/response shapes between the framework and the core primitives.
- The one-arg and two-arg forms must agree on behavior: same skip semantics, same framework-native error on auth failure, same CORS exclusion. `defineAdapter`'s hooks exist specifically to keep them in sync.
