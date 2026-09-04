import { describe, expect, it } from 'vitest'
import { pipeline } from '@supabase/middleware'

import { isConstructionFailure } from '../../core/parts/construction-failure.js'
import { withSupabaseClient } from './index.js'

describe('withSupabaseClient construction failures', () => {
  it('brands the error thrown when the default publishable key is missing', async () => {
    const handler = pipeline(
      [
        withSupabaseClient({
          env: {
            url: 'https://test.supabase.co',
            publishableKeys: {},
            secretKeys: {},
            jwks: null,
          },
        }),
      ],
      async () => new Response('unreachable'),
    )

    await expect(handler(new Request('http://localhost'))).rejects.toSatisfy(
      isConstructionFailure,
    )
  })
})
