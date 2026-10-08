import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { payment_method } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { METHODS } from '../payment-methods';
import {
  CreatedPayment,
  CreatePaymentInput,
  NormalizedEvent,
  NormalizedStatus,
  PaymentAction,
  PaymentProvider,
} from './payment-provider';

/** Xendit Payments API version this adapter is written against. */
export const XENDIT_API_VERSION = '2024-11-11';

interface XenditAction {
  type?: string;
  descriptor?: string;
  value?: string;
}

interface XenditPaymentRequest {
  payment_request_id?: string;
  reference_id?: string;
  status?: string;
  request_amount?: number;
  currency?: string;
  actions?: XenditAction[];
}

interface XenditWebhook {
  event?: string;
  data?: {
    payment_id?: string;
    payment_request_id?: string;
    reference_id?: string;
    status?: string;
    request_amount?: number;
    currency?: string;
    captures?: Array<{ capture_amount?: number }>;
  };
}

const REQUEST_STATUS: Record<string, NormalizedStatus> = {
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'failed',
  EXPIRED: 'expired',
};

const WEBHOOK_EVENT: Record<string, NormalizedStatus> = {
  'payment.capture': 'succeeded',
  'payment.failure': 'failed',
};

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * QRIS and bank virtual accounts through Xendit's Payments API v3
 * (POST /v3/payment_requests). The customer action comes back in `actions`
 * (QR_STRING / VIRTUAL_ACCOUNT_NUMBER); results arrive as payment.capture /
 * payment.failure webhooks authenticated by the x-callback-token header.
 */
@Injectable()
export class XenditProvider implements PaymentProvider {
  readonly id = 'xendit' as const;
  private readonly logger = new Logger(XenditProvider.name);
  private readonly secretKey: string | null;
  private readonly callbackToken: string | null;
  private readonly apiBase: string;

  constructor(config: ConfigService) {
    this.secretKey = config.get<string | null>('xenditSecretKey') ?? null;
    this.callbackToken =
      config.get<string | null>('xenditCallbackToken') ?? null;
    this.apiBase =
      config.get<string>('xenditApiBase') ?? 'https://api.xendit.co';
  }

  isConfigured(): boolean {
    return this.secretKey !== null && this.callbackToken !== null;
  }

  supports(method: payment_method): boolean {
    return METHODS[method].xenditChannel !== undefined;
  }

  private async call<T>(
    path: string,
    init: RequestInit & { idempotencyKey?: string },
  ): Promise<T> {
    const response = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.secretKey ?? ''}:`).toString('base64')}`,
        'api-version': XENDIT_API_VERSION,
        'Content-Type': 'application/json',
        ...(init.idempotencyKey
          ? { 'idempotency-key': init.idempotencyKey }
          : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `Xendit ${path} failed (${response.status}): ${body.slice(0, 300)}`,
      );
      throw new ServiceUnavailableException();
    }
    return (await response.json()) as T;
  }

  async create(input: CreatePaymentInput): Promise<CreatedPayment> {
    const info = METHODS[input.method];
    const channelProperties: Record<string, unknown> = {
      expires_at: input.expiresAt.toISOString(),
    };
    if (info.bank)
      channelProperties.display_name = input.displayName.slice(0, 50);

    const request = await this.call<XenditPaymentRequest>(
      '/v3/payment_requests',
      {
        method: 'POST',
        // Retries of the same attempt never create a second payment request.
        idempotencyKey: input.paymentId,
        body: JSON.stringify({
          reference_id: input.paymentId,
          type: 'PAY',
          country: 'ID',
          currency: 'IDR',
          request_amount: input.amount,
          capture_method: 'AUTOMATIC',
          channel_code: info.xenditChannel,
          channel_properties: channelProperties,
          description: input.description.slice(0, 1000),
          metadata: { order_id: input.orderId },
        }),
      },
    );
    return {
      providerReference: request.payment_request_id ?? null,
      action: this.actionOf(request, input.method),
    };
  }

  private actionOf(
    request: XenditPaymentRequest,
    method: payment_method,
  ): PaymentAction {
    const present = (descriptor: string) =>
      request.actions?.find(
        (action) =>
          action.type === 'PRESENT_TO_CUSTOMER' &&
          action.descriptor === descriptor,
      )?.value;
    const info = METHODS[method];
    if (method === 'qris') {
      const qr = present('QR_STRING');
      if (qr) return { kind: 'qr', qr_string: qr };
    } else if (info.bank) {
      const number = present('VIRTUAL_ACCOUNT_NUMBER');
      if (number) return { kind: 'va', va_number: number, bank: info.bank };
    }
    this.logger.error(
      `Xendit response for ${method} carried no customer action`,
    );
    throw new ServiceUnavailableException();
  }

  parseWebhook(
    rawBody: Buffer | undefined,
    headers: Record<string, unknown>,
  ): NormalizedEvent | null {
    const token = headers['x-callback-token'];
    if (
      this.callbackToken === null ||
      typeof token !== 'string' ||
      !safeEqual(token, this.callbackToken)
    ) {
      throw new BadRequestException();
    }
    let body: XenditWebhook;
    try {
      body = JSON.parse(rawBody?.toString('utf8') ?? '') as XenditWebhook;
    } catch {
      throw new BadRequestException();
    }
    const data = body.data;
    const status =
      (body.event && WEBHOOK_EVENT[body.event]) ??
      (data?.status ? REQUEST_STATUS[data.status] : undefined);
    if (!data?.reference_id || !status) return null;
    const captured = data.captures?.reduce(
      (sum, capture) => sum + (capture.capture_amount ?? 0),
      0,
    );
    return {
      eventKey: `${data.payment_id ?? data.payment_request_id}:${body.event ?? data.status}`,
      reference: data.reference_id,
      providerReference: data.payment_request_id ?? null,
      status,
      amount: captured || data.request_amount || null,
      currency: data.currency ?? null,
      payload: body,
    };
  }

  async fetchStatus(payment: {
    id: string;
    providerReference: string | null;
  }): Promise<NormalizedEvent | null> {
    if (!payment.providerReference) return null;
    const request = await this.call<XenditPaymentRequest>(
      `/v3/payment_requests/${encodeURIComponent(payment.providerReference)}`,
      { method: 'GET' },
    );
    const status = request.status ? REQUEST_STATUS[request.status] : undefined;
    if (!status) return null;
    return {
      eventKey: `reconcile:${payment.providerReference}:${request.status}`,
      reference: payment.id,
      providerReference: payment.providerReference,
      status,
      amount: status === 'succeeded' ? (request.request_amount ?? null) : null,
      currency: request.currency ?? null,
      payload: request,
    };
  }

  async simulate(payment: {
    providerReference: string | null;
    amount: number;
  }): Promise<void> {
    if (!payment.providerReference) throw new BadRequestException();
    await this.call(
      `/v3/payment_requests/${encodeURIComponent(payment.providerReference)}/simulate`,
      { method: 'POST', body: JSON.stringify({ amount: payment.amount }) },
    );
  }
}
