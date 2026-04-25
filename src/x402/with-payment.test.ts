import { describe, expect, it, vi } from 'vitest'

import { withPayment } from './with-payment.js'
import type {
  PaymentIntent,
  PaymentReceipt,
  StripeLike,
} from './with-payment.js'

type InnerHandler = (req: Request, receipt: PaymentReceipt) => Promise<Response>
const innerOk: InnerHandler = async () => Response.json({ ok: true })

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

const encodePayment = (to: string) =>
  btoa(JSON.stringify({ payload: { authorization: { to } } }))

describe('withPayment', () => {
  it('returns 402 with deposit address when X-PAYMENT is missing', async () => {
    const { stripe, create } = makeStripeMock()
    const handler = withPayment({ stripe, amountCents: 1 }, async () =>
      Response.json({ ok: true }),
    )

    const res = await handler(new Request('http://localhost/api/foo'))

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
    expect(create.mock.calls[0][0]).toMatchObject({
      amount: 1,
      currency: 'usd',
      payment_method_types: ['crypto'],
      payment_method_options: {
        crypto: { mode: 'deposit', deposit_options: { networks: ['base'] } },
      },
      confirm: true,
    })
  })

  it('runs handler when X-PAYMENT references a succeeded PaymentIntent', async () => {
    const { stripe, retrieve } = makeStripeMock()
    const inner = vi.fn<InnerHandler>(innerOk)
    const handler = withPayment({ stripe, amountCents: 1 }, inner)

    // Seed the store: first request creates the PI and registers its address.
    await handler(new Request('http://localhost/api/foo'))

    // Stripe reports the PI as settled on the retry.
    retrieve.mockResolvedValueOnce(makePI('succeeded'))

    const res = await handler(
      new Request('http://localhost/api/foo', {
        headers: { 'x-payment': encodePayment(DEPOSIT_ADDRESS) },
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(inner).toHaveBeenCalledOnce()
    expect(inner.mock.calls[0][1]).toEqual({ paymentIntentId: 'pi_test_123' })
    expect(retrieve).toHaveBeenCalledWith('pi_test_123')
  })

  it('returns 402 when the PaymentIntent has not settled yet', async () => {
    const { stripe } = makeStripeMock('requires_action')
    const inner = vi.fn<InnerHandler>(innerOk)
    const handler = withPayment({ stripe, amountCents: 1 }, inner)

    await handler(new Request('http://localhost/api/foo'))

    const res = await handler(
      new Request('http://localhost/api/foo', {
        headers: { 'x-payment': encodePayment(DEPOSIT_ADDRESS) },
      }),
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
    const inner = vi.fn<InnerHandler>(innerOk)
    const handler = withPayment({ stripe, amountCents: 1 }, inner)

    const res = await handler(
      new Request('http://localhost/api/foo', {
        headers: { 'x-payment': encodePayment('0xUNKNOWN') },
      }),
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
    const handler = withPayment({ stripe, amountCents: 1 }, async () =>
      Response.json({ ok: true }),
    )

    const res = await handler(
      new Request('http://localhost/api/foo', {
        headers: { 'x-payment': 'not-base64-json' },
      }),
    )

    expect(res.status).toBe(402)
    expect(create).toHaveBeenCalledOnce()
  })

  it('honors a custom store and network', async () => {
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

    const writes: Array<[string, string]> = []
    const store = {
      set: vi.fn(async (a: string, b: string) => {
        writes.push([a, b])
      }),
      get: vi.fn(async () => null),
    }

    const handler = withPayment(
      { stripe, amountCents: 5, network: 'solana', store },
      async () => Response.json({ ok: true }),
    )

    const res = await handler(new Request('http://localhost/api/foo'))

    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.accepts[0].network).toBe('solana')
    expect(body.accepts[0].payTo).toBe('SOLADDRESS')
    expect(writes).toEqual([['SOLADDRESS', 'pi_custom']])
  })
})
