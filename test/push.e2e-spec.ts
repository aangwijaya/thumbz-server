import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { generateVAPIDKeys } from 'web-push';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import {
  PUSH_SENDER,
  type PushSender,
} from './../src/modules/push/push.sender';
import { PushService } from './../src/modules/push/push.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { bearer, signTestToken, withTestAuth } from './utils/auth';

interface Sent {
  endpoint: string;
  payload: { title: string; body: string; url: string; tag: string };
}

// A browser-shaped subscription; only the endpoint differs per device.
const subscription = (endpoint: string) => ({
  endpoint,
  expirationTime: null,
  keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
});

/** Web Push (contract §18) against a fake push service. */
describe('Push (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let push: PushService;
  const sent: Sent[] = [];
  /** Endpoints the fake push service reports as unsubscribed (410). */
  const gone = new Set<string>();
  const fakeSender: PushSender = (target, payload) => {
    if (gone.has(target.endpoint)) {
      return Promise.reject(
        Object.assign(new Error('Gone'), { statusCode: 410 }),
      );
    }
    sent.push({
      endpoint: target.endpoint,
      payload: JSON.parse(payload) as Sent['payload'],
    });
    return Promise.resolve();
  };

  const run = randomUUID().slice(0, 8);
  const endpoint = (name: string) => `https://push.example/${run}/${name}`;
  const userA = randomUUID();
  const userB = randomUUID();
  let tokenA: string;
  let tokenB: string;
  const teamIds: string[] = [];
  const matchIds: string[] = [];

  beforeAll(async () => {
    const keys = generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = 'mailto:e2e@thumbz.example';
    const builder = await withTestAuth(
      Test.createTestingModule({ imports: [AppModule] }),
    );
    builder.overrideProvider(PUSH_SENDER).useValue(fakeSender);
    app = (await builder.compile()).createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    push = app.get(PushService);
    tokenA = await signTestToken(userA, { name: 'Push A' });
    tokenB = await signTestToken(userB, { name: 'Push B' });
  });

  afterAll(async () => {
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: { startsWith: `https://push.example/${run}/` } },
    });
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    await prisma.profile.deleteMany({ where: { id: { in: [userA, userB] } } });
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    await app.close();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  it('publishes the VAPID public key', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/push/config')
      .expect(200);
    expect(res.body).toEqual({
      data: { enabled: true, public_key: process.env.VAPID_PUBLIC_KEY },
    });
  });

  it('stores subscriptions per device and lets another account take one over', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/me/push-subscriptions')
      .send(subscription(endpoint('phone')))
      .expect(401);
    await request(app.getHttpServer())
      .put('/api/v1/me/push-subscriptions')
      .set(bearer(tokenA))
      .send(subscription('http://push.example/insecure'))
      .expect(400);

    await request(app.getHttpServer())
      .put('/api/v1/me/push-subscriptions')
      .set(bearer(tokenA))
      .send(subscription(endpoint('phone')))
      .expect(200);
    // Same browser, another account signs in: the endpoint moves, no duplicate.
    await request(app.getHttpServer())
      .put('/api/v1/me/push-subscriptions')
      .set(bearer(tokenB))
      .send(subscription(endpoint('phone')))
      .expect(200);
    const rows = await prisma.pushSubscription.findMany({
      where: { endpoint: endpoint('phone') },
    });
    expect(rows.map((row) => row.user_id)).toEqual([userB]);

    // A user cannot remove someone else's device.
    await request(app.getHttpServer())
      .delete('/api/v1/me/push-subscriptions')
      .query({ endpoint: endpoint('phone') })
      .set(bearer(tokenA))
      .expect(204);
    expect(
      await prisma.pushSubscription.count({
        where: { endpoint: endpoint('phone') },
      }),
    ).toBe(1);
  });

  it('sends a test notification to the caller only', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/me/push-subscriptions/test')
      .set(bearer(tokenB))
      .expect(202);
    expect(res.body).toEqual({ data: { sent: 1 } });
    expect(sent.map((item) => [item.endpoint, item.payload.tag])).toEqual([
      [endpoint('phone'), 'thumbz:test'],
    ]);
    await request(app.getHttpServer())
      .post('/api/v1/me/push-subscriptions/test')
      .set(bearer(tokenA))
      .expect(404);
  });

  it('reminds followers once, ~15 min before kick-off, and drops dead endpoints', async () => {
    for (const side of ['a', 'b']) {
      const team = await prisma.team.create({
        data: {
          slug: `e2e-push-${side}-${run}`,
          name: `E2E Push ${side.toUpperCase()}`,
          short_name: `P${side.toUpperCase()}`,
          region: 'e2e',
        },
      });
      teamIds.push(team.id);
    }
    const now = new Date();
    const soon = await prisma.match.create({
      data: {
        team_a_id: teamIds[0],
        team_b_id: teamIds[1],
        status: 'scheduled',
        scheduled_at: new Date(now.getTime() + 10 * 60_000),
      },
    });
    const later = await prisma.match.create({
      data: {
        team_a_id: teamIds[0],
        team_b_id: teamIds[1],
        status: 'scheduled',
        scheduled_at: new Date(now.getTime() + 60 * 60_000),
      },
    });
    matchIds.push(soon.id, later.id);

    // userB (phone, from above) follows team A; userA follows team B on a
    // device the push service no longer knows.
    await prisma.profile.upsert({
      where: { id: userA },
      create: { id: userA },
      update: {},
    });
    await prisma.favorite.createMany({
      data: [
        { user_id: userB, entity_type: 'team', entity_id: teamIds[0] },
        { user_id: userA, entity_type: 'team', entity_id: teamIds[1] },
      ],
    });
    await prisma.pushSubscription.create({
      data: {
        user_id: userA,
        endpoint: endpoint('stale'),
        p256dh: 'B'.repeat(87),
        auth: 'a'.repeat(22),
      },
    });
    gone.add(endpoint('stale'));

    expect(await push.remindUpcoming(now)).toBe(1);
    expect(sent).toEqual([
      {
        endpoint: endpoint('phone'),
        payload: {
          title: 'PA vs PB starts in 10 min',
          body: 'Tap to watch on THUMBZ',
          url: `/matches/${soon.id}`,
          tag: `match:${soon.id}`,
        },
      },
    ]);
    expect(
      await prisma.pushSubscription.count({
        where: { endpoint: endpoint('stale') },
      }),
    ).toBe(0);

    // The next sweep a minute later must not repeat it.
    sent.length = 0;
    expect(await push.remindUpcoming(new Date(now.getTime() + 60_000))).toBe(0);
    expect(sent).toEqual([]);
  });
});
