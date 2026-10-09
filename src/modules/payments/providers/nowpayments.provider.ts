import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { payment_method } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CreatedPayment,
  CreatePaymentInput,
  NormalizedEvent,
  NormalizedStatus,
  PaymentProvider,
} from './payment-provider';

/** NOWPayments signs the JSON with keys sorted recursively. */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

const STATUS: Record<string, NormalizedStatus> = {
  finished: 'succeeded',
  confirmed: 'succeeded',
  failed: 'failed',
  refunded: 'refunded',
  expired: 'expired',
};

interface Ipn {
  payment_id?: string | number;
  payment_status?: string;
  order_id?: string;
  price_amount?: number | string;
  price_currency?: string;
}

/** Crypto via NOWPayments hosted invoices (merchant side converts to USDT). */
@Injectable()
export class NowPaymentsProvider implements PaymentProvider {
  readonly id = 'nowpayments' as const;
  private readonly logger = new Logger(NowPaymentsProvider.name);
  private readonly apiKey: string | null;
  private readonly ipnSecret: string | null;
  private readonly apiBase: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string | null>('nowpaymentsApiKey') ?? null;
    this.ipnSecret = config.get<string | null>('nowpaymentsIpnSecret') ?? null;
    this.apiBase =
      config.get<string>('nowpaymentsApiBase') ??
      'https://api-sandbox.nowpayments.io';
  }

  isConfigured(): boolean {
    return this.apiKey !== null && this.ipnSecret !== null;
  }

  supports(method: payment_method): boolean {
    return method === 'crypto';
  }

  async create(input: CreatePaymentInput): Promise<CreatedPayment> {
    const response = await fetch(`${this.apiBase}/v1/invoice`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        price_amount: input.amount,
        price_currency: 'usd',
        order_id: input.paymentId,
        order_description: input.description,
        ipn_callback_url: input.callbackUrl,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `invoice creation failed (${response.status}): ${body.slice(0, 200)}`,
      );
      throw new ServiceUnavailableException();
    }
    const body = (await response.json()) as {
      id?: string | number;
      invoice_url?: string;
    };
    if (typeof body.invoice_url !== 'string' || body.invoice_url === '') {
      throw new ServiceUnavailableException();
    }
    return {
      providerReference: body.id !== undefined ? String(body.id) : null,
      action: { kind: 'redirect', url: body.invoice_url },
    };
  }

  /** HMAC-SHA512 of the key-sorted JSON in `x-nowpayments-sig`. */
  verify(rawBody: Buffer | undefined, signature: unknown): boolean {
    if (this.ipnSecret === null || rawBody === undefined) return false;
    if (typeof signature !== 'string' || !/^[0-9a-f]+$/i.test(signature))
      return false;
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return false;
    }
    const expected = createHmac('sha512', this.ipnSecret)
      .update(JSON.stringify(sortValue(payload)))
      .digest();
    const received = Buffer.from(signature, 'hex');
    return (
      received.length === expected.length && timingSafeEqual(received, expected)
    );
  }

  parseWebhook(
    rawBody: Buffer | undefined,
    headers: Record<string, unknown>,
  ): NormalizedEvent | null {
    if (!this.verify(rawBody, headers['x-nowpayments-sig'])) {
      throw new BadRequestException();
    }
    const ipn = JSON.parse(rawBody!.toString('utf8')) as Ipn;
    if (
      typeof ipn.order_id !== 'string' ||
      typeof ipn.payment_status !== 'string'
    ) {
      return null; // well-signed but irrelevant
    }
    const amount =
      ipn.price_amount !== undefined ? Number(ipn.price_amount) : null;
    return {
      eventKey: `${ipn.payment_id ?? 'invoice'}:${ipn.payment_status}`,
      reference: ipn.order_id,
      providerReference:
        ipn.payment_id !== undefined ? String(ipn.payment_id) : null,
      status: STATUS[ipn.payment_status] ?? 'pending',
      amount: Number.isFinite(amount) ? amount : null,
      currency: ipn.price_currency?.toUpperCase() ?? null,
      payload: ipn,
    };
  }
}
