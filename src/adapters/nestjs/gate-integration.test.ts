import 'reflect-metadata'

import {
  Controller,
  Get,
  Module,
  UseGuards,
  type INestApplication,
} from '@nestjs/common'
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { withFeatureFlag } from '../../gates/feature-flag/with-feature-flag.js'
import type { SupabaseContext } from '../../types.js'

import { asGuard } from './as-guard.js'
import { SupabaseCtx } from './decorator.js'
import { gateCtx } from './gate-ctx.js'
import { withSupabase } from './middleware.js'

const env = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz' },
  secretKeys: { default: 'sb_secret_xyz' },
  jwks: null,
}

const FeatureFlagCtx = gateCtx(withFeatureFlag)

@Controller('beta')
@UseGuards(
  withSupabase({ auth: 'none', env }),
  asGuard(withFeatureFlag, {
    name: 'beta',
    evaluate: (req) => req.headers.has('x-beta'),
  }),
)
class BetaController {
  @Get('whole')
  whole(
    @SupabaseCtx('authMode') mode: SupabaseContext['authMode'],
    @FeatureFlagCtx() flag: { name: string; enabled: boolean } | undefined,
  ) {
    return { mode, flag }
  }

  @Get('field')
  field(@FeatureFlagCtx('name') name: string | undefined) {
    return { name }
  }
}

@Module({ controllers: [BetaController] })
class BetaModule {}

const platforms = [
  {
    name: 'Express',
    create: async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [BetaModule],
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
        imports: [BetaModule],
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

describe.each(platforms)(
  'asGuard + gateCtx — gates as NestJS guards ($name)',
  ({ create }) => {
    let app: INestApplication

    beforeEach(async () => {
      app = await create()
    })

    afterEach(async () => {
      await app.close()
    })

    it('admits when the gate evaluates true and exposes the contribution via gateCtx', async () => {
      const res = await request(app.getHttpServer())
        .get('/beta/whole')
        .set('x-beta', '1')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        mode: 'none',
        flag: { name: 'beta', enabled: true, variant: null, payload: null },
      })
    })

    it('short-circuits when the gate evaluates false, status from the gate', async () => {
      const res = await request(app.getHttpServer()).get('/beta/whole')

      // withFeatureFlag defaults to 404 on rejection.
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'feature_disabled', flag: 'beta' })
    })

    it('supports sub-field access via gateCtx(key)', async () => {
      const res = await request(app.getHttpServer())
        .get('/beta/field')
        .set('x-beta', '1')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ name: 'beta' })
    })

    it('@SupabaseCtx still reads the Supabase bag, untouched by the gate', async () => {
      // The whole-route test already covers this implicitly; pin it explicitly
      // so a future regression that bleeds gate state into supabaseContext is
      // visible.
      const res = await request(app.getHttpServer())
        .get('/beta/whole')
        .set('x-beta', '1')

      expect(res.body.mode).toBe('none')
    })
  },
)
