import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { XENDIT_API_VERSION, XenditProvider } from './xendit.provider';

const TOKEN = 'callback-token-123';

function provider() {
  return new XenditProvider(
    new ConfigService({
      xenditSecretKey: 'xnd_development_secret',
      xenditCallbackToken: TOKEN,
      xenditApiBase: 'https://api.xendit.test',
    }),
  );
}

const input = {
  paymentId: '11111111-1111-4111-8111-111111111111',
  orderId: '22222222-2222-4222-8222-222222222222',
  amount: 250_000,
  currency: 'IDR' as const,
  description: 'ONIC vs RRQ — venue ticket',
  expiresAt: new Date('2026-10-10T10:00:00Z'),
  displayName: 'Raka',
  successUrl: 'https://thumbz.test/ok',
  cancelUrl: 'https://thumbz.test/cancel',
  callbackUrl: 'https://api.thumbz.test/api/v1/webhooks/xendit',
};

describe('XenditProvider (Payments API v3)', () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('creates a QRIS payment request and returns the QR string', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          payment_request_id: 'pr-123',
          status: 'REQUIRES_ACTION',
          actions: [
            {
              type: 'PRESENT_TO_CUSTOMER',
              descriptor: 'QR_STRING',
              value: '00020101QR',
            },
          ],
        }),
        { status: 201 },
      ),
    );
    const created = await provider().create({ ...input, method: 'qris' });
    expect(created).toEqual({
      providerReference: 'pr-123',
      action: { kind: 'qr', qr_string: '00020101QR' },
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.xendit.test/v3/payment_requests');
    const headers = init.headers as Record<string, string>;
    expect(headers['api-version']).toBe(XENDIT_API_VERSION);
    expect(headers['idempotency-key']).toBe(input.paymentId);
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('xnd_development_secret:').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      reference_id: input.paymentId,
      type: 'PAY',
      country: 'ID',
      currency: 'IDR',
      request_amount: 250_000,
      channel_code: 'QRIS',
      channel_properties: { expires_at: '2026-10-10T10:00:00.000Z' },
    });
  });

  it('creates a BCA virtual account with the display name', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          payment_request_id: 'pr-va',
          actions: [
            {
              type: 'PRESENT_TO_CUSTOMER',
              descriptor: 'VIRTUAL_ACCOUNT_NUMBER',
              value: '8808123456',
            },
          ],
        }),
        { status: 201 },
      ),
    );
    const created = await provider().create({ ...input, method: 'va_bca' });
    expect(created.action).toEqual({
      kind: 'va',
      va_number: '8808123456',
      bank: 'BCA',
    });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      channel_code: 'BCA_VIRTUAL_ACCOUNT',
      channel_properties: { display_name: 'Raka' },
    });
  });

  it('turns provider errors into 503 without leaking details', async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"error_code":"API_VALIDATION_ERROR"}', { status: 400 }),
    );
    await expect(
      provider().create({ ...input, method: 'qris' }),
    ).rejects.toMatchObject({
      status: 503,
    });
  });

  it('authenticates webhooks with the callback token', () => {
    const body = Buffer.from(
      JSON.stringify({ event: 'payment.capture', data: { reference_id: 'r' } }),
    );
    expect(() =>
      provider().parseWebhook(body, { 'x-callback-token': 'wrong' }),
    ).toThrow(BadRequestException);
    expect(() => provider().parseWebhook(body, {})).toThrow(
      BadRequestException,
    );
  });

  it('normalizes a capture webhook with the captured amount', () => {
    const body = Buffer.from(
      JSON.stringify({
        event: 'payment.capture',
        data: {
          payment_id: 'py-1',
          payment_request_id: 'pr-1',
          reference_id: input.paymentId,
          status: 'SUCCEEDED',
          currency: 'IDR',
          request_amount: 250_000,
          captures: [{ capture_amount: 250_000 }],
        },
      }),
    );
    expect(
      provider().parseWebhook(body, { 'x-callback-token': TOKEN }),
    ).toMatchObject({
      eventKey: 'py-1:payment.capture',
      reference: input.paymentId,
      providerReference: 'pr-1',
      status: 'succeeded',
      amount: 250_000,
      currency: 'IDR',
    });
  });

  it('maps failures and reconciles via the payment request status', async () => {
    const failure = Buffer.from(
      JSON.stringify({
        event: 'payment.failure',
        data: { payment_id: 'py-2', reference_id: 'ref', status: 'FAILED' },
      }),
    );
    expect(
      provider().parseWebhook(failure, { 'x-callback-token': TOKEN })?.status,
    ).toBe('failed');

    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'EXPIRED',
          request_amount: 1,
          currency: 'IDR',
        }),
        { status: 200 },
      ),
    );
    await expect(
      provider().fetchStatus({ id: 'pay-1', providerReference: 'pr-9' }),
    ).resolves.toMatchObject({
      status: 'expired',
      reference: 'pay-1',
      eventKey: 'reconcile:pr-9:EXPIRED',
    });
  });
});
