# Writing a gate

This directory holds the **gates** that ship with `@supabase/server`. A gate is a `(config, handler)` fetch-handler wrapper — same shape as `withSupabase` — that runs against the inbound `Request`, contributes a typed key to `ctx`, and either short-circuits with a `Response` or falls through to the inner handler. Anyone can publish a gate as a standalone npm package; the built-ins use the same `defineGate` primitive third-party authors do.

This README is for **gate authors**. If you just want to _use_ a gate, see [`src/core/gates/README.md`](../core/gates/README.md).

## The worked example

[`feature-flag/`](./feature-flag/) is the canonical reference. It is short, well-commented, and exercises every piece of the pattern — config, contribution, prerequisites, short-circuit vs fall-through. Read it alongside this guide.

```
src/gates/feature-flag/
├── README.md                       ← consumer-facing docs
├── index.ts                        ← public exports
├── with-feature-flag.ts            ← implementation
└── with-feature-flag.test.ts       ← behavioural tests
```

## Anatomy of a gate

`defineGate` takes four type parameters and one spec object:

```ts
defineGate<Key, Config, In, Contribution>({ key, run })
```

| Parameter      | What it is                                                    | Example                       |
| -------------- | ------------------------------------------------------------- | ----------------------------- |
| `Key`          | The literal-string slot the gate contributes to `ctx`.        | `'featureFlag'`               |
| `Config`       | The object the consumer passes to `withFoo(config, handler)`. | `WithFeatureFlagConfig`       |
| `In`           | Upstream prerequisites — what must already be on `ctx`.       | `Record<never, never>` (none) |
| `Contribution` | The shape that lands at `ctx[Key]` after a successful run.    | `FeatureFlagState`            |

```ts
export const withFeatureFlag: Gate<
  'featureFlag', // Key
  WithFeatureFlagConfig, // Config
  Record<never, never>, // In (no prerequisites)
  FeatureFlagState // Contribution
> = defineGate(/* ... */)
```

## `run` has two stages

```ts
run: (config: Config) => (req: Request, ctx: In) =>
  Promise<Response | { [K in Key]: Contribution }>
```

- **Outer `(config) =>`** runs **once** when the consumer constructs the gate. Initialize per-instance state here: clients, computed config, memoized fetches.
- **Inner `(req, ctx) =>`** runs **per request**. It receives the request and the upstream-supplied `ctx` typed as `In`.

The inner stage returns one of two shapes:

| Return                    | Effect                                                  |
| ------------------------- | ------------------------------------------------------- |
| `Response`                | **Short-circuit.** The inner handler is never invoked.  |
| `{ [Key]: Contribution }` | **Fall through.** The contribution lands at `ctx[Key]`. |

The runtime picks `result[key]` off the contribution object and ignores any other fields, so a single `return { featureFlag: { ... } }` is all the author writes.

## Authoring rules

1. **One key per gate.** A gate that wants multiple slots is doing too much — split it.
2. **No response shaping.** Gates don't observe or wrap the inner handler's response. Anything response-shaped — rate-limit headers, CORS, response envelopes — is the handler's job. Keeps each gate's surface small and the response shape under one owner.
3. **Declare prerequisites in `In`.** If your gate needs `ctx.userClaims`, set `In = { userClaims: UserClaims | null }`. Standalone use then fails to compile — a real error, not a runtime surprise.
4. **Pick a unique key.** If two gates contribute the same key, composition fails with a type error at the offending call site (the inner returns the `Conflict<Key>` sentinel string). For gates that may be applied multiple times, accept a `key` override in config.

## Directory layout for a gate in this repo

Mirror `feature-flag/`:

```
src/gates/<gate-name>/
├── README.md                       ← consumer-facing: what it does, config, examples
├── index.ts                        ← export the gate + its public types
├── with-<gate-name>.ts             ← the gate itself
└── with-<gate-name>.test.ts        ← vitest, exercises the run stages
```

Conventions:

- Directory name is **kebab-case** (`feature-flag`, `rate-limit`).
- Function is **`withCamelCase`** (`withFeatureFlag`, `withRateLimit`).
- The key on `ctx` is **camelCase** matching the function name minus the `with` prefix (`ctx.featureFlag`, `ctx.rateLimit`).
- Export the config / contribution interfaces alongside the gate so consumers can type their own wrappers.

## Wiring up a new gate

To add a gate to this package, three files change in addition to the new directory:

1. **[`package.json`](../../package.json)** — add an entry to `exports`:
   ```json
   "./gates/<gate-name>": {
     "types": "./dist/gates/<gate-name>/index.d.mts",
     "import": "./dist/gates/<gate-name>/index.mjs",
     "require": "./dist/gates/<gate-name>/index.cjs"
   }
   ```
2. **[`tsdown.config.ts`](../../tsdown.config.ts)** — add `'src/gates/<gate-name>/index.ts'` to `entry`.
3. **[`jsr.json`](../../jsr.json)** — add `"./gates/<gate-name>": "./src/gates/<gate-name>/index.ts"`.

A third-party gate published as its own npm package skips all three — it just exports the result of `defineGate` and depends on `@supabase/server` for the primitive.

## Testing the run stages

The worked example in [`feature-flag/with-feature-flag.test.ts`](./feature-flag/with-feature-flag.test.ts) shows the cases worth covering for any gate:

- Admits and contributes the expected `ctx[Key]` shape.
- Short-circuits with the configured status / body on reject.
- Honors override config (custom status, custom body).
- Passes the `Request` through, so author-supplied evaluators see header / IP / method.
- Supports async work inside `run`.

Use `vi.fn` for the inner handler when you need to assert it was (or wasn't) called.

## See also

- [`src/core/gates/README.md`](../core/gates/README.md) — composition rules, `ctx` shape, conflict and prerequisite enforcement.
- [`feature-flag/`](./feature-flag/) — the worked example referenced throughout this guide.
