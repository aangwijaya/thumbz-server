import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from './../src/prisma/prisma.service';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

const IPN_SECRET = 'e2e-ipn-secret';

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

function signPayload(payload: unknown): string {
  return createHmac('sha512', IPN_SECRET)
    .update(JSON.stringify(sortValue(payload)))
    .digest('hex');
}

describe('Tickets (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let teamAId: string;
  let teamBId: string;
  let matchId: string;

  beforeAll(async () => {
    process.env.NOWPAYMENTS_API_KEY = 'e2e-api-key';
    process.env.NOWPAYMENTS_IPN_SECRET = IPN_SECRET;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const oldTeams = await prisma.team.findMany({
      where: { slug: { in: ['e2e-tickets-e-a', 'e2e-tickets-e-b'] } },
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
      data: { slug: 'e2e-tickets-e-a', name: 'E2E TicketsE A', region: 'e2e' },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: { slug: 'e2e-tickets-e-b', name: 'E2E TicketsE B', region: 'e2e' },
    });
    teamBId = teamB.id;
    const match = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'scheduled',
        scheduled_at: new Date(Date.now() + 86_400_000),
      },
    });
    matchId = match.id;
  });

  afterAll(async () => {
    await prisma.matchTicketConfig.deleteMany({ where: { match_id: matchId } });
    await prisma.match.delete({ where: { id: matchId } });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await app.close();
  });

  it('serves null availability for a match without ticket config', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}/ticket`)
      .expect(200);
    expect(response.body).toEqual({ data: null });
  });

  it('returns 404 for an unknown match', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/matches/00000000-0000-4000-8000-000000000000/ticket')
      .expect(404);
  });

  it('rejects anonymous order and moderation endpoints', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/matches/${matchId}/orders`)
      .send({ quantity: 1 })
      .expect(401);
    await request(app.getHttpServer()).get('/api/v1/me/orders').expect(401);
    await request(app.getHttpServer()).get('/api/v1/me/tickets').expect(401);
    await request(app.getHttpServer())
      .put(`/api/v1/admin/matches/${matchId}/ticket-config`)
      .send({})
      .expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/orders').expect(401);
  });

  it('verifies the NOWPayments webhook signature', async () => {
    const payload = {
      payment_id: 123456,
      payment_status: 'finished',
      order_id: '00000000-0000-4000-8000-000000000000',
    };

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/nowpayments')
      .set('x-nowpayments-sig', 'deadbeef')
      .send(payload)
      .expect(400);

    const response = await request(app.getHttpServer())
      .post('/api/v1/webhooks/nowpayments')
      .set('x-nowpayments-sig', signPayload(payload))
      .send(payload)
      .expect(200);
    expect(response.body).toEqual({ ok: true });
  });
});
