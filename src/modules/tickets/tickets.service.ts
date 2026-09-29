import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ticket_order_status } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import {
  PaginationMeta,
  buildPaginationMeta,
} from '../../common/utils/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MatchSummary,
  SUMMARY_INCLUDE,
  toMatchSummary,
} from '../matches/matches.service';
import { AdminOrdersDto } from './dto/admin-orders.dto';
import { ListMyOrdersDto } from './dto/list-my-orders.dto';
import { ListMyTicketsDto } from './dto/list-my-tickets.dto';
import { TicketConfigDto } from './dto/ticket-config.dto';
import { NowPaymentsClient } from './nowpayments.client';

const HOLD_MINUTES = 30;
const MAX_PER_USER_PER_MATCH = 4;

export interface TicketAvailability {
  match_id: string;
  venue_name: string;
  venue_city: string | null;
  price_usd: number;
  quota_total: number;
  quota_remaining: number;
  sales_open_at: Date | null;
  sales_close_at: Date | null;
  on_sale: boolean;
}

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
  payment: {
    provider: string;
    invoice_url: string | null;
    payment_id: string | null;
  };
}

export interface MatchTicketView {
  id: string;
  match_id: string;
  order_id: string;
  code: string;
  status: string;
  issued_at: Date;
  match?: MatchSummary;
}

type OrderRow = Prisma.TicketOrderGetPayload<object>;

function toOrderView(row: OrderRow): TicketOrderView {
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
    payment: {
      provider: row.provider,
      invoice_url: row.invoice_url,
      payment_id: row.provider_payment_id,
    },
  };
}

function generateTicketCode(): string {
  const raw = randomBytes(6).toString('hex').toUpperCase();
  return `THMZ-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2034'
  );
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: NowPaymentsClient,
    private readonly config: ConfigService,
  ) {}

  async availability(
    matchId: string,
  ): Promise<{ data: TicketAvailability | null }> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, status: true },
    });
    if (match === null) {
      throw new NotFoundException();
    }

    await this.releaseExpiredHolds(matchId);

    const config = await this.prisma.matchTicketConfig.findUnique({
      where: { match_id: matchId },
    });
    if (config === null) {
      return { data: null };
    }

    const remaining = await this.remainingQuota(matchId, config.quota_total);
    return {
      data: {
        match_id: matchId,
        venue_name: config.venue_name,
        venue_city: config.venue_city,
        price_usd: Number(config.price_usd),
        quota_total: config.quota_total,
        quota_remaining: remaining,
        sales_open_at: config.sales_open_at,
        sales_close_at: config.sales_close_at,
        on_sale:
          this.windowOpen(config) &&
          (match.status === 'scheduled' || match.status === 'live') &&
          remaining > 0,
      },
    };
  }

  async availabilityForMatches(
    matchIds: string[],
  ): Promise<Map<string, TicketAvailability | null>> {
    const result = new Map<string, TicketAvailability | null>();
    if (matchIds.length === 0) {
      return result;
    }
    const now = new Date();
    const configs = await this.prisma.matchTicketConfig.findMany({
      where: { match_id: { in: matchIds } },
    });
    const matches = await this.prisma.match.findMany({
      where: { id: { in: matchIds } },
      select: { id: true, status: true },
    });
    const ticketCounts = await this.prisma.ticket.groupBy({
      by: ['match_id'],
      where: { match_id: { in: matchIds } },
      _count: true,
    });
    const holds = await this.prisma.ticketOrder.groupBy({
      by: ['match_id'],
      where: {
        match_id: { in: matchIds },
        status: 'pending',
        expires_at: { gt: now },
      },
      _sum: { quantity: true },
    });
    const configByMatch = new Map(configs.map((c) => [c.match_id, c]));
    const statusByMatch = new Map(matches.map((m) => [m.id, m.status]));
    const soldByMatch = new Map(
      ticketCounts.map((t) => [t.match_id, t._count]),
    );
    const heldByMatch = new Map(
      holds.map((h) => [h.match_id, h._sum?.quantity ?? 0]),
    );

    for (const id of matchIds) {
      const config = configByMatch.get(id);
      if (config === undefined) {
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
        quota_total: config.quota_total,
        quota_remaining: remaining,
        sales_open_at: config.sales_open_at,
        sales_close_at: config.sales_close_at,
        on_sale:
          this.windowOpen(config) &&
          (status === 'scheduled' || status === 'live') &&
          remaining > 0,
      });
    }
    return result;
  }

  async createOrder(
    matchId: string,
    user: CurrentUser,
    quantity: number,
  ): Promise<{ data: TicketOrderView }> {
    if (!this.provider.isConfigured()) {
      throw new ServiceUnavailableException();
    }

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        status: true,
        teamA: { select: { name: true } },
        teamB: { select: { name: true } },
      },
    });
    if (match === null) {
      throw new NotFoundException();
    }

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

      const [soldTickets, holds] = await Promise.all([
        tx.ticket.count({ where: { match_id: matchId } }),
        tx.ticketOrder.aggregate({
          where: { match_id: matchId, status: 'pending' },
          _sum: { quantity: true },
        }),
      ]);
      const remaining = Math.max(
        0,
        config.quota_total - soldTickets - (holds._sum.quantity ?? 0),
      );
      if (quantity > remaining) {
        throw new BusinessRuleException('quota exceeded');
      }

      const ownTickets = await tx.ticketOrder.aggregate({
        where: {
          match_id: matchId,
          user_id: user.sub,
          status: { in: ['pending', 'paid'] },
        },
        _sum: { quantity: true },
      });
      const ownQuantity = ownTickets._sum.quantity ?? 0;
      if (ownQuantity + quantity > MAX_PER_USER_PER_MATCH) {
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

    const feBase =
      this.config.get<string[]>('corsOrigins')?.[0] ?? 'http://localhost:3000';
    const apiBase =
      this.config.get<string>('publicApiUrl') ?? 'http://localhost:3001';
    try {
      const invoice = await this.provider.createInvoice({
        orderId: order.id,
        priceUsd: Number(order.total_usd),
        description: `${match.teamA.name} vs ${match.teamB.name} — venue ticket`,
        successUrl: `${feBase}/orders/${order.id}?status=success`,
        cancelUrl: `${feBase}/orders/${order.id}?status=cancel`,
        ipnUrl: `${apiBase}/api/v1/webhooks/nowpayments`,
      });
      const updated = await this.prisma.ticketOrder.update({
        where: { id: order.id },
        data: { invoice_url: invoice.invoiceUrl },
      });
      return { data: toOrderView(updated) };
    } catch (error) {
      await this.prisma.ticketOrder.updateMany({
        where: { id: order.id, status: 'pending' },
        data: { status: 'failed' },
      });
      throw error;
    }
  }

  async listOrders(
    user: CurrentUser,
    query: ListMyOrdersDto,
  ): Promise<{ data: TicketOrderView[]; meta: PaginationMeta }> {
    const where: Prisma.TicketOrderWhereInput = { user_id: user.sub };
    if (query.status) {
      where.status = query.status;
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ticketOrder.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.ticketOrder.count({ where }),
    ]);
    return {
      data: rows.map(toOrderView),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async getOrder(
    user: CurrentUser,
    id: string,
  ): Promise<{ data: TicketOrderView; tickets: MatchTicketView[] }> {
    const row = await this.prisma.ticketOrder.findFirst({
      where: { id, user_id: user.sub },
      include: { tickets: { orderBy: { issued_at: 'asc' } } },
    });
    if (row === null) {
      throw new NotFoundException();
    }
    return {
      data: toOrderView(row),
      tickets: row.tickets.map((ticket) => this.toTicketView(ticket)),
    };
  }

  async cancelOrder(user: CurrentUser, id: string): Promise<void> {
    const row = await this.prisma.ticketOrder.findFirst({
      where: { id, user_id: user.sub },
      select: { id: true, status: true },
    });
    if (row === null) {
      throw new NotFoundException();
    }
    if (row.status === 'paid') {
      throw new BusinessRuleException(
        'paid orders cannot be cancelled; crypto payments are not refunded automatically',
      );
    }
    await this.prisma.ticketOrder.updateMany({
      where: { id, user_id: user.sub, status: 'pending' },
      data: { status: 'cancelled' },
    });
  }

  async listTickets(
    user: CurrentUser,
    query: ListMyTicketsDto,
  ): Promise<{ data: MatchTicketView[]; meta: PaginationMeta }> {
    const where: Prisma.TicketWhereInput = { user_id: user.sub };
    if (query.match_id) {
      where.match_id = query.match_id;
    }
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

  async upsertConfig(
    matchId: string,
    dto: TicketConfigDto,
  ): Promise<{ data: TicketAvailability }> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, status: true },
    });
    if (match === null) {
      throw new NotFoundException();
    }

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
      quota_total: dto.quota_total,
      sales_open_at:
        dto.sales_open_at !== undefined ? new Date(dto.sales_open_at) : null,
      sales_close_at:
        dto.sales_close_at !== undefined ? new Date(dto.sales_close_at) : null,
      is_active: dto.is_active ?? true,
    };
    const config = await this.prisma.matchTicketConfig.upsert({
      where: { match_id: matchId },
      create: { match_id: matchId, ...data },
      update: data,
    });

    const remaining = await this.remainingQuota(matchId, config.quota_total);
    return {
      data: {
        match_id: matchId,
        venue_name: config.venue_name,
        venue_city: config.venue_city,
        price_usd: Number(config.price_usd),
        quota_total: config.quota_total,
        quota_remaining: remaining,
        sales_open_at: config.sales_open_at,
        sales_close_at: config.sales_close_at,
        on_sale:
          this.windowOpen(config) &&
          (match.status === 'scheduled' || match.status === 'live') &&
          remaining > 0,
      },
    };
  }

  async adminListOrders(query: AdminOrdersDto): Promise<{
    data: Array<TicketOrderView & { user_id: string }>;
    meta: PaginationMeta;
  }> {
    const where: Prisma.TicketOrderWhereInput = {};
    if (query.match_id) {
      where.match_id = query.match_id;
    }
    if (query.status) {
      where.status = query.status;
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ticketOrder.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.ticketOrder.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({ ...toOrderView(row), user_id: row.user_id })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: unknown,
  ): Promise<{ ok: true }> {
    if (!this.provider.isConfigured()) {
      throw new ServiceUnavailableException();
    }
    if (!this.provider.verifyIpn(rawBody, signature)) {
      throw new BadRequestException();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody?.toString('utf8') ?? '{}');
    } catch {
      throw new BadRequestException();
    }
    const payload: {
      payment_id?: string | number;
      payment_status?: string;
      order_id?: string;
    } = typeof parsed === 'object' && parsed !== null ? parsed : {};

    const orderId = payload.order_id;
    const paymentStatus = payload.payment_status;
    if (typeof orderId !== 'string' || typeof paymentStatus !== 'string') {
      return { ok: true };
    }

    const order = await this.prisma.ticketOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        quantity: true,
        match_id: true,
        user_id: true,
      },
    });
    if (order === null) {
      return { ok: true };
    }

    const paymentId =
      payload.payment_id !== undefined ? String(payload.payment_id) : null;

    if (paymentStatus === 'finished' || paymentStatus === 'confirmed') {
      if (paymentId !== null) {
        try {
          await this.prisma.ticketOrder.updateMany({
            where: { id: order.id, status: { not: 'paid' } },
            data: {
              status: 'paid',
              paid_at: new Date(),
              provider_payment_id: paymentId,
            },
          });
        } catch (error) {
          if (!isUniqueConstraintViolation(error)) {
            throw error;
          }
        }
      }
      const current = await this.prisma.ticketOrder.findUnique({
        where: { id: order.id },
        select: { status: true },
      });
      if (current?.status === 'paid') {
        await this.ensureTicketsIssued(
          order.id,
          order.match_id,
          order.user_id,
          order.quantity,
        );
      }
      return { ok: true };
    }

    if (paymentStatus === 'failed' || paymentStatus === 'refunded') {
      const transitioned = await this.prisma.ticketOrder.updateMany({
        where: { id: order.id, status: 'pending' },
        data: { status: 'failed' },
      });
      if (transitioned.count === 0) {
        const voided = await this.prisma.ticketOrder.updateMany({
          where: { id: order.id, status: 'paid' },
          data: { status: 'failed' },
        });
        if (voided.count > 0) {
          await this.prisma.ticket.updateMany({
            where: { order_id: order.id },
            data: { status: 'void' },
          });
        }
      }
      return { ok: true };
    }

    if (paymentStatus === 'expired') {
      await this.prisma.ticketOrder.updateMany({
        where: { id: order.id, status: 'pending' },
        data: { status: 'expired' },
      });
    }

    return { ok: true };
  }

  private async ensureTicketsIssued(
    orderId: string,
    matchId: string,
    userId: string,
    quantity: number,
  ): Promise<void> {
    const existing = await this.prisma.ticket.count({
      where: { order_id: orderId },
    });
    if (existing >= quantity) {
      return;
    }
    await this.prisma.ticket.createMany({
      data: Array.from({ length: quantity - existing }, () => ({
        order_id: orderId,
        match_id: matchId,
        user_id: userId,
        code: generateTicketCode(),
        status: 'valid' as const,
      })),
    });
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
    if (!config.is_active) {
      return false;
    }
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
      this.prisma.ticket.count({ where: { match_id: matchId } }),
      this.prisma.ticketOrder.aggregate({
        where: { match_id: matchId, status: 'pending' },
        _sum: { quantity: true },
      }),
    ]);
    return tickets + (holds._sum.quantity ?? 0);
  }

  private async remainingQuota(
    matchId: string,
    quotaTotal: number,
  ): Promise<number> {
    const used = await this.usedQuota(matchId);
    return Math.max(0, quotaTotal - used);
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
        if (attempt < attempts && isSerializationFailure(error)) {
          continue;
        }
        throw error;
      }
    }
  }
}
