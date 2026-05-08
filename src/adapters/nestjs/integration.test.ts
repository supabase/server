import 'reflect-metadata'

import {
  Controller,
  Get,
  Injectable,
  Module,
  UseGuards,
  type CanActivate,
  type INestApplication,
  type PipeTransform,
} from '@nestjs/common'
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SupabaseContext } from '../../types.js'
import { SupabaseCtx } from './decorator.js'
import { withSupabase } from './middleware.js'

const env = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz' },
  secretKeys: { default: 'sb_secret_xyz' },
  jwks: null,
}

@Controller('test')
class TestController {
  @Get('open')
  @UseGuards(withSupabase({ auth: 'none', env }))
  open(@SupabaseCtx() ctx: SupabaseContext) {
    return {
      authMode: ctx.authMode,
      hasSupabase: !!ctx.supabase,
      hasSupabaseAdmin: !!ctx.supabaseAdmin,
    }
  }

  @Get('user')
  @UseGuards(withSupabase({ auth: 'user', env }))
  user(@SupabaseCtx('authMode') mode: SupabaseContext['authMode']) {
    return { mode }
  }

  @Get('secret')
  @UseGuards(withSupabase({ auth: 'secret', env }))
  secret(@SupabaseCtx('authMode') mode: SupabaseContext['authMode']) {
    return { mode }
  }
}

@Module({ controllers: [TestController] })
class AppModule {}

const platforms = [
  {
    name: 'Express',
    create: async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile()
      const app = moduleRef.createNestApplication({ logger: false })
      await app.init()
      return app
    },
  },
  {
    name: 'Fastify',
    create: async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile()
      const app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
        { logger: false },
      )
      await app.init()
      // Fastify needs `ready()` before its routes are reachable via the
      // underlying http server. supertest then drives that server directly.
      await app.getHttpAdapter().getInstance().ready()
      return app
    },
  },
]

describe.each(platforms)(
  'nestjs adapter — integration ($name)',
  ({ create }) => {
    let app: INestApplication

    beforeEach(async () => {
      app = await create()
    })

    afterEach(async () => {
      await app.close()
    })

    it('returns the SupabaseContext on a successful no-auth route', async () => {
      const res = await request(app.getHttpServer()).get('/test/open')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        authMode: 'none',
        hasSupabase: true,
        hasSupabaseAdmin: true,
      })
    })

    it('responds 401 with { message, code } when user auth is missing', async () => {
      const res = await request(app.getHttpServer()).get('/test/user')
      expect(res.status).toBe(401)
      expect(res.body.message).toEqual(expect.any(String))
      expect(res.body.code).toEqual(expect.any(String))
    })

    it('accepts a valid secret apikey via the apikey header', async () => {
      const res = await request(app.getHttpServer())
        .get('/test/secret')
        .set('apikey', 'sb_secret_xyz')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ mode: 'secret' })
    })

    it('rejects an invalid secret apikey with 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/test/secret')
        .set('apikey', 'sb_secret_wrong')
      expect(res.status).toBe(401)
    })
  },
)

// Global-guard mode — `app.useGlobalGuards(new (withSupabase(...))())` is the
// documented way to apply auth to every controller without per-route
// `@UseGuards()`. Exercise it on a controller that has no guard of its own.
@Controller('global')
class GlobalGuardController {
  @Get('whoami')
  whoami(@SupabaseCtx('authMode') mode: SupabaseContext['authMode']) {
    return { mode }
  }
}

@Module({ controllers: [GlobalGuardController] })
class GlobalGuardModule {}

const globalGuardPlatforms = [
  {
    name: 'Express',
    create: async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [GlobalGuardModule],
      }).compile()
      const app = moduleRef.createNestApplication({ logger: false })
      const Guard = withSupabase({ auth: 'secret', env })
      app.useGlobalGuards(new Guard())
      await app.init()
      return app
    },
  },
  {
    name: 'Fastify',
    create: async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [GlobalGuardModule],
      }).compile()
      const app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
        { logger: false },
      )
      const Guard = withSupabase({ auth: 'secret', env })
      app.useGlobalGuards(new Guard())
      await app.init()
      await app.getHttpAdapter().getInstance().ready()
      return app
    },
  },
]

describe.each(globalGuardPlatforms)(
  'nestjs adapter — global guards ($name)',
  ({ create }) => {
    let app: INestApplication

    beforeEach(async () => {
      app = await create()
    })

    afterEach(async () => {
      await app.close()
    })

    it('applies the guard to a route with no @UseGuards()', async () => {
      // Without an apikey, the global guard should reject — proving it ran
      // even though the controller has no per-route guard.
      const denied = await request(app.getHttpServer()).get('/global/whoami')
      expect(denied.status).toBe(401)

      const ok = await request(app.getHttpServer())
        .get('/global/whoami')
        .set('apikey', 'sb_secret_xyz')
      expect(ok.status).toBe(200)
      expect(ok.body).toEqual({ mode: 'secret' })
    })
  },
)

// `@SupabaseCtx(key, ...pipes)` — NestJS param decorators support a pipes
// trailing rest arg. The decorator's signature exposes it; this test proves
// pipes actually run on the extracted value.
@Injectable()
class UppercaseModePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    return value.toUpperCase()
  }
}

@Controller('pipes')
@UseGuards(withSupabase({ auth: 'none', env }))
class PipesController {
  @Get('mode')
  mode(@SupabaseCtx('authMode', UppercaseModePipe) mode: string) {
    return { mode }
  }
}

@Module({ controllers: [PipesController] })
class PipesModule {}

const pipesPlatforms = [
  {
    name: 'Express',
    create: async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [PipesModule],
      }).compile()
      const app = moduleRef.createNestApplication({ logger: false })
      await app.init()
      return app
    },
  },
  {
    name: 'Fastify',
    create: async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [PipesModule],
      }).compile()
      const app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
        { logger: false },
      )
      await app.init()
      await app.getHttpAdapter().getInstance().ready()
      return app
    },
  },
]

describe.each(pipesPlatforms)(
  'nestjs adapter — @SupabaseCtx pipes ($name)',
  ({ create }) => {
    let app: INestApplication

    beforeEach(async () => {
      app = await create()
    })

    afterEach(async () => {
      await app.close()
    })

    it('runs a pipe over the value extracted by @SupabaseCtx', async () => {
      const res = await request(app.getHttpServer()).get('/pipes/mode')
      expect(res.status).toBe(200)
      // The raw authMode is 'none'; the pipe uppercases it.
      expect(res.body).toEqual({ mode: 'NONE' })
    })
  },
)
