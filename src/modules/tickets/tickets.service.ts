import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { payment_method, Prisma, ticket_order_status } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import {
  PRISMA_SERIALIZATION_FAILURE,
  prismaErrorCode,
} from '../../common/errors/prisma-errors';
import { orNotFound } from '../../common/utils/not-found';
import {
  buildPaginationMeta,
  PaginationMeta,
} from '../../common/utils/pagination';
import { DomainEvents } from '../../infra/events/domain-events';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MatchSummary,
  SUMMARY_INCLUDE,
  toMatchSummary,
} from '../matches/matches.service';
import { MethodOption, PaymentRouter } from '../payments/payment-router';
import { PaymentsService, PaymentView } from '../payments/payments.service';
import { TicketSigner } from '../payments/ticket-signer';
import { AdminOrdersDto } from './dto/admin-orders.dto';
import { ListMyOrdersDto } from './dto/list-my-orders.dto';
import { ListMyTicketsDto } from './dto/list-my-tickets.dto';
import { TicketConfigDto } from './dto/ticket-config.dto';

const HOLD_MINUTES = 30;
const MAX_PER_USER_PER_MATCH = 4;

export interface TicketAvailability {
  match_id: string;
  venue_name: string;
  venue_city: string | null;
  price_usd: number;
  /** Price for IDR methods (QRIS / bank VA); null = crypto only. */
  price_idr: number | null;
  quota_total: number;
  quota_remaining: number;
  sales_open_at: Date | null;
  sales_close_at: Date | null;
  on_sale: boolean;
  /** Methods a buyer can pay with right now (gateway configured + priced). */
  payment_methods: MethodOption[];
}

type LegacyPayment = {
  provider: string;
  invoice_url: string | null;
  payment_id: string | null;
};

export interface TicketOrderView {
  id: string;
  match_id: string;
  quantity: number;
  unit_price_usd: number;
  total_usd: number;
  status: ticket_order_status;
  expires_at: Date;
  created_at: Date;
  paid_at: Date | null;
  /**
   * The latest payment attempt: method, what to show the buyer (invoice URL,
   * QRIS string or VA number) and its status. `payment_id` stays for older
   * clients; orders created before multi-provider payments keep the legacy shape.
   */
  payment: (PaymentView & { payment_id: string }) | LegacyPayment;
}

export interface MatchTicketView {
  id: string;
  match_id: string;
  order_id: string;
  code: string;
  /** Signed payload to render as the QR code (THMZ1.<code>.<mac>). */
  qr_payload: string;
  status: string;
  issued_at: Date;
  match?: MatchSummary;
}

export type CheckInResult = 'checked_in' | 'already_used' | 'void' | 'invalid';

type OrderRow = Prisma.TicketOrderGetPayload<object>;

function isSerializationFailure(error: unknown): boolean {
  return prismaErrorCode(error) === PRISMA_SERIALIZATION_FAILURE;
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly router: PaymentRouter,
    private readonly signer: TicketSigner,
    private readonly events: DomainEvents,
  ) {}

  async availability(
    matchId: string,
  ): Promise<{ data: TicketAvailability | null }> {
    orNotFound(
      await this.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true },
      }),
    );
    await this.releaseExpiredHolds(matchId);
    const all = await this.availabilityForMatches([matchId]);
    return { data: all.get(matchId) ?? null };
  }

  async availabilityForMatches(
    matchIds: string[],
  ): Promise<Map<string, TicketAvailability | null>> {
    const result = new Map<string, TicketAvailability | null>();
    if (matchIds.length === 0) return result;
    const now = new Date();
    // Independent reads: run them concurrently, not one after another.
    const [configs, matches, ticketCounts, holds] = await Promise.all([
      this.prisma.matchTicketConfig.findMany({
        where: { match_id: { in: matchIds } },
      }),
      this.prisma.match.findMany({
        where: { id: { in: matchIds } },
        select: { id: true, status: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['match_id'],
        where: { match_id: { in: matchIds }, status: { not: 'void' } },
        _count: true,
      }),
      this.prisma.ticketOrder.groupBy({
        by: ['match_id'],
        where: {
          match_id: { in: matchIds },
          status: 'pending',
          expires_at: { gt: now },
        },
        _sum: { quantity: true },
      }),
    ]);
    const statusByMatch = new Map(matches.map((m) => [m.id, m.status]));
    const soldByMatch = new Map(
      ticketCounts.map((t) => [t.match_id, t._count]),
    );
    const heldByMatch = new Map(
      holds.map((h) => [h.match_id, h._sum?.quantity ?? 0]),
    );
    const configByMatch = new Map(configs.map((c) => [c.match_id, c]));

    for (const id of matchIds) {
      const config = configByMatch.get(id);
      if (!config) {
        result.set(id, null);
        continue;
      }
      const remaining = Math.max(
        0,
        config.quota_total -
          (soldByMatch.get(id) ?? 0) -
          (heldByMatch.get(id) ?? 0),
      );
      const status = statusByMatch.get(id);
      result.set(id, {
        match_id: id,
        venue_name: config.venue_name,
        venue_city: config.venue_city,
        price_usd: Number(config.price_usd),
        price_idr: config.price_idr,
        quota_total: config.quota_total,
        quota_remaining: remaining,
        sales_open_at: config.sales_open_at,
        sales_close_at: config.sales_close_at,
        on_sale:
          this.windowOpen(config) &&
          (status === 'scheduled' || status === 'live') &&
          remaining > 0,
        payment_methods: this.router.methodsFor({
          usd: Number(config.price_usd),
          idr: config.price_idr,
        }),
      });
    }
    return result;
  }

  async createOrder(
    matchId: string,
    user: CurrentUser,
    quantity: number,
    method: payment_method = 'crypto',
  ): Promise<{ data: TicketOrderView }> {
    // Check before taking a hold: no gateway, no order.
    if (!this.payments.isMethodAvailable(method)) {
      throw new ServiceUnavailableException();
    }
    const match = orNotFound(
      await this.prisma.match.findUnique({
        where: { id: matchId },
        select: {
          id: true,
          status: true,
          teamA: { select: { name: true } },
          teamB: { select: { name: true } },
        },
      }),
    );
    await this.releaseExpiredHolds(matchId);

    const order = await this.withSerializableRetry(async (tx) => {
      const config = await tx.matchTicketConfig.findUnique({
        where: { match_id: matchId },
      });
      if (
        config === null ||
        !this.windowOpen(config) ||
        (match.status !== 'scheduled' && match.status !== 'live')
      ) {
        throw new BusinessRuleException('tickets are not on sale');
      }
      const [sold, holds] = await Promise.all([
        tx.ticket.count({
          where: { match_id: matchId, status: { not: 'void' } },
        }),
        tx.ticketOrder.aggregate({
          where: { match_id: matchId, status: 'pending' },
          _sum: { quantity: true },
        }),
      ]);
      const remaining = Math.max(
        0,
        config.quota_total - sold - (holds._sum.quantity ?? 0),
      );
      if (quantity > remaining) {
        throw new BusinessRuleException('quota exceeded');
      }
      const own = await tx.ticketOrder.aggregate({
        where: {
          match_id: matchId,
          user_id: user.sub,
          status: { in: ['pending', 'paid'] },
        },
        _sum: { quantity: true },
      });
      if ((own._sum.quantity ?? 0) + quantity > MAX_PER_USER_PER_MATCH) {
        throw new BusinessRuleException(
          `at most ${MAX_PER_USER_PER_MATCH} tickets per user per match`,
        );
      }
      return tx.ticketOrder.create({
        data: {
          match_id: matchId,
          user_id: user.sub,
          quantity,
          unit_price_usd: config.price_usd,
          total_usd: config.price_usd.mul(quantity),
          status: 'pending',
          expires_at: new Date(Date.now() + HOLD_MINUTES * 60_000),
        },
      });
    });
    // The hold reduces availability immediately.
    this.events.emit({ type: 'tickets.changed', matchId });

    try {
      const payment = await this.payments.start(
        order,
        method,
        `${match.teamA.name} vs ${match.teamB.name} — venue ticket`,
        user.name ?? 'THUMBZ ticket',
      );
      return { data: this.toOrderView(order, payment) };
    } catch (error) {
      await this.prisma.ticketOrder.updateMany({
        where: { id: order.id, status: 'pending' },
        data: { status: 'failed' },
      });
      this.events.emit({ type: 'tickets.changed', matchId });
      throw error;
    }
  }

  /** New attempt for a pending order (e.g. switch from QRIS to a bank VA). */
  async startPayment(
    user: CurrentUser,
    orderId: string,
    method: payment_method,
  ): Promise<{ data: TicketOrderView }> {
    const order = orNotFound(
      await this.prisma.ticketOrder.findFirst({
        where: { id: orderId, user_id: user.sub },
        include: {
          match: {
            select: {
              teamA: { select: { name: true } },
              teamB: { select: { name: true } },
            },
          },
        },
      }),
    );
    if (!this.payments.isMethodAvailable(method)) {
      throw new ServiceUnavailableException();
    }
    const payment = await this.payments.start(
      order,
      method,
      `${order.match.teamA.name} vs ${order.match.teamB.name} — venue ticket`,
      user.name ?? 'THUMBZ ticket',
    );
    return { data: this.toOrderView(order, payment) };
  }

  async listOrders(
    user: CurrentUser,
    query: ListMyOrdersDto,
  ): Promise<{ data: TicketOrderView[]; meta: PaginationMeta }> {
    const where: Prisma.TicketOrderWhereInput = { user_id: user.sub };
    if (query.status) where.status = query.status;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ticketOrder.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.ticketOrder.count({ where }),
    ]);
    const latest = await this.payments.latestFor(rows.map((row) => row.id));
    return {
      data: rows.map((row) => this.toOrderView(row, latest.get(row.id))),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async getOrder(
    user: CurrentUser,
    id: string,
  ): Promise<{ data: TicketOrderView; tickets: MatchTicketView[] }> {
    const row = orNotFound(
      await this.prisma.ticketOrder.findFirst({
        where: { id, user_id: user.sub },
        include: { tickets: { orderBy: { seq: 'asc' } } },
      }),
    );
    const latest = await this.payments.latestFor([row.id]);
    return {
      data: this.toOrderView(row, latest.get(row.id)),
      tickets: row.tickets.map((ticket) => this.toTicketView(ticket)),
    };
  }

  async cancelOrder(user: CurrentUser, id: string): Promise<void> {
    const row = orNotFound(
      await this.prisma.ticketOrder.findFirst({
        where: { id, user_id: user.sub },
        select: { id: true, status: true, match_id: true },
      }),
    );
    if (row.status === 'paid') {
      throw new BusinessRuleException(
        'paid orders cannot be cancelled; payments are not refunded automatically',
      );
    }
    const cancelled = await this.prisma.ticketOrder.updateMany({
      where: { id, user_id: user.sub, status: 'pending' },
      data: { status: 'cancelled' },
    });
    if (cancelled.count > 0) {
      await this.prisma.payment.updateMany({
        where: { order_id: id, status: 'pending' },
        data: { status: 'cancelled', failure_reason: 'order_cancelled' },
      });
      this.events.emit({ type: 'tickets.changed', matchId: row.match_id });
    }
  }

  async listTickets(
    user: CurrentUser,
    query: ListMyTicketsDto,
  ): Promise<{ data: MatchTicketView[]; meta: PaginationMeta }> {
    const where: Prisma.TicketWhereInput = { user_id: user.sub };
    if (query.match_id) where.match_id = query.match_id;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        orderBy: { issued_at: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { match: { include: SUMMARY_INCLUDE } },
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        ...this.toTicketView(row),
        match: toMatchSummary(row.match),
      })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  /** Venue gate: verifies the signed QR payload and admits each ticket once. */
  async checkIn(
    payload: string,
  ): Promise<{ data: { result: CheckInResult; code?: string } }> {
    const code = this.signer.verify(payload);
    if (!code) return { data: { result: 'invalid' } };
    const admitted = await this.prisma.ticket.updateMany({
      where: { code, status: 'valid' },
      data: { status: 'used' },
    });
    if (admitted.count === 1) return { data: { result: 'checked_in', code } };
    const ticket = await this.prisma.ticket.findUnique({
      where: { code },
      select: { status: true },
    });
    const result: CheckInResult =
      ticket?.status === 'used'
        ? 'already_used'
        : ticket?.status === 'void'
          ? 'void'
          : 'invalid';
    return { data: { result, code } };
  }

  async upsertConfig(
    matchId: string,
    dto: TicketConfigDto,
  ): Promise<{ data: TicketAvailability }> {
    orNotFound(
      await this.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true },
      }),
    );
    await this.releaseExpiredHolds(matchId);
    const used = await this.usedQuota(matchId);
    if (dto.quota_total < used) {
      throw new BusinessRuleException(
        `quota_total cannot be below the ${used} tickets already sold/held`,
      );
    }
    const data = {
      venue_name: dto.venue_name,
      venue_city: dto.venue_city ?? null,
      price_usd: new Prisma.Decimal(dto.price_usd),
      price_idr: dto.price_idr ?? null,
      quota_total: dto.quota_total,
      sales_open_at:
        dto.sales_open_at !== undefined ? new Date(dto.sales_open_at) : null,
      sales_close_at:
        dto.sales_close_at !== undefined ? new Date(dto.sales_close_at) : null,
      is_active: dto.is_active ?? true,
    };
    await this.prisma.matchTicketConfig.upsert({
      where: { match_id: matchId },
      create: { match_id: matchId, ...data },
      update: data,
    });
    this.events.emit({ type: 'tickets.changed', matchId });
    const all = await this.availabilityForMatches([matchId]);
    return { data: all.get(matchId)! };
  }

  async adminListOrders(query: AdminOrdersDto): Promise<{
    data: Array<TicketOrderView & { user_id: string }>;
    meta: PaginationMeta;
  }> {
    const where: Prisma.TicketOrderWhereInput = {};
    if (query.match_id) where.match_id = query.match_id;
    if (query.status) where.status = query.status;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ticketOrder.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.ticketOrder.count({ where }),
    ]);
    const latest = await this.payments.latestFor(rows.map((row) => row.id));
    return {
      data: rows.map((row) => ({
        ...this.toOrderView(row, latest.get(row.id)),
        user_id: row.user_id,
      })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  /**
   * Expires pending orders whose hold ran out (scheduled job). Holds were
   * previously only released lazily on the next checkout of that match, so
   * GET /me/orders/:id kept answering "pending" after expires_at.
   */
  async expireStaleHolds(now = new Date(), batch = 500): Promise<number> {
    const stale = await this.prisma.ticketOrder.findMany({
      where: { status: 'pending', expires_at: { lt: now } },
      select: { id: true, match_id: true, user_id: true },
      take: batch,
    });
    if (stale.length === 0) return 0;
    const expired = await this.prisma.ticketOrder.updateMany({
      // Re-check the status: a payment may have landed in between.
      where: { id: { in: stale.map((order) => order.id) }, status: 'pending' },
      data: { status: 'expired' },
    });
    for (const order of stale) {
      this.events.emit({
        type: 'order.changed',
        orderId: order.id,
        userId: order.user_id,
        matchId: order.match_id,
        status: 'expired',
      });
    }
    for (const matchId of new Set(stale.map((order) => order.match_id))) {
      this.events.emit({ type: 'tickets.changed', matchId });
    }
    return expired.count;
  }

  private toOrderView(row: OrderRow, payment?: PaymentView): TicketOrderView {
    return {
      id: row.id,
      match_id: row.match_id,
      quantity: row.quantity,
      unit_price_usd: Number(row.unit_price_usd),
      total_usd: Number(row.total_usd),
      status: row.status,
      expires_at: row.expires_at,
      created_at: row.created_at,
      paid_at: row.paid_at,
      payment: payment
        ? { ...payment, payment_id: payment.id }
        : {
            provider: row.provider,
            invoice_url: row.invoice_url,
            payment_id: row.provider_payment_id,
          },
    };
  }

  private toTicketView(row: {
    id: string;
    match_id: string;
    order_id: string;
    code: string;
    status: string;
    issued_at: Date;
  }): MatchTicketView {
    return {
      id: row.id,
      match_id: row.match_id,
      order_id: row.order_id,
      code: row.code,
      qr_payload: this.signer.sign(row.code),
      status: row.status,
      issued_at: row.issued_at,
    };
  }

  private windowOpen(config: {
    is_active: boolean;
    sales_open_at: Date | null;
    sales_close_at: Date | null;
  }): boolean {
    const now = Date.now();
    if (!config.is_active) return false;
    if (config.sales_open_at !== null && config.sales_open_at.getTime() > now) {
      return false;
    }
    if (
      config.sales_close_at !== null &&
      config.sales_close_at.getTime() < now
    ) {
      return false;
    }
    return true;
  }

  private async releaseExpiredHolds(matchId: string): Promise<void> {
    await this.prisma.ticketOrder.updateMany({
      where: {
        match_id: matchId,
        status: 'pending',
        expires_at: { lt: new Date() },
      },
      data: { status: 'expired' },
    });
  }

  private async usedQuota(matchId: string): Promise<number> {
    const [tickets, holds] = await this.prisma.$transaction([
      this.prisma.ticket.count({
        where: { match_id: matchId, status: { not: 'void' } },
      }),
      this.prisma.ticketOrder.aggregate({
        where: { match_id: matchId, status: 'pending' },
        _sum: { quantity: true },
      }),
    ]);
    return tickets + (holds._sum.quantity ?? 0);
  }

  private async withSerializableRetry<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    attempts = 3,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (attempt < attempts && isSerializationFailure(error)) continue;
        throw error;
      }
    }
  }
}
