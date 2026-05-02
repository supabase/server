# @supabase/server/core/gates

Composable preconditions for fetch handlers. A **gate** is a small unit that runs against an inbound `Request` and either short-circuits with a `Response` or contributes typed data to `ctx.state[namespace]` for the handler.

This module exports two helpers:

- **`defineGate`** — for _gate authors_ writing a new integration.
- **`chain`** — for _gate consumers_ composing gates into a fetch handler.

`withSupabase` is **not** a gate. It's a fetch-handler wrapper that establishes `SupabaseContext`. Gates compose _inside_ it (or standalone).

## Quick start (consumer)

```ts
import { withSupabase } from '@supabase/server'
import { chain } from '@supabase/server/core/gates'
import { withPayment } from '@supabase/server/gates/x402'

export default {
  fetch: withSupabase(
    { allow: 'user' },
    chain(withPayment({ stripe, amountCents: 5 }))(async (req, ctx) => {
      // ctx.supabase, ctx.userClaims          — from withSupabase
      // ctx.state.payment.intentId            — from withPayment
      // ctx.locals.foo = 'bar'                — free per-request scratch
      return Response.json({ paid: ctx.state.payment.intentId })
    }),
  ),
}
```

Standalone (no `withSupabase`):

```ts
export default {
  fetch: chain(withPayment({ stripe, amountCents: 1 }))(async (req, ctx) => {
    return Response.json({ paid: ctx.state.payment.intentId })
  }),
}
```

## The `ctx` shape

Inside a chain handler:

| Path                                   | Set by                         | Mutability |
| -------------------------------------- | ------------------------------ | ---------- |
| `ctx.supabase`, `ctx.userClaims`, etc. | `withSupabase` (when wrapping) | read-only  |
| `ctx.state.<namespace>`                | gates via `chain`              | read-only  |
| `ctx.locals`                           | anyone (handler, helpers)      | mutable    |
| `ctx.foo` (top-level, anything else)   | —                              | type error |

Three rules:

- **`ctx.state` is gate-owned.** Each gate owns exactly one slot, named by its namespace. Slots are read-only from the handler's view.
- **`ctx.locals` is everyone-else's.** Per-request scratch space. `Record<string, unknown>`. Mutate freely.
- **The top level is closed.** `withSupabase` populates the established host keys; everything else is a type error. Use `state` or `locals`.

## Authoring a gate (`defineGate`)

A gate has a _namespace_ (its slot under `ctx.state`), a _contribution shape_ (the typed value placed there), and a _run_ function.

```ts
import { defineGate } from '@supabase/server/core/gates'

export interface FlagConfig {
  name: string
}

export interface FlagState {
  enabled: boolean
}

export const withFlag = defineGate<
  'flag', // Namespace
  FlagConfig, // Config (whatever the factory takes)
  {}, // In: prerequisites from upstream ctx (none here)
  FlagState // Contribution: shape under ctx.state.flag
>({
  namespace: 'flag',
  run: (config) => async (req) => {
    const enabled = req.headers.get(`x-flag-${config.name}`) === '1'
    return { kind: 'pass', contribution: { enabled } }
  },
})
```

Used as:

```ts
chain(withFlag({ name: 'beta' }))(async (req, ctx) => {
  if (!ctx.state.flag.enabled)
    return new Response('not enabled', { status: 404 })
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

The outer `(config) =>` is invoked once when the consumer constructs the gate (`withFlag({ name: 'beta' })`). Initialize per-instance state (stores, clients, computed config) here. The inner `(req, ctx) =>` is invoked per-request.

Return `{ kind: 'pass', contribution }` to admit the request and contribute typed state. Return `{ kind: 'reject', response }` to short-circuit the chain with a canonical 4xx response.

### Declaring upstream prerequisites

A gate can require structural shape from the upstream ctx via `In`. For example, a gate that reads the authenticated user:

```ts
import type { UserClaims } from '@supabase/server'

export const withSubscription = defineGate<
  'subscription',
  { lookup: (userId: string) => Promise<Plan | null> },
  { userClaims: UserClaims }, // In: requires userClaims upstream
  { plan: Plan }
>({
  namespace: 'subscription',
  run: (config) => async (req, ctx) => {
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

A consumer using this gate must supply `userClaims` upstream — typically by wrapping the chain with `withSupabase`. Standalone use without `userClaims` won't compile.

### Reserved namespaces

These names cannot be used as gate namespaces (would shadow the host or chain ctx structure):

- `state`, `locals`
- `supabase`, `supabaseAdmin`, `userClaims`, `claims`, `authType`, `authKeyName`

`defineGate({ namespace: 'state', ... })` fails to typecheck.

### Collisions

Two gates declaring the same namespace fail to compile when composed by `chain`. The accumulated state type collapses to `never`, surfacing as a type error on the handler's `ctx.state` access.

```ts
chain(
  withPayment({ ... }),
  withPayment({ ... }),  // duplicate namespace 'payment'
)(handler)               // type error
```

Pick a different namespace for each gate. If you have two implementations of the same concept (e.g. two payment providers), name them by provider (`stripePayment`, `coinbasePayment`).

### Reusing per-request state

If a gate needs to share data with the handler beyond its primary contribution (e.g. a debugging blob, a transient cache key), write to `ctx.locals` from inside `run`:

```ts
run: (config) => async (req, ctx) => {
  ctx.locals.requestId ??= crypto.randomUUID()
  // ...
}
```

`ctx.locals` is mutable and shared across all gates and the handler for that request. Don't put values that need _typed_ access there — those belong in your gate's contribution.

## API

| Export                              | Description                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `defineGate(spec)`                  | Author helper: declare a gate. Returns a `(config) => Gate` factory.                      |
| `chain(...gates)(handler)`          | Consumer helper: compose gates and produce a `(req, baseCtx?) => Response` function.      |
| `Gate<In, Namespace, Contribution>` | The structural type of a gate.                                                            |
| `GateResult<Contribution>`          | Discriminated union of `{ kind: 'pass', contribution }` / `{ kind: 'reject', response }`. |
| `ChainCtx<Base, State>`             | The merged ctx type seen by a chain handler.                                              |
| `AccumulatedState<G>`               | Type-level merge of all gates' contributions; resolves to `never` on collision.           |
| `MergeStrict<A, B>`                 | Strict object merge (`never` on key overlap).                                             |
| `ValidNamespace<N>`                 | Type-level guard: `never` for reserved or broad-`string` namespaces.                      |
| `ReservedNamespace`                 | Union of names that can't be gate namespaces.                                             |
