# `@supabase/server/core/gates`

Composable preconditions for fetch handlers. A **gate** is a small unit that runs against an inbound `Request` and either short-circuits with a `Response` or contributes typed data to a flat key on `ctx` for the handler.

This module exports:

- **`defineGate`** — for _gate authors_ writing a new integration.

Gates compose by direct nesting — each `withFoo(config, handler)` is a fetch-handler wrapper, the same shape as `withSupabase`. No separate composer.

## Quick start (consumer)

```ts
import type { SupabaseContext } from '@supabase/server'
import { withSupabase } from '@supabase/server'
import { withFlag } from './gates/with-flag.ts'

export default {
  fetch: withSupabase(
    { allow: 'user' },
    withFlag<SupabaseContext>(
      { name: 'beta', evaluate: (req) => req.headers.has('x-beta') },
      async (req, ctx) => {
        // ctx.supabase, ctx.userClaims  — from withSupabase
        // ctx.flag                       — from withFlag
        if (!ctx.flag.enabled)
          return new Response('not enabled', { status: 404 })
        return Response.json({ user: ctx.userClaims!.id })
      },
    ),
  ),
}
```

Standalone (no `withSupabase`):

```ts
export default {
  fetch: withFlag(
    { name: 'beta', evaluate: (req) => req.headers.has('x-beta') },
    async (req, ctx) => Response.json({ enabled: ctx.flag.enabled }),
  ),
}
```

## The `ctx` shape

Inside a gated handler, ctx is a flat intersection — each gate contributes a typed key:

| Key                                               | Set by                         | Mutability              |
| ------------------------------------------------- | ------------------------------ | ----------------------- |
| `ctx.supabase`, `ctx.userClaims`, etc.            | `withSupabase` (when wrapping) | read-only by convention |
| `ctx.<gate-key>` (e.g. `ctx.flag`, `ctx.payment`) | the corresponding gate         | read-only by convention |

Two type-level guarantees:

- **Collision detection.** If a gate tries to compose where the upstream already has its key, the gate's call returns a `Conflict<Key>` sentinel string. Using the result where a fetch handler is expected fails to typecheck — error surfaces at the offending gate's call site.
- **Prerequisite enforcement.** Gates declare the upstream shape they require via `In`. The wrapper constrains `Base extends In`. Composing the gate where the upstream doesn't provide those keys is a type error. Gates with `In` keys also require `baseCtx`, so they can't be the outermost handler unless wrapped.

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

export const withFlag = defineGate<
  'flag', // Key
  FlagConfig, // Config
  {}, // In: no upstream prerequisites
  FlagState // Contribution: shape under ctx.flag
>({
  key: 'flag',
  run: (config) => async (req) => {
    const enabled = config.evaluate(req)
    if (!enabled) {
      return {
        kind: 'reject',
        response: Response.json({ error: 'feature_disabled' }, { status: 404 }),
      }
    }
    return { kind: 'pass', contribution: { enabled } }
  },
})
```

Used as:

```ts
withFlag({ name: 'beta', evaluate: ... }, async (req, ctx) => {
  if (!ctx.flag.enabled) return new Response('not enabled', { status: 404 })
  return Response.json({ ok: true })
})
```

### `run`'s shape

```ts
run: (config: Config) => (req: Request, ctx: In) =>
  Promise<GateResult<Contribution>>

type GateResult<C> =
  | { kind: 'pass'; contribution: C }
  | { kind: 'reject'; response: Response }
```

The outer `(config) =>` is invoked once when the consumer constructs the gate. Initialize per-instance state (stores, clients, computed config) here. The inner `(req, ctx) =>` is invoked per-request.

Return `{ kind: 'pass', contribution }` to admit the request and contribute typed state. Return `{ kind: 'reject', response }` to short-circuit with a canonical 4xx response.

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
      return {
        kind: 'reject',
        response: Response.json({ error: 'unauthenticated' }, { status: 401 }),
      }
    }
    const plan = await config.lookup(ctx.userClaims.id)
    if (!plan) {
      return {
        kind: 'reject',
        response: Response.json({ error: 'no_plan' }, { status: 402 }),
      }
    }
    return { kind: 'pass', contribution: { plan } }
  },
})
```

A consumer using this gate must supply `userClaims` upstream — typically by wrapping with `withSupabase`. Standalone use without `userClaims` won't compile, and `baseCtx` becomes required (no optional `?`).

### Conflict detection

Two gates contributing the same key fail to compose. The inner `withFoo` returns `Conflict<'foo'>` (a sentinel string), which can't be used where a fetch handler is expected:

```ts
withFoo({...}, withFoo({...}, handler))  // type error: Conflict<'foo'> is not callable
```

Pick a different key for each gate. Gates that may be applied multiple times can accept a `key` config to override the default.

### Threading state through nested gates

When a gate is wrapped by another (e.g. `withSupabase(... withRateLimit(... handler))`), the outer's keys land on `Base` for the inner. TypeScript can't bidirectionally infer this from the outer call site, so the inner gate's `Base` must be passed explicitly to surface the upstream keys in the handler's `ctx` type:

```ts
import type { SupabaseContext } from '@supabase/server'

withSupabase({ allow: 'user' },
  withRateLimit<SupabaseContext>({ limit: 30, windowMs: 60_000, key: ... },
    async (_req, ctx) => {
      // ctx.userClaims    — from withSupabase
      // ctx.rateLimit     — from withRateLimit
      return Response.json({ user: ctx.userClaims!.id })
    },
  ),
)
```

For multi-gate stacks, intersect the accumulated types:

```ts
type AfterRateLimit = SupabaseContext & { rateLimit: RateLimitState }

withSupabase({ allow: 'user' },
  withRateLimit<SupabaseContext>(...,
    withFlag<AfterRateLimit>(..., handler),
  ),
)
```

Without the explicit `<Base>`, the inner handler's `ctx` only types the gate's own key — runtime works, types narrow to that one gate's slice.

## API

| Export                                       | Description                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `defineGate(spec)`                           | Author helper: declare a gate. Returns a `(config, handler)` factory.                   |
| `GateResult<Contribution>`                   | Discriminated union: `{ kind: 'pass', contribution }` / `{ kind: 'reject', response }`. |
| `Conflict<Key>`                              | Sentinel string returned when a gate would shadow an upstream key.                      |
| `GateFactory<Key, Config, In, Contribution>` | The shape of a gate factory produced by `defineGate`.                                   |
