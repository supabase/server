# `@supabase/server/core/gates`

Similar to how `withSupabase(config, handler)` takes a config and a handler and hands the handler a `ctx` (with `ctx.supabase`, `ctx.userClaims`, …), a **gate** is a wrapper of the same shape — `withFoo(config, handler)` — that runs against the inbound `Request` and contributes its own typed key to `ctx`. Stack gates by direct nesting; the innermost handler sees a flat `ctx` aggregated from every wrapper around it. No separate composer.

Gates are how `@supabase/server` is extended past auth. Anyone can publish one as a standalone npm package; the built-ins (`withRateLimit`, `withWebhook`, `withPayment`, …) sit alongside third-party gates with no special status, all built on the same `defineGate` primitive. And because every gate is a plain `(req, ctx) => Response` wrapper over the Web Fetch API, the same gate runs unchanged across every runtime `@supabase/server` supports — Workers, Deno, Bun, Node — and through every adapter (Hono, H3).

This module exports:

- **`defineGate`** — for _gate authors_ writing a new integration.

## Quick start (consumer)

```ts
import { withSupabase } from '@supabase/server'
import { withFlag } from './gates/with-flag.ts'

export default {
  fetch: withSupabase(
    { allow: 'user' },
    withFlag(
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

## Composition rules

Two things to know when stacking gates:

1. **Outer runs first.** Each gate is a fetch-handler wrapper, so the outermost wrapper sees the request first and its contribution appears on `ctx` for everything it wraps. Reverse the order and any inner gate that declared an outer's key as a prerequisite won't compile.

2. **Short-circuit or contribute — not both.** A gate's `run` returns either a `Response` (short-circuit, inner never runs) or a contribution `{ [key]: … }` (fall through). Gates don't observe or wrap the inner handler's response. Anything response-shaped — rate-limit headers, CORS, response envelopes — is the handler's job: it reads what it needs from `ctx` and `req` and builds the response itself. This keeps each gate's surface small and the response shape under one owner.

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
      return Response.json({ error: 'feature_disabled' }, { status: 404 })
    }
    return { flag: { enabled } } // ← keyed slot, visible at ctx.flag
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
  Promise<Response | { [K in Key]: Contribution }>
```

The outer `(config) =>` is invoked once when the consumer constructs the gate. Initialize per-instance state (stores, clients, computed config) here. The inner `(req, ctx) =>` is invoked per-request.

Return a `Response` to short-circuit. Otherwise, return a single-key object `{ [key]: contribution }` — the gate author types the slot key directly in the return position, so the relationship between the gate's `key` and where its data lands on `ctx` is visible at the call site. The runtime picks `result[key]` and ignores any other fields, so accidentally returning a wider object (e.g. `{ ...ctx, [key]: ... }`) is a runtime no-op for upstream values, and TypeScript flags excess keys on fresh-literal returns.

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

A consumer using this gate must supply `userClaims` upstream — typically by wrapping with `withSupabase`. Standalone use without `userClaims` won't compile, and `baseCtx` becomes required (no optional `?`).

### Conflict detection

Two gates contributing the same key fail to compose. The inner `withFoo` returns `Conflict<'foo'>` (a sentinel string), which can't be used where a fetch handler is expected:

```ts
withFoo({...}, withFoo({...}, handler))  // type error: Conflict<'foo'> is not callable
```

Pick a different key for each gate. Gates that may be applied multiple times can accept a `key` config to override the default.

### Threading state through nested gates

When a gate is wrapped by another (e.g. `withSupabase(... withRateLimit(... handler))`), the outer's keys land on `Base` for the inner. TypeScript infers that `Base` through the nested fetch-handler signatures, so the handler sees the full accumulated `ctx` without explicit annotations.

> **How this works.** The inference is enabled by a callable-intersection in `Wrapped<Base, In>` (see the JSDoc on that type in `define-gate.ts`). The two-signature form is load-bearing — collapsing it to a single optional `(req, baseCtx?: Base)` looks equivalent at runtime but breaks contextual `Base` propagation through nested generic calls. Don't simplify it without reading the comment.

```ts
withSupabase({ allow: 'user' },
  withRateLimit({ limit: 30, windowMs: 60_000, key: ... },
    async (_req, ctx) => {
      // ctx.userClaims    — from withSupabase
      // ctx.rateLimit     — from withRateLimit
      return Response.json({ user: ctx.userClaims!.id })
    },
  ),
)
```

For multi-gate stacks, keep nesting directly:

```ts
withSupabase({ allow: 'user' },
  withRateLimit(...,
    withFlag(...,
      withTurnstile(..., async (_req, ctx) => {
        // ctx.userClaims   — from withSupabase
        // ctx.rateLimit    — from withRateLimit
        // ctx.flag         — from withFlag
        // ctx.turnstile    — from withTurnstile
      }),
    ),
  ),
)
```

If you manually call a prerequisite-free gate with a `baseCtx` and no contextual outer wrapper, you can still pass `<Base>` explicitly to describe that base context.

## API

| Export                                | Description                                                            |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `defineGate(spec)`                    | Author helper: declare a gate. Returns a `(config, handler)` callable. |
| `Conflict<Key>`                       | Sentinel string returned when a gate would shadow an upstream key.     |
| `Gate<Key, Config, In, Contribution>` | The shape of a gate produced by `defineGate`.                          |
