import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { NowPaymentsClient } from './nowpayments.client';
import { TicketsService } from './tickets.service';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:44322/postgres';

const USER_A = '00000000-0000-4000-8000-0000000000d1';
const USER_B = '00000000-0000-4000-8000-0000000000d2';

describe('TicketsService (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let provider: {
    isConfigured: jest.Mock;
    createInvoice: jest.Mock;
    verifyIpn: jest.Mock;
  };
  let tickets: TicketsService;

  let teamAId: string;
  let teamBId: string;
  let liveMatchId: string;
  let completedMatchId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    provider = {
      isConfigured: jest.fn().mockReturnValue(true),
      createInvoice: jest.fn().mockResolvedValue({
        invoiceUrl: 'https://invoice.test/pay/1',
        providerInvoiceId: 'inv-1',
      }),
      verifyIpn: jest.fn().mockReturnValue(true),
    };
    const config = new ConfigService({
      corsOrigins: ['http://localhost:3000'],
    });
    tickets = new TicketsService(
      prisma,
      provider as unknown as NowPaymentsClient,
      config,
    );

    await prisma.ticket.deleteMany({
      where: { user_id: { in: [USER_A, USER_B] } },
    });
    await prisma.ticketOrder.deleteMany({
      where: { user_id: { in: [USER_A, USER_B] } },
    });
    await prisma.profile.deleteMany({
      where: { id: { in: [USER_A, USER_B] } },
    });

    const oldTeams = await prisma.team.findMany({
      where: { slug: { in: ['e2e-tickets-a', 'e2e-tickets-b'] } },
      select: { id: true },
    });
    const oldIds = oldTeams.map((t) => t.id);
    if (oldIds.length > 0) {
      await prisma.match.deleteMany({
        where: {
          OR: [{ team_a_id: { in: oldIds } }, { team_b_id: { in: oldIds } }],
        },
      });
      await prisma.team.deleteMany({ where: { id: { in: oldIds } } });
    }

    const teamA = await prisma.team.create({
      data: { slug: 'e2e-tickets-a', name: 'E2E Tickets A', region: 'e2e' },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: { slug: 'e2e-tickets-b', name: 'E2E Tickets B', region: 'e2e' },
    });
    teamBId = teamB.id;

    const live = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'live',
        scheduled_at: new Date(Date.now() - 3_600_000),
        started_at: new Date(Date.now() - 3_600_000),
      },
    });
    liveMatchId = live.id;
    const completed = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'completed',
        score_a: 2,
        score_b: 0,
        winner_team_id: teamAId,
        scheduled_at: new Date(Date.now() - 86_400_000),
        ended_at: new Date(Date.now() - 86_400_000 + 3_600_000),
      },
    });
    completedMatchId = completed.id;

    await prisma.profile.createMany({
      data: [
        { id: USER_A, username: 'e2e-tickets-a' },
        { id: USER_B, username: 'e2e-tickets-b' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.matchTicketConfig.deleteMany({
      where: { match_id: { in: [liveMatchId, completedMatchId] } },
    });
    await prisma.ticket.deleteMany({
      where: { user_id: { in: [USER_A, USER_B] } },
    });
    await prisma.ticketOrder.deleteMany({
      where: { user_id: { in: [USER_A, USER_B] } },
    });
    await prisma.match.deleteMany({
      where: { id: { in: [liveMatchId, completedMatchId] } },
    });
    await prisma.profile.deleteMany({
      where: { id: { in: [USER_A, USER_B] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    provider.isConfigured.mockReturnValue(true);
    provider.createInvoice.mockClear();
    provider.verifyIpn.mockReturnValue(true);
  });

  async function resetOrders(): Promise<void> {
    await prisma.ticket.deleteMany({
      where: { user_id: { in: [USER_A, USER_B] } },
    });
    await prisma.ticketOrder.deleteMany({
      where: { user_id: { in: [USER_A, USER_B] } },
    });
  }

  it('returns null availability without a config and quota after upsert', async () => {
    const empty = await tickets.availability(liveMatchId);
    expect(empty.data).toBeNull();

    const { data } = await tickets.upsertConfig(liveMatchId, {
      venue_name: 'E2E Arena',
      venue_city: 'Jakarta',
      price_usd: 25,
      quota_total: 100,
    });
    expect(data.quota_total).toBe(100);
    expect(data.quota_remaining).toBe(100);
    expect(data.on_sale).toBe(true);
  });

  it('creates a pending order with a provider invoice and reduces remaining', async () => {
    await resetOrders();
    const { data } = await tickets.createOrder(liveMatchId, { sub: USER_A }, 2);
    expect(data.status).toBe('pending');
    expect(data.total_usd).toBe(50);
    expect(data.payment.invoice_url).toBe('https://invoice.test/pay/1');
    expect(provider.createInvoice).toHaveBeenCalledTimes(1);

    const availability = await tickets.availability(liveMatchId);
    expect(availability.data?.quota_remaining).toBe(98);
  });

  it('enforces the per-user cap and the quota', async () => {
    await resetOrders();
    await tickets.createOrder(liveMatchId, { sub: USER_A }, 4);
    await expect(
      tickets.createOrder(liveMatchId, { sub: USER_A }, 1),
    ).rejects.toBeInstanceOf(BusinessRuleException);

    await tickets.upsertConfig(liveMatchId, {
      venue_name: 'E2E Arena',
      price_usd: 25,
      quota_total: 4,
    });
    await expect(
      tickets.createOrder(liveMatchId, { sub: USER_B }, 2),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('rejects orders when the match is not sellable', async () => {
    await resetOrders();
    await tickets.upsertConfig(completedMatchId, {
      venue_name: 'E2E Arena',
      price_usd: 25,
      quota_total: 50,
    });
    await expect(
      tickets.createOrder(completedMatchId, { sub: USER_A }, 1),
    ).rejects.toBeInstanceOf(BusinessRuleException);

    await tickets.upsertConfig(liveMatchId, {
      venue_name: 'E2E Arena',
      price_usd: 25,
      quota_total: 50,
      is_active: false,
    });
    await expect(
      tickets.createOrder(liveMatchId, { sub: USER_A }, 1),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    await tickets.upsertConfig(liveMatchId, {
      venue_name: 'E2E Arena',
      price_usd: 25,
      quota_total: 50,
    });
  });

  it('returns 503 when the provider is not configured', async () => {
    provider.isConfigured.mockReturnValue(false);
    await expect(
      tickets.createOrder(liveMatchId, { sub: USER_A }, 1),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('issues tickets exactly once from a finished webhook and formats codes', async () => {
    await resetOrders();
    const { data } = await tickets.createOrder(liveMatchId, { sub: USER_A }, 2);
    const payload = Buffer.from(
      JSON.stringify({
        payment_id: 987654,
        payment_status: 'finished',
        order_id: data.id,
      }),
    );
    await tickets.handleWebhook(payload, 'sig');
    await tickets.handleWebhook(payload, 'sig');

    const order = await tickets.getOrder({ sub: USER_A }, data.id);
    expect(order.data.status).toBe('paid');
    expect(order.data.payment.payment_id).toBe('987654');
    expect(order.tickets).toHaveLength(2);
    for (const ticket of order.tickets) {
      expect(ticket.code).toMatch(/^THMZ-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    }

    const listed = await tickets.listTickets(
      { sub: USER_A },
      { page: 1, pageSize: 20, match_id: liveMatchId },
    );
    expect(listed.data.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects invalid webhook signatures and expires pending orders', async () => {
    await resetOrders();
    provider.verifyIpn.mockReturnValue(false);
    await expect(
      tickets.handleWebhook(Buffer.from('{}'), 'bad'),
    ).rejects.toBeTruthy();

    provider.verifyIpn.mockReturnValue(true);
    const { data } = await tickets.createOrder(liveMatchId, { sub: USER_B }, 1);
    await tickets.handleWebhook(
      Buffer.from(
        JSON.stringify({
          payment_id: 111,
          payment_status: 'expired',
          order_id: data.id,
        }),
      ),
      'sig',
    );
    const order = await tickets.getOrder({ sub: USER_B }, data.id);
    expect(order.data.status).toBe('expired');
  });

  it('cancels pending orders and refuses to cancel paid ones', async () => {
    await resetOrders();
    const pending = await tickets.createOrder(liveMatchId, { sub: USER_A }, 1);
    await tickets.cancelOrder({ sub: USER_A }, pending.data.id);
    const cancelled = await tickets.getOrder({ sub: USER_A }, pending.data.id);
    expect(cancelled.data.status).toBe('cancelled');

    const again = await tickets.createOrder(liveMatchId, { sub: USER_A }, 1);
    await tickets.handleWebhook(
      Buffer.from(
        JSON.stringify({
          payment_id: 222,
          payment_status: 'confirmed',
          order_id: again.data.id,
        }),
      ),
      'sig',
    );
    await expect(
      tickets.cancelOrder({ sub: USER_A }, again.data.id),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('returns batch availability keyed by match id', async () => {
    const map = await tickets.availabilityForMatches([
      liveMatchId,
      completedMatchId,
      '00000000-0000-4000-8000-000000000000',
    ]);
    expect(map.get(liveMatchId)?.quota_total).toBe(50);
    expect(map.get(completedMatchId)?.quota_total).toBe(50);
    expect(map.get('00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
