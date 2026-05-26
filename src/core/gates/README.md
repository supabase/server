# `@supabase/server/core/gates`

Similar to how `withSupabase(config, handler)` takes a config and a handler and hands the handler a `ctx` (with `ctx.supabase`, `ctx.userClaims`, …), a **gate** is a wrapper of the same shape — `withFoo(config, handler)` — that runs against the inbound `Request` and contributes its own typed key to `ctx`. Stack gates by direct nesting; the innermost handler sees a flat `ctx` aggregated from every wrapper around it. No separate composer.

Gates are how `@supabase/server` is extended past auth. Anyone can publish one as a standalone npm package; the built-in `withFeatureFlag` sits alongside third-party gates with no special status, all built on the same `defineGate` primitive. And because every gate is a plain `(req, ctx) => Response` wrapper over the Web Fetch API, the same gate runs unchanged across every runtime `@supabase/server` supports — Workers, Deno, Bun, Node — and inside every framework adapter (Hono, H3, Elysia) via the adapter's two-arg `withSupabase(config, handler)` form. See [Using gates with framework adapters](#using-gates-with-framework-adapters) below.

This module exports:

- **`defineGate`** — for _gate authors_ writing a new integration.

## Quick start (consumer)

```ts
import { withSupabase } from '@supabase/server'
import { withFeatureFlag } from '@supabase/server/gates/feature-flag'

export default {
  fetch: withSupabase(
    { auth: 'user' },
    withFeatureFlag(
      { name: 'beta', evaluate: (req) => req.headers.has('x-beta') },
      async (req, ctx) => {
        // ctx.supabase, ctx.userClaims  — from withSupabase
        // ctx.featureFlag                — from withFeatureFlag
        return Response.json({
          user: ctx.userClaims!.id,
          variant: ctx.featureFlag.variant,
        })
      },
    ),
  ),
}
```

Standalone (no `withSupabase`):

```ts
export default {
  fetch: withFeatureFlag(
    { name: 'beta', evaluate: (req) => req.headers.has('x-beta') },
    async (req, ctx) => Response.json({ flag: ctx.featureFlag.name }),
  ),
}
```

## The `ctx` shape

Inside a gated handler, ctx is a flat intersection — each gate contributes a typed key:

| Key                                                      | Set by                         | Mutability              |
| -------------------------------------------------------- | ------------------------------ | ----------------------- |
| `ctx.supabase`, `ctx.userClaims`, etc.                   | `withSupabase` (when wrapping) | read-only by convention |
| `ctx.<gate-key>` (e.g. `ctx.featureFlag`, `ctx.payment`) | the corresponding gate         | read-only by convention |

Two type-level guarantees:

- **Collision detection.** If a gate tries to compose where the upstream already has its key, the gate's call returns a `Conflict<Key>` sentinel string. Using the result where a fetch handler is expected fails to typecheck — error surfaces at the offending gate's call site.
- **Prerequisite enforcement.** Gates declare the upstream shape they require via `In`. The wrapper constrains `Base extends In`. Composing the gate where the upstream doesn't provide those keys is a type error. A gate that declares prerequisites can't be the top-level handler — it has to be nested inside a wrapper (e.g. `withSupabase`, or another gate) that supplies those keys.

## Composition rules

Two things to know when stacking gates:

1. **Outer runs first.** Each gate is a fetch-handler wrapper, so the outermost wrapper sees the request first and its contribution appears on `ctx` for everything it wraps. Reverse the order and any inner gate that declared an outer's key as a prerequisite won't compile.

2. **Either a `Response` or a contribution — not both.** A gate's `run` returns either a `Response` (handed back to the caller in place of the inner handler) or a contribution `{ [key]: … }` (fall through). A returned `Response` isn't a "rejection" or an error — it can be any status (200, 302, 404, 503, …). Gates don't observe or wrap the inner handler's response either. Anything response-shaped — rate-limit headers, CORS, response envelopes — is the handler's job: it reads what it needs from `ctx` and `req` and builds the response itself. This keeps each gate's surface small and the response shape under one owner.

## Using gates with framework adapters

Each framework adapter (`@supabase/server/adapters/hono`, `/h3`, `/elysia`) exports `withSupabase` with two call shapes:

- **One arg** — `withSupabase(config)` — the framework-native middleware/plugin. See the per-adapter docs (`docs/adapters/*.md`).
- **Two args** — `withSupabase(config, handler)` — a dual-mode handler that accepts either a plain `Request` or the framework's native route context, extracts the underlying Request, and runs base `withSupabase` against it. Mount directly with `app.all(path, withSupabase(config, gate))` — no manual `c.req.raw` / `event.req` / `({ request })` extraction needed.

The two forms can coexist in one app — routes that just need auth use the one-arg middleware, routes that compose with gates use the two-arg handler.

```ts
import { Hono } from 'hono'
import { withSupabase } from '@supabase/server/adapters/hono'
import { withFeatureFlag } from '@supabase/server/gates/feature-flag'

const app = new Hono()

app.all(
  '/beta',
  withSupabase(
    { auth: 'user' },
    withFeatureFlag(
      { name: 'beta', evaluate: (req) => req.headers.has('x-beta') },
      async (_req, ctx) =>
        Response.json({ user: ctx.userClaims?.id, flag: ctx.featureFlag.name }),
    ),
  ),
)
```

The call site is identical across frameworks — H3 uses `app.all('/beta', withSupabase(...))`, Elysia uses `.all('/beta', withSupabase(...))`. Only the framework's own routing call varies. The gate stack itself is unchanged.

`Base` (the upstream ctx shape) is inferred through the gate's `Wrapped` signature, so the inner handler sees the full intersection `SupabaseContext & { gateA: … } & { gateB: … }`.

## Authoring a gate (`defineGate`)

A gate has a _key_ (its slot on `ctx`), an optional `In` (upstream prerequisites), a _contribution_ shape, and a _run_ function.

### No prerequisites

```ts
import { defineGate } from '@supabase/server/core/gates'

export interface FlagConfig {
  name: string
  evaluate: (req: Request) => boolean
}

export interface FlagState {
  enabled: boolean
}

export const withFeatureFlag = defineGate<
  'featureFlag', // Key
  FlagConfig, // Config
  {}, // In: no upstream prerequisites
  FlagState // Contribution: shape under ctx.featureFlag
>({
  key: 'featureFlag',
  run: (config) => async (req) => {
    const enabled = config.evaluate(req)
    if (!enabled) {
      return Response.json({ error: 'feature_disabled' }, { status: 404 })
    }
    return { featureFlag: { enabled } } // ← keyed slot, visible at ctx.featureFlag
  },
})
```

Used as:

```ts
withFeatureFlag({ name: 'beta', evaluate: ... }, async (req, ctx) => {
  return Response.json({ enabled: ctx.featureFlag.enabled })
})
```

### `run`'s shape

```ts
run: (config: Config) => (req: Request, ctx: In) =>
  Promise<Response | { [K in Key]: Contribution }>
```

The outer `(config) =>` is invoked once when the consumer constructs the gate. Initialize per-instance state (stores, clients, computed config) here. The inner `(req, ctx) =>` is invoked per-request.

Return a `Response` to short-circuit, or a single-key object `{ [key]: contribution }` to fall through. The runtime picks `result[key]` and ignores any other fields.

### Declaring upstream prerequisites

A gate that depends on upstream data declares it in `In`:

```ts
import type { UserClaims } from '@supabase/server'

export const withSubscription = defineGate<
  'subscription',
  { lookup: (userId: string) => Promise<Plan | null> },
  { userClaims: UserClaims | null }, // In: requires userClaims upstream
  { plan: Plan }
>({
  key: 'subscription',
  run: (config) => async (_req, ctx) => {
    if (!ctx.userClaims) {
      return Response.json({ error: 'unauthenticated' }, { status: 401 })
    }
    const plan = await config.lookup(ctx.userClaims.id)
    if (!plan) {
      return Response.json({ error: 'no_plan' }, { status: 402 })
    }
    return { subscription: { plan } }
  },
})
```

A consumer using this gate must supply `userClaims` upstream — typically by wrapping with `withSupabase`. Standalone use won't compile.

### Conflict detection

Two gates contributing the same key fail to compose. The inner `withFoo` returns `Conflict<'foo'>` (a sentinel string), which can't be used where a fetch handler is expected:

```ts
withFoo({...}, withFoo({...}, handler))  // type error: Conflict<'foo'> is not callable
```

Pick a different key for each gate. Gates that may be applied multiple times can accept a `key` config to override the default.

### Threading state through nested gates

When a gate is wrapped by another (e.g. `withSupabase(... withFeatureFlag(... handler))`), the outer's keys land on `Base` for the inner. TypeScript infers that `Base` through the nested fetch-handler signatures, so the handler sees the full accumulated `ctx` without explicit annotations.

```ts
withSupabase(
  { auth: 'user' },
  withFeatureFlag(
    { name: 'beta', evaluate: (req) => req.headers.has('x-beta') },
    async (_req, ctx) => {
      // ctx.userClaims    — from withSupabase
      // ctx.featureFlag   — from withFeatureFlag
      return Response.json({ user: ctx.userClaims!.id })
    },
  ),
)
```

For multi-gate stacks, keep nesting directly:

```ts
withSupabase({ auth: 'user' },
  withFeatureFlag(...,
    withMyGate(..., async (_req, ctx) => {
      // ctx.userClaims   — from withSupabase
      // ctx.featureFlag  — from withFeatureFlag
      // ctx.myGate       — from withMyGate
    }),
  ),
)
```

## API

| Export                                | Description                                                            |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `defineGate(spec)`                    | Author helper: declare a gate. Returns a `(config, handler)` callable. |
| `Conflict<Key>`                       | Sentinel string returned when a gate would shadow an upstream key.     |
| `Gate<Key, Config, In, Contribution>` | The shape of a gate produced by `defineGate`.                          |
