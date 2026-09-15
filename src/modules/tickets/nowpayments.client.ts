import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface NowPaymentsInvoice {
  invoiceUrl: string;
  providerInvoiceId: string | null;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
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

@Injectable()
export class NowPaymentsClient {
  private readonly logger = new Logger(NowPaymentsClient.name);
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

  async createInvoice(input: {
    orderId: string;
    priceUsd: number;
    description: string;
    successUrl: string;
    cancelUrl: string;
    ipnUrl: string;
  }): Promise<NowPaymentsInvoice> {
    if (this.apiKey === null) {
      throw new ServiceUnavailableException();
    }

    const response = await fetch(`${this.apiBase}/v1/invoice`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        price_amount: input.priceUsd,
        price_currency: 'usd',
        order_id: input.orderId,
        order_description: input.description,
        ipn_callback_url: input.ipnUrl,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `NOWPayments invoice creation failed (${response.status}): ${body.slice(0, 200)}`,
      );
      throw new ServiceUnavailableException();
    }

    const body = (await response.json()) as {
      id?: string | number;
      invoice_url?: string;
    };
    if (typeof body.invoice_url !== 'string' || body.invoice_url === '') {
      this.logger.error('NOWPayments invoice response missing invoice_url');
      throw new ServiceUnavailableException();
    }

    return {
      invoiceUrl: body.invoice_url,
      providerInvoiceId: body.id !== undefined ? String(body.id) : null,
    };
  }

  verifyIpn(rawBody: Buffer | undefined, signature: unknown): boolean {
    if (this.ipnSecret === null) {
      return false;
    }
    if (
      rawBody === undefined ||
      typeof signature !== 'string' ||
      signature === ''
    ) {
      return false;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return false;
    }

    const expected = createHmac('sha512', this.ipnSecret)
      .update(JSON.stringify(sortValue(payload)))
      .digest();
    let received: Buffer;
    try {
      received = Buffer.from(signature, 'hex');
    } catch {
      return false;
    }
    if (received.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(received, expected);
  }
}
