# NestJS Adapter

## Setup

Install NestJS as a peer dependency:

```bash
pnpm add @nestjs/common @nestjs/core
```

The adapter exports `withSupabase` (a guard factory) and `SupabaseCtx` (a param decorator). Together they replace the `c.var.supabaseContext` / `event.context.supabaseContext` patterns from the Hono and H3 adapters.

`withSupabase(config)` returns a `CanActivate` guard class. The guard reads the underlying request (Express or Fastify), verifies credentials with `@supabase/server/core`, and attaches the resulting `SupabaseContext` to `request.supabaseContext`. From any handler you can pull it out with `@SupabaseCtx()`.

## Basic controller with auth

```ts
// games.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common'
import { withSupabase, SupabaseCtx } from '@supabase/server/adapters/nestjs'
import type { SupabaseContext } from '@supabase/server'

@Controller('games')
@UseGuards(withSupabase({ auth: 'user' }))
export class GamesController {
  @Get()
  async list(@SupabaseCtx() ctx: SupabaseContext) {
    const { data } = await ctx.supabase.from('favorite_games').select()
    return data
  }

  @Get('me')
  me(@SupabaseCtx('userClaims') user: SupabaseContext['userClaims']) {
    return user
  }
}
```

`@SupabaseCtx()` returns the entire `SupabaseContext` (`supabase`, `supabaseAdmin`, `userClaims`, `jwtClaims`, `authMode`, `authKeyName`). Pass a key (`@SupabaseCtx('supabase')`) to extract a single field.

### Typing your database

The guard does not thread a `Database` generic, so `@SupabaseCtx()` resolves to `SupabaseContext<unknown>` by default. To get typed table access, annotate the parameter at the handler:

```ts
import type { SupabaseContext } from '@supabase/server'
import type { Database } from './database.types'

@Get()
async list(@SupabaseCtx() ctx: SupabaseContext<Database>) {
  const { data } = await ctx.supabase.from('favorite_games').select()
  return data
}
```

## Per-route auth

Apply different auth modes per controller or per handler — the closest `@UseGuards()` wins:

```ts
import { Controller, Get, Post, UseGuards } from '@nestjs/common'
import { withSupabase, SupabaseCtx } from '@supabase/server/adapters/nestjs'
import type { SupabaseContext } from '@supabase/server'

@Controller()
export class AppController {
  // Public — no guard
  @Get('health')
  health() {
    return { status: 'ok' }
  }

  // User-authenticated route
  @Get('todos')
  @UseGuards(withSupabase({ auth: 'user' }))
  async todos(@SupabaseCtx() ctx: SupabaseContext) {
    const { data } = await ctx.supabase.from('todos').select()
    return data
  }

  // Secret-key-protected admin route
  @Post('admin/sync')
  @UseGuards(withSupabase({ auth: 'secret' }))
  async sync(@SupabaseCtx() ctx: SupabaseContext) {
    const { data } = await ctx.supabaseAdmin
      .from('audit_log')
      .insert({ action: 'sync' })
    return data
  }

  // Dual auth — users or services
  @Get('reports')
  @UseGuards(withSupabase({ auth: ['user', 'secret'] }))
  reports(@SupabaseCtx('authMode') authMode: SupabaseContext['authMode']) {
    return { authMode }
  }
}
```

## App-wide guard

Apply the guard globally with `app.useGlobalGuards()`:

```ts
// main.ts
import { NestFactory } from '@nestjs/core'
import { withSupabase } from '@supabase/server/adapters/nestjs'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.useGlobalGuards(new (withSupabase({ auth: 'user' }))())
  await app.listen(3000)
}
bootstrap()
```

## Multiple guards

`withSupabase` always runs, even if a previous guard already set `request.supabaseContext`. NestJS executes guards in order (global → controller → handler), so a handler-level guard naturally tightens what a global guard set: the later guard re-authenticates with its own config and either rejects the request or overwrites the context. The innermost guard wins.

If you need different auth per route, prefer per-route `@UseGuards(...)` without a global guard.

## CORS

The NestJS adapter does not handle CORS. Use NestJS's built-in CORS:

```ts
// main.ts
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.enableCors({ origin: 'https://myapp.com' })
  await app.listen(3000)
}
bootstrap()
```

The `cors` option is excluded from `WithSupabaseConfig` for this adapter.

## Error handling

When auth fails, the adapter throws a NestJS `HttpException`. The original `AuthError` is available via `cause`. Add an exception filter to format the response:

```ts
// supabase-auth.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common'
import { AuthError } from '@supabase/server'
import type { Response } from 'express'

@Catch(HttpException)
export class SupabaseAuthFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const cause = exception.cause
    if (!(cause instanceof AuthError)) throw exception

    const res = host.switchToHttp().getResponse<Response>()
    res.status(cause.status).json({
      error: cause.message,
      code: cause.code,
    })
  }
}
```

Register it globally:

```ts
// main.ts
app.useGlobalFilters(new SupabaseAuthFilter())
```

## Environment overrides

Pass `env` to override auto-detected environment variables:

```ts
@UseGuards(
  withSupabase({
    auth: 'user',
    env: { url: 'http://localhost:54321' },
  }),
)
```

## Supabase client options

Forward options to the underlying `createClient()` calls:

```ts
@UseGuards(
  withSupabase({
    auth: 'user',
    supabaseOptions: { db: { schema: 'api' } },
  }),
)
```
