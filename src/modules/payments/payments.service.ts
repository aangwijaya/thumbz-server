import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  payment_method,
  payment_provider,
  payment_status,
  Prisma,
} from '@prisma/client';
import type { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import { isUniqueConstraintViolation } from '../../common/errors/prisma-errors';
import { orNotFound } from '../../common/utils/not-found';
import { DomainEvents } from '../../infra/events/domain-events';
import { PAYMENTS_QUEUE } from '../../infra/queue/queue.module';
import { PrismaService } from '../../prisma/prisma.service';
import { decide } from './order-state';
import { METHODS } from './payment-methods';
import { PaymentRouter } from './payment-router';
import type {
  NormalizedEvent,
  PaymentAction,
} from './providers/payment-provider';
import { SandboxProvider } from './providers/sandbox.provider';

export const APPLY_EVENT_JOB = 'apply-event';

/** A payment attempt as the API exposes it. */
export interface PaymentView {
  id: string;
  provider: payment_provider;
  method: payment_method;
  status: payment_status;
  currency: string;
  amount: number;
  kind: PaymentAction['kind'] | null;
  invoice_url: string | null;
  qr_string: string | null;
  va_number: string | null;
  bank: string | null;
  expires_at: Date;
  created_at: Date;
}

type PaymentRow = Prisma.PaymentGetPayload<object>;

export function toPaymentView(row: PaymentRow): PaymentView {
  const action = (row.action ?? null) as PaymentAction | null;
  return {
    id: row.id,
    provider: row.provider,
    method: row.method,
    status: row.status,
    currency: row.currency,
    amount: Number(row.amount),
    kind: action?.kind ?? null,
    invoice_url: action?.kind === 'redirect' ? action.url : null,
    qr_string: action?.kind === 'qr' ? action.qr_string : null,
    va_number: action?.kind === 'va' ? action.va_number : null,
    bank: action?.kind === 'va' ? action.bank : null,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

function ticketCode(): string {
  const raw = randomBytes(6).toString('hex').toUpperCase();
  return `THMZ-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

interface OrderForPayment {
  id: string;
  match_id: string;
  user_id: string;
  quantity: number;
  total_usd: Prisma.Decimal;
  expires_at: Date;
  status: string;
}

/**
 * Payment attempts and the webhook pipeline:
 *   provider webhook → verify → inbox row (deduplicated) → apply (row locks +
 *   state machine + idempotent ticket issuance) → domain events.
 * Applying happens inline for latency; if it fails the event is queued and the
 * worker retries with backoff. Reconciliation polls providers for missed
 * webhooks.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly router: PaymentRouter,
    private readonly sandbox: SandboxProvider,
    private readonly events: DomainEvents,
    private readonly config: ConfigService,
    @Optional() @InjectQueue(PAYMENTS_QUEUE) private readonly queue?: Queue,
  ) {}

  isMethodAvailable(method: payment_method): boolean {
    return this.router.providerFor(method) !== null;
  }

  /** Opens a new attempt for `order`; earlier pending attempts stop being payable. */
  async start(
    order: OrderForPayment,
    method: payment_method,
    description: string,
    displayName: string,
  ): Promise<PaymentView> {
    if (order.status !== 'pending' || order.expires_at <= new Date()) {
      throw new BusinessRuleException('this order can no longer be paid');
    }
    const provider = this.router.providerFor(method);
    if (!provider) throw new ServiceUnavailableException();

    const info = METHODS[method];
    let amount: number;
    if (info.family === 'crypto') {
      amount = Number(order.total_usd);
    } else {
      const config = await this.prisma.matchTicketConfig.findUnique({
        where: { match_id: order.match_id },
        select: { price_idr: true },
      });
      if (!config?.price_idr) {
        throw new BusinessRuleException(
          `${info.label} is not offered for this match`,
        );
      }
      amount = config.price_idr * order.quantity;
    }
    if (amount < info.minAmount) {
      throw new BusinessRuleException(
        `${info.label} needs at least ${info.minAmount} ${info.currency}`,
      );
    }

    await this.prisma.payment.updateMany({
      where: { order_id: order.id, status: 'pending' },
      data: { status: 'cancelled', failure_reason: 'superseded' },
    });
    const payment = await this.prisma.payment.create({
      data: {
        order_id: order.id,
        provider: provider.id,
        method,
        currency: info.currency,
        amount,
        expires_at: order.expires_at,
      },
    });

    const frontend =
      this.config.get<string>('frontendUrl') ?? 'http://localhost:3000';
    const api =
      this.config.get<string>('publicApiUrl') ?? 'http://localhost:3001';
    try {
      const created = await provider.create({
        paymentId: payment.id,
        orderId: order.id,
        method,
        amount,
        currency: info.currency,
        description,
        expiresAt: order.expires_at,
        displayName,
        successUrl: `${frontend}/me/orders/${order.id}?status=success`,
        cancelUrl: `${frontend}/me/orders/${order.id}?status=cancel`,
        callbackUrl: `${api}/api/v1/webhooks/${provider.id}`,
      });
      const updated = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          provider_reference: created.providerReference,
          action: created.action,
        },
      });
      return toPaymentView(updated);
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', failure_reason: 'provider_error' },
      });
      throw error instanceof BusinessRuleException
        ? error
        : new ServiceUnavailableException();
    }
  }

  /** Webhook entry point: verify, store, apply. Safe to call repeatedly. */
  async receive(
    providerId: payment_provider,
    rawBody: Buffer | undefined,
    headers: Record<string, unknown>,
  ): Promise<void> {
    const provider = this.router.byId(providerId);
    if (!provider.isConfigured()) throw new ServiceUnavailableException();
    const event = provider.parseWebhook(rawBody, headers);
    if (event) await this.ingest(providerId, event);
  }

  /** Stores an event once (inbox) and applies it; duplicates are acknowledged and skipped. */
  async ingest(
    providerId: payment_provider,
    event: NormalizedEvent,
  ): Promise<void> {
    let inbox: { id: string };
    try {
      inbox = await this.prisma.paymentEvent.create({
        data: {
          provider: providerId,
          event_key: event.eventKey,
          status: event.status,
          amount: event.amount ?? null,
          currency: event.currency ?? null,
          payload: event.payload ?? {},
          payment_id: await this.knownPaymentId(event.reference),
        },
        select: { id: true },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return; // already received
      throw error;
    }
    try {
      await this.apply(inbox.id, event.reference);
    } catch (error) {
      this.logger.warn(
        `inline apply of ${inbox.id} failed, queueing a retry: ${String(error)}`,
      );
      if (!this.queue) throw error;
      await this.queue.add(
        APPLY_EVENT_JOB,
        { eventId: inbox.id, reference: event.reference },
        {
          jobId: inbox.id,
        },
      );
    }
  }

  private async knownPaymentId(reference: string): Promise<string | null> {
    if (!/^[0-9a-f-]{36}$/i.test(reference)) return null;
    const payment = await this.prisma.payment.findUnique({
      where: { id: reference },
      select: { id: true },
    });
    return payment?.id ?? null;
  }

  /**
   * Applies one inbox event under row locks on the payment and its order, so
   * concurrent webhooks for the same order serialize. Idempotent: a processed
   * event is a no-op, and tickets are unique per (order_id, seq).
   */
  async apply(eventId: string, reference: string): Promise<string> {
    const after: Array<() => void> = [];
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        const event = await tx.paymentEvent.findUniqueOrThrow({
          where: { id: eventId },
        });
        if (event.processed_at) return event.outcome ?? 'processed';

        // Lock the payment row (our reference), then its order.
        const locked = await tx.$queryRaw<
          Array<{ id: string; order_id: string }>
        >`
          SELECT id, order_id FROM payments WHERE id::text = ${reference} FOR UPDATE`;
        if (locked.length === 0) {
          await tx.paymentEvent.update({
            where: { id: eventId },
            data: { processed_at: new Date(), outcome: 'unknown_payment' },
          });
          return 'unknown_payment';
        }
        await tx.$queryRaw`SELECT id FROM ticket_orders WHERE id = ${locked[0].order_id}::uuid FOR UPDATE`;
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: locked[0].id },
        });
        const order = await tx.ticketOrder.findUniqueOrThrow({
          where: { id: payment.order_id },
        });

        const paid = event.amount === null ? null : Number(event.amount);
        const amountOk =
          (event.currency === null ||
            event.currency.toUpperCase() === payment.currency) &&
          (paid === null || paid + 1e-6 >= Number(payment.amount));
        const quotaAvailable = await this.quotaAvailable(
          tx,
          order.match_id,
          order.id,
          order.quantity,
        );
        const decision = decide({
          order: order.status,
          payment: payment.status,
          event: event.status as NormalizedEvent['status'],
          amountOk,
          quotaAvailable,
        });

        if (decision.payment) {
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: decision.payment,
              failure_reason: decision.failureReason ?? payment.failure_reason,
              paid_at:
                decision.payment === 'succeeded' ? new Date() : payment.paid_at,
            },
          });
        }
        if (decision.cancelOtherAttempts) {
          await tx.payment.updateMany({
            where: {
              order_id: order.id,
              status: 'pending',
              id: { not: payment.id },
            },
            data: { status: 'cancelled', failure_reason: 'order_paid' },
          });
        }
        if (decision.order) {
          await tx.ticketOrder.update({
            where: { id: order.id },
            data: {
              status: decision.order,
              paid_at: decision.order === 'paid' ? new Date() : order.paid_at,
            },
          });
        }
        if (decision.issueTickets) {
          await this.issueTickets(tx, order);
        }
        if (decision.voidTickets) {
          await tx.ticket.updateMany({
            where: { order_id: order.id },
            data: { status: 'void' },
          });
        }
        await tx.paymentEvent.update({
          where: { id: eventId },
          data: {
            processed_at: new Date(),
            outcome: decision.outcome,
            payment_id: payment.id,
          },
        });

        if (decision.order || decision.payment) {
          after.push(() => {
            this.events.emit({
              type: 'order.changed',
              orderId: order.id,
              userId: order.user_id,
              matchId: order.match_id,
              status: decision.order ?? order.status,
            });
            this.events.emit({
              type: 'tickets.changed',
              matchId: order.match_id,
            });
          });
        }
        return decision.outcome;
      },
      { timeout: 15_000 },
    );
    // Only after commit: listeners never see uncommitted state.
    after.forEach((emit) => emit());
    if (
      outcome === 'amount_mismatch' ||
      outcome === 'refund_required' ||
      outcome === 'duplicate_payment'
    ) {
      this.logger.warn(`payment event ${eventId} needs attention: ${outcome}`);
    }
    return outcome;
  }

  private async quotaAvailable(
    tx: Prisma.TransactionClient,
    matchId: string,
    orderId: string,
    quantity: number,
  ): Promise<boolean> {
    const [config, sold, holds] = await Promise.all([
      tx.matchTicketConfig.findUnique({
        where: { match_id: matchId },
        select: { quota_total: true },
      }),
      tx.ticket.count({
        where: { match_id: matchId, status: { not: 'void' } },
      }),
      tx.ticketOrder.aggregate({
        where: {
          match_id: matchId,
          status: 'pending',
          expires_at: { gt: new Date() },
          id: { not: orderId },
        },
        _sum: { quantity: true },
      }),
    ]);
    if (!config) return false;
    return config.quota_total - sold - (holds._sum.quantity ?? 0) >= quantity;
  }

  /** Creates tickets 1..quantity; (order_id, seq) uniqueness makes this idempotent. */
  private async issueTickets(
    tx: Prisma.TransactionClient,
    order: OrderForPayment,
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await tx.ticket.findMany({
        where: { order_id: order.id },
        select: { seq: true },
      });
      const have = new Set(existing.map((ticket) => ticket.seq));
      const missing = Array.from(
        { length: order.quantity },
        (_, index) => index + 1,
      ).filter((seq) => !have.has(seq));
      if (missing.length === 0) return;
      await tx.ticket.createMany({
        data: missing.map((seq) => ({
          order_id: order.id,
          match_id: order.match_id,
          user_id: order.user_id,
          seq,
          code: ticketCode(),
        })),
        // A (vanishingly rare) code collision skips a row; the loop refills it.
        skipDuplicates: true,
      });
    }
    throw new Error(`could not issue tickets for order ${order.id}`);
  }

  /** Asks providers about pending attempts whose webhook may have been lost. */
  async reconcile(olderThanMs = 120_000, batch = 100): Promise<number> {
    const stale = await this.prisma.payment.findMany({
      where: {
        status: 'pending',
        created_at: { lt: new Date(Date.now() - olderThanMs) },
      },
      orderBy: { created_at: 'asc' },
      take: batch,
    });
    let resolved = 0;
    for (const payment of stale) {
      const provider = this.router.byId(payment.provider);
      try {
        const event = await provider.fetchStatus?.({
          id: payment.id,
          providerReference: payment.provider_reference,
        });
        if (event && event.status !== 'pending') {
          await this.ingest(payment.provider, event);
          resolved += 1;
        } else if (!provider.fetchStatus && payment.expires_at < new Date()) {
          // Providers without a status API: an attempt past its hold is dead.
          await this.ingest(payment.provider, {
            eventKey: `reconcile:${payment.id}:expired`,
            reference: payment.id,
            status: 'expired',
            payload: { reason: 'hold expired, no provider status API' },
          });
          resolved += 1;
        }
      } catch (error) {
        this.logger.warn(
          `reconciling payment ${payment.id} failed: ${String(error)}`,
        );
      }
    }
    return resolved;
  }

  /** Test mode: pay an attempt as the gateway would (owner only). */
  async simulate(paymentId: string, userId: string): Promise<void> {
    if (!this.config.get<boolean>('paymentsSandbox'))
      throw new ForbiddenException();
    const payment = orNotFound(
      await this.prisma.payment.findUnique({
        where: { id: paymentId },
        include: { order: { select: { user_id: true } } },
      }),
    );
    if (payment.order.user_id !== userId) throw new ForbiddenException();
    if (payment.status !== 'pending') throw new BadRequestException();

    if (payment.provider === 'sandbox') {
      await this.ingest(
        'sandbox',
        this.sandbox.paidEvent({
          id: payment.id,
          amount: Number(payment.amount),
          currency: payment.currency,
        }),
      );
      return;
    }
    const provider = this.router.byId(payment.provider);
    if (!provider.simulate)
      throw new BadRequestException('this provider cannot simulate');
    // The provider then sends its real webhook.
    await provider.simulate({
      id: payment.id,
      providerReference: payment.provider_reference,
      amount: Number(payment.amount),
    });
  }

  /** Latest attempt per order, for order views. */
  async latestFor(orderIds: string[]): Promise<Map<string, PaymentView>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.prisma.payment.findMany({
      where: { order_id: { in: orderIds } },
      orderBy: { created_at: 'desc' },
      distinct: ['order_id'],
    });
    return new Map(rows.map((row) => [row.order_id, toPaymentView(row)]));
  }
}
