# `@supabase/server/gates/flag`

Provider-agnostic feature-flag gate. Pass any `evaluate` function — the gate calls it per request, admits when the flag is on, rejects otherwise. Use it with PostHog, LaunchDarkly, Statsig, an env-var, a header, a database row — anything that can answer "is this flag enabled for this request?".

```ts
import { withFlag } from '@supabase/server/gates/flag'

export default {
  fetch: withFlag(
    {
      name: 'beta-checkout',
      evaluate: (req) => req.headers.get('x-beta') === '1',
    },
    async (_req, ctx) => Response.json({ feature: ctx.flag.name }),
  ),
}
```

## Config

| Field          | Type                                                                 | Description                                                                        |
| -------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `name`         | `string`                                                             | Recorded in `ctx.flag.name` and the default rejection body.                        |
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
ctx.flag.variant // 'a' | 'b' | 'control' | null
ctx.flag.payload // anything you returned
```

## Why 404 by default

Soft reveal. A `403 Forbidden` tells the caller "this exists, but you can't see it" — useful intel for an attacker probing for unreleased endpoints. `404 Not Found` says "there's nothing here." Override via `rejectStatus` if you need stricter or different semantics.

## Composing with auth-aware flags

Place `withFlag` _after_ `withSupabase` to target by user identity:

```ts
import type { SupabaseContext } from '@supabase/server'
import { withSupabase } from '@supabase/server'
import { withFlag } from '@supabase/server/gates/flag'

withSupabase(
  { allow: 'user' },
  withFlag<SupabaseContext>(
    {
      name: 'beta-checkout',
      evaluate: async (req) => {
        // Plug in an identity-aware provider; derive the user id from a
        // header the auth layer has already validated, or stash it via a
        // tiny outer wrapper that runs before this gate.
        const userId = req.headers.get('x-user-id') ?? 'anon'
        return await posthog.isFeatureEnabled('beta-checkout', userId)
      },
    },
    handler,
  ),
)
```

The current `evaluate` signature only sees the request — for user-aware flags, derive the identity from a request signal the auth layer has already validated, or wait for a future enhancement that threads ctx into the evaluator.

## Single namespace caveat

The gate occupies `ctx.flag` — only one `withFlag` can compose into a stack at a time. For multiple flags on the same route, write a single composite evaluator that returns a richer verdict, or run separate routes per flag.

## See also

- [Gate composition primitives](../../core/gates/README.md)
