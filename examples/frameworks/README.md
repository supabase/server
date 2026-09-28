# Framework bridges

Each folder holds two files for one framework:

- `supabase-middleware.ts` (`supabase.guard.ts` for NestJS) is the bridge. It runs a `@supabase/middleware` entry array inside the framework's own middleware slot. Copy it into your project as is, comments included.
- `app.ts` is a minimal app that uses the bridge with `withRequiredClaims` and `withSupabaseClient`.

| Framework      | Bridge                                                                           | Usage                                            |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| Hono           | [`hono/supabase-middleware.ts`](hono/supabase-middleware.ts)                     | [`hono/app.ts`](hono/app.ts)                     |
| H3 / Nuxt      | [`h3/supabase-middleware.ts`](h3/supabase-middleware.ts)                         | [`h3/app.ts`](h3/app.ts)                         |
| Elysia         | [`elysia/supabase-middleware.ts`](elysia/supabase-middleware.ts)                 | [`elysia/app.ts`](elysia/app.ts)                 |
| NestJS         | [`nestjs/supabase.guard.ts`](nestjs/supabase.guard.ts)                           | [`nestjs/app.ts`](nestjs/app.ts)                 |
| TanStack Start | [`tanstack-start/supabase-middleware.ts`](tanstack-start/supabase-middleware.ts) | [`tanstack-start/app.ts`](tanstack-start/app.ts) |

The Elysia bridge is two functions that work only as a pair. `wrapElysia` runs the entries around the app, and `supabaseCtx` hands their values to the routes. An app served without `wrapElysia` throws on every route.

The NestJS guard file works without a decorator transform, but the controller in `nestjs/app.ts` does not: Nest is built on decorators, so running it needs swc, ts-node, or a build step. Node's built-in type stripping rejects the `@Controller()` line.

The guide that explains the bridges, the auth trap, and how to move off the framework adapters is on supabase.com: [Frameworks](https://supabase.com/docs/reference/server/frameworks).

These files typecheck in CI through `pnpm typecheck:examples`. They are not part of the published package. `examples/package.json` is a private workspace package that holds the dependencies only the examples need, such as `@tanstack/react-start`; the root package does not list them.
