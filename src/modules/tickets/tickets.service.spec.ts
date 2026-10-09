import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import { testEvents } from '../../infra/events/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentRouter } from '../payments/payment-router';
import { PaymentsService } from '../payments/payments.service';
import { NowPaymentsProvider } from '../payments/providers/nowpayments.provider';
import { SandboxProvider } from '../payments/providers/sandbox.provider';
import { XenditProvider } from '../payments/providers/xendit.provider';
import { TicketSigner } from '../payments/ticket-signer';
import { TicketsService } from './tickets.service';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:44322/postgres';

const USER_A = '00000000-0000-4000-8000-0000000000d1';
const USER_B = '00000000-0000-4000-8000-0000000000d2';
const IPN_SECRET = 'spec-ipn-secret';

/** Gateway payment ids are globally unique; tests must not reuse them across runs. */
const providerId = () => Math.floor(Math.random() * 1e12);

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

function build(overrides: Record<string, unknown> = {}) {
  const config = new ConfigService({
    frontendUrl: 'http://localhost:3000',
    publicApiUrl: 'http://localhost:3001',
    nowpaymentsApiKey: 'spec-key',
    nowpaymentsIpnSecret: IPN_SECRET,
    nowpaymentsApiBase: 'https://nowpayments.test',
    xenditSecretKey: null,
    xenditCallbackToken: null,
    paymentsSandbox: true,
    ticketSigningSecret: 's'.repeat(32),
    ...overrides,
  });
  const events = testEvents();
  const sandbox = new SandboxProvider(config);
  const router = new PaymentRouter(
    new NowPaymentsProvider(config),
    new XenditProvider(config),
    sandbox,
  );
  const payments = new PaymentsService(
    new PrismaService(),
    router,
    sandbox,
    events,
    config,
  );
  return { config, events, payments, router, signer: new TicketSigner(config) };
}

describe('TicketsService (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let tickets: TicketsService;
  let payments: PaymentsService;
  let events: ReturnType<typeof testEvents>;
  let fetchSpy: jest.SpyInstance;

  let teamAId: string;
  let teamBId: string;
  let liveMatchId: string;
  let completedMatchId: string;

  /** A NOWPayments IPN, signed exactly like the provider does. */
  async function ipn(payload: Record<string, unknown>): Promise<void> {
    const signature = createHmac('sha512', IPN_SECRET)
      .update(JSON.stringify(sortValue(payload)))
      .digest('hex');
    await payments.receive(
      'nowpayments',
      Buffer.from(JSON.stringify(payload)),
      {
        'x-nowpayments-sig': signature,
      },
    );
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    const built = build();
    payments = built.payments;
    events = built.events;
    tickets = new TicketsService(
      prisma,
      payments,
      built.router,
      built.signer,
      events,
    );
    fetchSpy = jest.spyOn(global, 'fetch');

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
    fetchSpy.mockReset();
    // NOWPayments invoice creation (the only outbound call in these specs).
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'inv-1',
            invoice_url: 'https://invoice.test/pay/1',
          }),
          { status: 200 },
        ),
      ),
    );
  });

  afterAll(() => fetchSpy.mockRestore());

  async function resetOrders(): Promise<void> {
    await prisma.paymentEvent.deleteMany({
      where: { payment: { order: { user_id: { in: [USER_A, USER_B] } } } },
    });
    await prisma.ticket.deleteMany({
      where: { user_id: { in: [USER_A, USER_B] } },
    });
    await prisma.ticketOrder.deleteMany({
      where: { user_id: { in: [USER_A, USER_B] } },
    });
  }

  it('expires stale holds once, leaving paid and fresh orders alone', async () => {
    const base = {
      match_id: liveMatchId,
      user_id: USER_A,
      quantity: 1,
      unit_price_usd: 10,
      total_usd: 10,
    };
    await prisma.profile.upsert({
      where: { id: USER_A },
      create: { id: USER_A },
      update: {},
    });
    const stale = await prisma.ticketOrder.create({
      data: {
        ...base,
        status: 'pending',
        expires_at: new Date(Date.now() - 60_000),
      },
    });
    const fresh = await prisma.ticketOrder.create({
      data: {
        ...base,
        status: 'pending',
        expires_at: new Date(Date.now() + 600_000),
      },
    });
    const paidLate = await prisma.ticketOrder.create({
      // Payment landed before the job ran: must stay paid.
      data: {
        ...base,
        status: 'paid',
        expires_at: new Date(Date.now() - 60_000),
      },
    });
    events.emitted.length = 0;

    expect(await tickets.expireStaleHolds()).toBe(1);
    expect(await tickets.expireStaleHolds()).toBe(0);

    const statuses = await prisma.ticketOrder.findMany({
      where: { id: { in: [stale.id, fresh.id, paidLate.id] } },
      select: { id: true, status: true },
    });
    const byId = Object.fromEntries(
      statuses.map((row) => [row.id, row.status]),
    );
    expect(byId).toEqual({
      [stale.id]: 'expired',
      [fresh.id]: 'pending',
      [paidLate.id]: 'paid',
    });
    expect(events.emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'order.changed',
          orderId: stale.id,
          status: 'expired',
        }),
        { type: 'tickets.changed', matchId: liveMatchId },
      ]),
    );
    await prisma.ticketOrder.deleteMany({
      where: { id: { in: [stale.id, fresh.id, paidLate.id] } },
    });
  });

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
    expect(data.payment).toMatchObject({
      provider: 'nowpayments',
      method: 'crypto',
      kind: 'redirect',
      invoice_url: 'https://invoice.test/pay/1',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

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
    await tickets.upsertConfig(liveMatchId, {
      venue_name: 'E2E Arena',
      price_usd: 25,
      price_idr: 400_000,
      quota_total: 50,
    });
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
  });

  it('returns 503 when no gateway serves the method, without taking a hold', async () => {
    await resetOrders();
    const bare = build({ nowpaymentsApiKey: null, paymentsSandbox: false });
    const service = new TicketsService(
      prisma,
      bare.payments,
      bare.router,
      bare.signer,
      bare.events,
    );
    await expect(
      service.createOrder(liveMatchId, { sub: USER_A }, 1),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await prisma.ticketOrder.count({ where: { user_id: USER_A } })).toBe(
      0,
    );
  });

  it('issues tickets exactly once, even for concurrent duplicate webhooks', async () => {
    await resetOrders();
    const { data } = await tickets.createOrder(liveMatchId, { sub: USER_A }, 2);
    const paymentId = (data.payment as { id: string }).id;
    const finished = {
      payment_id: providerId(),
      payment_status: 'finished',
      order_id: paymentId,
      price_amount: 50,
      price_currency: 'usd',
    };
    const confirmed = { ...finished, payment_status: 'confirmed' };
    // Same event twice plus a different event for the same payment, all at once.
    await Promise.all([ipn(finished), ipn(finished), ipn(confirmed)]);

    const order = await tickets.getOrder({ sub: USER_A }, data.id);
    expect(order.data.status).toBe('paid');
    expect(order.tickets).toHaveLength(2);
    for (const ticket of order.tickets) {
      expect(ticket.code).toMatch(/^THMZ-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
      expect(ticket.qr_payload.startsWith(`THMZ1.${ticket.code}.`)).toBe(true);
    }
    expect(events.emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'order.changed',
          orderId: data.id,
          status: 'paid',
        }),
      ]),
    );
  });

  it('never issues tickets for an underpayment', async () => {
    await resetOrders();
    const { data } = await tickets.createOrder(liveMatchId, { sub: USER_A }, 2);
    const paymentId = (data.payment as { id: string }).id;
    await ipn({
      payment_id: providerId(),
      payment_status: 'finished',
      order_id: paymentId,
      price_amount: 10,
      price_currency: 'usd',
    });

    const order = await tickets.getOrder({ sub: USER_A }, data.id);
    expect(order.data.status).toBe('pending');
    expect(order.tickets).toHaveLength(0);
    expect(order.data.payment).toMatchObject({ status: 'failed' });
  });

  it('rejects forged webhooks', async () => {
    await expect(
      payments.receive('nowpayments', Buffer.from('{"order_id":"x"}'), {
        'x-nowpayments-sig': 'ab'.repeat(64),
      }),
    ).rejects.toBeTruthy();
  });

  it('honors a late payment while seats remain, and never oversells', async () => {
    await resetOrders();
    const first = await tickets.createOrder(liveMatchId, { sub: USER_A }, 2);
    await prisma.ticketOrder.update({
      where: { id: first.data.id },
      data: { status: 'expired' },
    });
    await ipn({
      payment_id: providerId(),
      payment_status: 'finished',
      order_id: (first.data.payment as { id: string }).id,
    });
    expect(
      (await tickets.getOrder({ sub: USER_A }, first.data.id)).data.status,
    ).toBe('paid');

    // Now leave no room: a late payment must not create tickets.
    await tickets.upsertConfig(liveMatchId, {
      venue_name: 'E2E Arena',
      price_usd: 25,
      price_idr: 400_000,
      quota_total: 3,
    });
    const second = await tickets.createOrder(liveMatchId, { sub: USER_B }, 1);
    await prisma.ticketOrder.update({
      where: { id: second.data.id },
      data: { status: 'expired' },
    });
    await prisma.ticketOrder.create({
      data: {
        match_id: liveMatchId,
        user_id: USER_A,
        quantity: 1,
        unit_price_usd: 25,
        total_usd: 25,
        status: 'pending',
        expires_at: new Date(Date.now() + 600_000),
      },
    });
    await ipn({
      payment_id: providerId(),
      payment_status: 'finished',
      order_id: (second.data.payment as { id: string }).id,
    });
    const late = await tickets.getOrder({ sub: USER_B }, second.data.id);
    expect(late.data.status).toBe('refund_required');
    expect(late.tickets).toHaveLength(0);
    await tickets.upsertConfig(liveMatchId, {
      venue_name: 'E2E Arena',
      price_usd: 25,
      price_idr: 400_000,
      quota_total: 50,
    });
  });

  it('pays with QRIS in the sandbox, then admits each ticket once at the gate', async () => {
    await resetOrders();
    const { data } = await tickets.createOrder(
      liveMatchId,
      { sub: USER_A },
      2,
      'qris',
    );
    const payment = data.payment as {
      id: string;
      kind: string;
      qr_string: string;
      amount: number;
      currency: string;
      provider: string;
    };
    expect(payment).toMatchObject({
      kind: 'qr',
      currency: 'IDR',
      amount: 800_000,
      provider: 'sandbox',
    });
    expect(payment.qr_string).toMatch(/^000201/);

    await payments.simulate(payment.id, USER_A);
    const order = await tickets.getOrder({ sub: USER_A }, data.id);
    expect(order.data.status).toBe('paid');

    const qr = order.tickets[0].qr_payload;
    await expect(tickets.checkIn(qr)).resolves.toMatchObject({
      data: { result: 'checked_in' },
    });
    await expect(tickets.checkIn(qr)).resolves.toMatchObject({
      data: { result: 'already_used' },
    });
    await expect(tickets.checkIn(`${qr.slice(0, -1)}x`)).resolves.toMatchObject(
      { data: { result: 'invalid' } },
    );
  });

  it('switches methods: the new attempt supersedes the old one', async () => {
    await resetOrders();
    const crypto = await tickets.createOrder(liveMatchId, { sub: USER_A }, 1);
    const va = await tickets.startPayment(
      { sub: USER_A },
      crypto.data.id,
      'va_bca',
    );
    expect(va.data.payment).toMatchObject({
      kind: 'va',
      bank: 'BCA',
      method: 'va_bca',
      amount: 400_000,
    });
    const old = await prisma.payment.findUnique({
      where: { id: (crypto.data.payment as { id: string }).id },
    });
    expect(old?.status).toBe('cancelled');
  });

  it('lists IDR and crypto methods only when priced and served', async () => {
    const availability = await tickets.availability(liveMatchId);
    const methods = availability.data?.payment_methods.map(
      (option) => option.method,
    );
    expect(methods).toEqual(
      expect.arrayContaining(['qris', 'va_bca', 'crypto']),
    );
  });

  it('cancels pending orders and refuses to cancel paid ones', async () => {
    await resetOrders();
    const pending = await tickets.createOrder(liveMatchId, { sub: USER_A }, 1);
    await tickets.cancelOrder({ sub: USER_A }, pending.data.id);
    const cancelled = await tickets.getOrder({ sub: USER_A }, pending.data.id);
    expect(cancelled.data.status).toBe('cancelled');

    const again = await tickets.createOrder(liveMatchId, { sub: USER_A }, 1);
    await ipn({
      payment_id: providerId(),
      payment_status: 'confirmed',
      order_id: (again.data.payment as { id: string }).id,
    });
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
