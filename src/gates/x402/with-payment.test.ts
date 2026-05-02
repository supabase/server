import { describe, expect, it, vi } from 'vitest'

import {
  withPayment,
  type PaymentIntent,
  type PaymentState,
  type StripeLike,
  type SupabaseRpcClient,
} from './with-payment.js'

type Ctx = {
  payment: PaymentState
}

const innerOk = async () => Response.json({ ok: true })

const DEPOSIT_ADDRESS = '0xDEPOSITADDRESS'

const makePI = (status: string, id = 'pi_test_123'): PaymentIntent => ({
  id,
  status,
  next_action: {
    crypto_display_details: {
      deposit_addresses: { base: { address: DEPOSIT_ADDRESS } },
    },
  },
})

const makeStripeMock = (initialStatus = 'requires_action') => {
  const create = vi.fn().mockResolvedValue(makePI(initialStatus))
  const retrieve = vi.fn().mockResolvedValue(makePI(initialStatus))
  const stripe: StripeLike = { paymentIntents: { create, retrieve } }
  return { stripe, create, retrieve }
}

/** In-memory fake of the deposit-address → PI-id table the gate calls into. */
function makeFakeAdmin(): SupabaseRpcClient & {
  rpc: ReturnType<typeof vi.fn>
} {
  const map = new Map<string, string>()
  const rpc = vi.fn(
    async (
      fn: string,
      args: Record<string, unknown>,
    ): Promise<{ data: unknown; error: null }> => {
      if (fn === '_supabase_server_x402_register') {
        const addr = args.p_deposit_address as string
        const pi = args.p_payment_intent_id as string
        map.set(addr, pi)
        return { data: null, error: null }
      }
      if (fn === '_supabase_server_x402_lookup') {
        const addr = args.p_deposit_address as string
        return { data: map.get(addr) ?? null, error: null }
      }
      throw new Error(`unexpected rpc: ${fn}`)
    },
  )
  return { rpc } as SupabaseRpcClient & { rpc: typeof rpc }
}

const encodePayment = (to: string) =>
  btoa(JSON.stringify({ payload: { authorization: { to } } }))

describe('withPayment', () => {
  it('returns 402 with deposit address when X-PAYMENT is missing', async () => {
    const { stripe, create } = makeStripeMock()
    const supabaseAdmin = makeFakeAdmin()
    const handler = withPayment({ stripe, amountCents: 1 }, innerOk)

    const res = await handler(new Request('http://localhost/api/foo'), {
      supabaseAdmin,
    })

    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body).toEqual({
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'base',
          maxAmountRequired: '1',
          asset: 'USDC',
          payTo: DEPOSIT_ADDRESS,
          resource: '/api/foo',
          extra: { stripePaymentIntent: 'pi_test_123' },
        },
      ],
    })
    expect(create).toHaveBeenCalledOnce()
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      '_supabase_server_x402_register',
      {
        p_deposit_address: DEPOSIT_ADDRESS,
        p_payment_intent_id: 'pi_test_123',
      },
    )
  })

  it('runs handler when X-PAYMENT references a succeeded PaymentIntent', async () => {
    const { stripe, retrieve } = makeStripeMock()
    const supabaseAdmin = makeFakeAdmin()
    const inner = vi.fn(async (_req: Request, ctx: Ctx) => {
      expect(ctx.payment).toEqual({ intentId: 'pi_test_123' })
      return Response.json({ ok: true })
    })
    const handler = withPayment({ stripe, amountCents: 1 }, inner)

    // Seed the store via a first request.
    await handler(new Request('http://localhost/api/foo'), { supabaseAdmin })

    // Stripe reports the PI as settled on the retry.
    retrieve.mockResolvedValueOnce(makePI('succeeded'))

    const res = await handler(
      new Request('http://localhost/api/foo', {
        headers: { 'x-payment': encodePayment(DEPOSIT_ADDRESS) },
      }),
      { supabaseAdmin },
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(inner).toHaveBeenCalledOnce()
    expect(retrieve).toHaveBeenCalledWith('pi_test_123')
  })

  it('returns 402 when the PaymentIntent has not settled yet', async () => {
    const { stripe } = makeStripeMock('requires_action')
    const supabaseAdmin = makeFakeAdmin()
    const inner = vi.fn(innerOk)
    const handler = withPayment({ stripe, amountCents: 1 }, inner)

    await handler(new Request('http://localhost/api/foo'), { supabaseAdmin })

    const res = await handler(
      new Request('http://localhost/api/foo', {
        headers: { 'x-payment': encodePayment(DEPOSIT_ADDRESS) },
      }),
      { supabaseAdmin },
    )

    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body).toMatchObject({
      x402Version: 1,
      error: 'payment_not_settled',
      status: 'requires_action',
    })
    expect(inner).not.toHaveBeenCalled()
  })

  it('issues a fresh 402 when X-PAYMENT references an unknown deposit address', async () => {
    const { stripe, create, retrieve } = makeStripeMock()
    const supabaseAdmin = makeFakeAdmin()
    const inner = vi.fn(innerOk)
    const handler = withPayment({ stripe, amountCents: 1 }, inner)

    const res = await handler(
      new Request('http://localhost/api/foo', {
        headers: { 'x-payment': encodePayment('0xUNKNOWN') },
      }),
      { supabaseAdmin },
    )

    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.accepts?.[0]?.payTo).toBe(DEPOSIT_ADDRESS)
    expect(create).toHaveBeenCalledOnce()
    expect(retrieve).not.toHaveBeenCalled()
    expect(inner).not.toHaveBeenCalled()
  })

  it('issues a fresh 402 when X-PAYMENT is malformed', async () => {
    const { stripe, create } = makeStripeMock()
    const supabaseAdmin = makeFakeAdmin()
    const handler = withPayment({ stripe, amountCents: 1 }, innerOk)

    const res = await handler(
      new Request('http://localhost/api/foo', {
        headers: { 'x-payment': 'not-base64-json' },
      }),
      { supabaseAdmin },
    )

    expect(res.status).toBe(402)
    expect(create).toHaveBeenCalledOnce()
  })

  it('honors a custom network', async () => {
    const { stripe } = makeStripeMock()
    stripe.paymentIntents.create = vi.fn().mockResolvedValue({
      id: 'pi_custom',
      status: 'requires_action',
      next_action: {
        crypto_display_details: {
          deposit_addresses: { solana: { address: 'SOLADDRESS' } },
        },
      },
    })
    const supabaseAdmin = makeFakeAdmin()

    const handler = withPayment(
      { stripe, amountCents: 5, network: 'solana' },
      innerOk,
    )

    const res = await handler(new Request('http://localhost/api/foo'), {
      supabaseAdmin,
    })

    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.accepts[0].network).toBe('solana')
    expect(body.accepts[0].payTo).toBe('SOLADDRESS')
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      '_supabase_server_x402_register',
      { p_deposit_address: 'SOLADDRESS', p_payment_intent_id: 'pi_custom' },
    )
  })

  it('throws a helpful error when the lookup rpc is missing', async () => {
    const { stripe } = makeStripeMock()
    const supabaseAdmin = {
      rpc: vi.fn(async () => ({
        data: null,
        error: {
          code: '42883',
          message: 'function _supabase_server_x402_lookup does not exist',
        },
      })),
    } satisfies SupabaseRpcClient
    const handler = withPayment({ stripe, amountCents: 1 }, innerOk)

    await expect(
      handler(
        new Request('http://localhost/api/foo', {
          headers: { 'x-payment': encodePayment(DEPOSIT_ADDRESS) },
        }),
        { supabaseAdmin },
      ),
    ).rejects.toThrow(/lookup RPC .* not found/)
  })
})
