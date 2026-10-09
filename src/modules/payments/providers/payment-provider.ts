import type { payment_method, payment_provider } from '@prisma/client';

/** What the customer must do to pay. */
export type PaymentAction =
  | { kind: 'redirect'; url: string }
  | { kind: 'qr'; qr_string: string }
  | { kind: 'va'; va_number: string; bank: string };

export interface CreatePaymentInput {
  /** Our payment id: sent to the provider as its reference and echoed in webhooks. */
  paymentId: string;
  orderId: string;
  method: payment_method;
  amount: number;
  currency: 'USD' | 'IDR';
  description: string;
  expiresAt: Date;
  displayName: string;
  successUrl: string;
  cancelUrl: string;
  callbackUrl: string;
}

export interface CreatedPayment {
  /** The provider's own id (for reconciliation and support). */
  providerReference: string | null;
  action: PaymentAction;
}

export type NormalizedStatus =
  'succeeded' | 'failed' | 'expired' | 'refunded' | 'pending';

/** A provider notification reduced to what the order state machine needs. */
export interface NormalizedEvent {
  /** Provider-unique id of this notification: the inbox deduplicates on it. */
  eventKey: string;
  /** Our payment id (the reference we gave the provider). */
  reference: string;
  providerReference?: string | null;
  status: NormalizedStatus;
  /** Amount actually paid in `currency`, when the provider reports it. */
  amount?: number | null;
  currency?: string | null;
  payload: unknown;
}

/**
 * One payment gateway. Adding a gateway means implementing this interface
 * and registering it with the PaymentRouter; order logic never changes.
 */
export interface PaymentProvider {
  readonly id: payment_provider;
  isConfigured(): boolean;
  supports(method: payment_method): boolean;
  create(input: CreatePaymentInput): Promise<CreatedPayment>;
  /** Verifies authenticity and parses a webhook; throws BadRequestException if not genuine. */
  parseWebhook(
    rawBody: Buffer | undefined,
    headers: Record<string, unknown>,
  ): NormalizedEvent | null;
  /** Current status at the provider (reconciliation for missed webhooks), when supported. */
  fetchStatus?(payment: {
    id: string;
    providerReference: string | null;
  }): Promise<NormalizedEvent | null>;
  /** Test mode only: makes the provider act as if the customer paid. */
  simulate?(payment: {
    id: string;
    providerReference: string | null;
    amount: number;
  }): Promise<void>;
}

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
