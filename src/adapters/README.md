# Adapters

You're in the adapter source folder. Framework adapters wrap `withSupabase` and `createSupabaseContext` for a specific framework's middleware contract: Hono middleware, H3 event handlers, and so on. Implementations live next to this README under `<name>/`; reference docs live at [`docs/adapters/<name>.md`](../../docs/adapters/).

> [!WARNING]
> Adapters are deprecated and will be removed on December 1, 2026. New adapters are not accepted. Framework integration goes through the bridges in [`examples/frameworks`](../../examples/frameworks) and the [framework integration guide](https://supabase.com/docs/reference/server/frameworks).

## Available adapters

| Framework | Import                             | Framework version      | Docs                                                     |
| --------- | ---------------------------------- | ---------------------- | -------------------------------------------------------- |
| Hono      | `@supabase/server/adapters/hono`   | `^4.0.0`               | [docs/adapters/hono.md](../../docs/adapters/hono.md)     |
| H3 / Nuxt | `@supabase/server/adapters/h3`     | `^2.0.0`               | [docs/adapters/h3.md](../../docs/adapters/h3.md)         |
| Elysia    | `@supabase/server/adapters/elysia` | `^1.4.0`               | [docs/adapters/elysia.md](../../docs/adapters/elysia.md) |
| NestJS    | `@supabase/server/adapters/nestjs` | `^10.0.0 \|\| ^11.0.0` | [docs/adapters/nestjs.md](../../docs/adapters/nestjs.md) |

The framework version reflects what the adapter is tested against. It must match the corresponding entry in [`package.json#peerDependencies`](../../package.json). A PR that bumps the peer-dep range updates this table and the mirror table in the top-level [`README.md`](../../README.md).

## Maintenance until removal

Every adapter listed above is community-maintained. Hono, H3, and Elysia originated as community contributions. The Supabase team reviews PRs, runs security and regression triage, and ships releases. The original contributor of an adapter is the first responder on framework-version bumps and bug reports for that adapter.

Bug fixes and framework-version bumps are welcome until the removal date. Read [`CONTRIBUTING.md`](../../CONTRIBUTING.md) first. A fix keeps the existing adapter shape: `withSupabase(config, handler)` returning the framework's native middleware type, auth and env handling through `@supabase/server/core`, no new runtime dependencies, and tests for every auth mode. The Hono adapter's [`hono/middleware.test.ts`](hono/middleware.test.ts) is the reference test file.
