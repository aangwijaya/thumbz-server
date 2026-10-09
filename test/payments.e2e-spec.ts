import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bearer,
  signTestToken,
  TEST_ADMIN_ID,
  withTestAuth,
} from './utils/auth';

interface OrderBody {
  data: {
    id: string;
    status: string;
    payment: {
      id: string;
      method: string;
      kind: string;
      qr_string: string | null;
      currency: string;
      amount: number;
    };
  };
  tickets?: Array<{ code: string; qr_payload: string }>;
}

/** Full checkout over HTTP with the built-in sandbox gateway. */
describe('Payments (e2e, sandbox gateway)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let matchId: string;
  const teamIds: string[] = [];
  const buyerId = randomUUID();
  let buyer: string;
  let admin: string;

  beforeAll(async () => {
    process.env.PAYMENTS_SANDBOX = 'true';
    const builder = await withTestAuth(
      Test.createTestingModule({ imports: [AppModule] }),
    );
    app = (await builder.compile()).createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const suffix = randomUUID().slice(0, 8);
    for (const side of ['a', 'b']) {
      const team = await prisma.team.create({
        data: {
          slug: `e2e-pay-${side}-${suffix}`,
          name: `E2E Pay ${side}`,
          region: 'e2e',
        },
      });
      teamIds.push(team.id);
    }
    const match = await prisma.match.create({
      data: {
        team_a_id: teamIds[0],
        team_b_id: teamIds[1],
        status: 'scheduled',
        scheduled_at: new Date(Date.now() + 86_400_000),
      },
    });
    matchId = match.id;
    buyer = await signTestToken(buyerId, { name: 'E2E Buyer' });
    admin = await signTestToken(TEST_ADMIN_ID);
  });

  afterAll(async () => {
    await prisma.ticketOrder.deleteMany({ where: { match_id: matchId } });
    await prisma.ticket.deleteMany({ where: { match_id: matchId } });
    await prisma.match.deleteMany({ where: { id: matchId } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    await prisma.profile.deleteMany({ where: { id: buyerId } });
    await app.close();
  });

  it('runs QRIS checkout → payment → tickets → gate check-in', async () => {
    await request(app.getHttpServer())
      .put(`/api/v1/admin/matches/${matchId}/ticket-config`)
      .set(bearer(admin))
      .send({
        venue_name: 'Istora',
        price_usd: 15,
        price_idr: 250_000,
        quota_total: 100,
      })
      .expect(200);

    const availability = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}/ticket`)
      .expect(200);
    const methods = (
      availability.body as {
        data: { payment_methods: Array<{ method: string }> };
      }
    ).data.payment_methods.map((option) => option.method);
    expect(methods).toEqual(
      expect.arrayContaining(['qris', 'va_bca', 'crypto']),
    );

    const key = `e2e-${randomUUID()}`;
    const created = await request(app.getHttpServer())
      .post(`/api/v1/matches/${matchId}/orders`)
      .set(bearer(buyer))
      .set('Idempotency-Key', key)
      .send({ quantity: 2, payment_method: 'qris' })
      .expect(201);
    const order = created.body as OrderBody;
    expect(order.data.payment).toMatchObject({
      method: 'qris',
      kind: 'qr',
      currency: 'IDR',
      amount: 500_000,
    });

    // A retried request (e.g. flaky mobile network) gets the same order back.
    const replay = await request(app.getHttpServer())
      .post(`/api/v1/matches/${matchId}/orders`)
      .set(bearer(buyer))
      .set('Idempotency-Key', key)
      .send({ quantity: 2, payment_method: 'qris' })
      .expect(201);
    expect((replay.body as OrderBody).data.id).toBe(order.data.id);
    expect(replay.headers['idempotent-replayed']).toBe('true');

    await request(app.getHttpServer())
      .post(`/api/v1/matches/${matchId}/orders`)
      .set(bearer(buyer))
      .set('Idempotency-Key', key)
      .send({ quantity: 1, payment_method: 'qris' })
      .expect(422);

    await request(app.getHttpServer())
      .post(`/api/v1/me/payments/${order.data.payment.id}/simulate`)
      .set(bearer(buyer))
      .expect(202);

    const paid = await request(app.getHttpServer())
      .get(`/api/v1/me/orders/${order.data.id}`)
      .set(bearer(buyer))
      .expect(200);
    const paidBody = paid.body as OrderBody;
    expect(paidBody.data.status).toBe('paid');
    expect(paidBody.tickets).toHaveLength(2);

    const payload = paidBody.tickets![0].qr_payload;
    const first = await request(app.getHttpServer())
      .post('/api/v1/admin/tickets/check-in')
      .set(bearer(admin))
      .send({ payload })
      .expect(200);
    expect((first.body as { data: { result: string } }).data.result).toBe(
      'checked_in',
    );
    const second = await request(app.getHttpServer())
      .post('/api/v1/admin/tickets/check-in')
      .set(bearer(admin))
      .send({ payload })
      .expect(200);
    expect((second.body as { data: { result: string } }).data.result).toBe(
      'already_used',
    );
  });

  it('keeps simulation to the payment owner', async () => {
    const stranger = await signTestToken(randomUUID());
    const created = await request(app.getHttpServer())
      .post(`/api/v1/matches/${matchId}/orders`)
      .set(bearer(buyer))
      .send({ quantity: 1, payment_method: 'va_bri' })
      .expect(201);
    const order = created.body as OrderBody;
    await request(app.getHttpServer())
      .post(`/api/v1/me/payments/${order.data.payment.id}/simulate`)
      .set(bearer(stranger))
      .expect(403);
  });

  it('rejects Xendit webhooks without the callback token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/xendit')
      .send({ event: 'payment.capture', data: {} })
      .expect(503); // Xendit is not configured in tests
  });
});
