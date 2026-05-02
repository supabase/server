# `@supabase/server/gates/flag`

Provider-agnostic feature-flag gate. Pass any `evaluate` function — the gate calls it per request, admits when the flag is on, rejects otherwise. Use it with PostHog, LaunchDarkly, Statsig, an env-var, a header, a database row — anything that can answer "is this flag enabled for this request?".

```ts
import { chain } from '@supabase/server/core/gates'
import { withFlag } from '@supabase/server/gates/flag'

export default {
  fetch: chain(
    withFlag({
      name: 'beta-checkout',
      evaluate: (req) => req.headers.get('x-beta') === '1',
    }),
  )(async (_req, ctx) => {
    return Response.json({ feature: ctx.state.flag.name })
  }),
}
```

## Config

| Field          | Type                                                                 | Description                                                                        |
| -------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `name`         | `string`                                                             | Recorded in `ctx.state.flag.name` and the default rejection body.                  |
| `evaluate`     | `(req) => boolean \| FlagVerdict \| Promise<boolean \| FlagVerdict>` | Decide whether the flag is enabled for this request.                               |
| `rejectStatus` | `number?`                                                            | Status when the flag rejects. Default `404` (soft reveal).                         |
| `rejectBody`   | `unknown?`                                                           | Body when the flag rejects. Default `{ error: 'feature_disabled', flag: <name> }`. |

## Returning richer verdicts

`evaluate` can return a verdict object to capture variant or payload:

```ts
withFlag({
  name: 'pricing-experiment',
  evaluate: async (req) => {
    const variant = await ld.variation('pricing-experiment', userKey, 'control')
    return { enabled: variant !== 'off', variant, payload: { rollout: 0.5 } }
  },
})
```

Then the handler reads:

```ts
ctx.state.flag.variant // 'a' | 'b' | 'control' | null
ctx.state.flag.payload // anything you returned
```

## Why 404 by default

Soft reveal. A `403 Forbidden` tells the caller "this exists, but you can't see it" — useful intel for an attacker probing for unreleased endpoints. `404 Not Found` says "there's nothing here." Override via `rejectStatus` if you need stricter or different semantics.

## Composing with auth-aware flags

Place `withFlag` _after_ `withSupabase` to target by user identity:

```ts
withSupabase(
  { allow: 'user' },
  chain(
    withFlag({
      name: 'beta-checkout',
      evaluate: async (_req) => {
        // Cheap escape hatch: stash the user id on a header before chain runs,
        // or read from a request-scoped store. For now, plug in an
        // identity-aware provider:
        return await posthog.isFeatureEnabled('beta-checkout', userId)
      },
    }),
  )(handler),
)
```

The current `evaluate` signature only sees the request — for user-aware flags, either pull the identity from a header `withSupabase` already validated (e.g. `req.headers.get('authorization')` to derive a stable id), or wait for a future enhancement that threads ctx into the evaluator.

## Single namespace caveat

The gate occupies `ctx.state.flag` — only one `withFlag` can compose into a chain at a time. For multiple flags on the same route, write a single composite evaluator that returns a richer verdict, or run separate routes per flag.

## See also

- [Gate composition primitives](../../core/gates/README.md)
