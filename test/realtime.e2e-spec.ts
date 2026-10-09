import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
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

interface Envelope<T> {
  room: string;
  seq: number;
  data: T;
}

type Ack =
  { ok: true; room: string; seq: number } | { ok: false; error: string };

function next<T>(socket: Socket, event: string, timeoutMs = 4_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no ${event} within ${timeoutMs}ms`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitAck(socket: Socket, event: string, body: unknown): Promise<Ack> {
  return socket.timeout(4_000).emitWithAck(event, body) as Promise<Ack>;
}

describe('Realtime (e2e, Socket.IO)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let url: string;
  let socket: Socket;
  let matchId: string;
  const teamIds: string[] = [];
  const viewerId = randomUUID();

  beforeAll(async () => {
    const builder = await withTestAuth(
      Test.createTestingModule({ imports: [AppModule] }),
    );
    app = (await builder.compile()).createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as unknown as { address(): AddressInfo };
    url = `http://127.0.0.1:${server.address().port}`;
    prisma = app.get(PrismaService);

    const suffix = randomUUID().slice(0, 8);
    for (const side of ['a', 'b']) {
      const team = await prisma.team.create({
        data: {
          slug: `e2e-rt-${side}-${suffix}`,
          name: `E2E RT ${side}`,
          region: 'e2e',
        },
      });
      teamIds.push(team.id);
    }
    const match = await prisma.match.create({
      data: {
        team_a_id: teamIds[0],
        team_b_id: teamIds[1],
        status: 'live',
        scheduled_at: new Date(Date.now() - 600_000),
        started_at: new Date(Date.now() - 600_000),
      },
    });
    matchId = match.id;

    socket = io(`${url}/rt`, { transports: ['websocket'], forceNew: true });
    await next(socket, 'connect');
  });

  afterAll(async () => {
    socket?.disconnect();
    await prisma.match.deleteMany({ where: { id: matchId } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    await prisma.profile.deleteMany({ where: { id: viewerId } });
    await app.close();
  });

  it('rejects rooms outside the whitelist', async () => {
    await expect(
      emitAck(socket, 'subscribe', { room: 'user:someone' }),
    ).resolves.toEqual({
      ok: false,
      error: 'invalid_room',
    });
    await expect(
      emitAck(socket, 'subscribe', { room: 'match:not-a-uuid' }),
    ).resolves.toMatchObject({
      ok: false,
    });
  });

  it('joins a match room and receives pushes with increasing seq', async () => {
    const room = `match:${matchId}`;
    const ack = await emitAck(socket, 'subscribe', { room });
    expect(ack).toMatchObject({ ok: true, room });
    const baseline = ack.ok ? ack.seq : 0;

    // A new comment is pushed in full.
    const viewerToken = await signTestToken(viewerId, { name: 'RT Viewer' });
    const commentPushed = next<Envelope<{ body: string }>>(
      socket,
      'comment:new',
    );
    await request(app.getHttpServer())
      .post(`/api/v1/matches/${matchId}/comments`)
      .set(bearer(viewerToken))
      .send({ body: 'realtime hello' })
      .expect(201);
    const comment = await commentPushed;
    expect(comment.data.body).toBe('realtime hello');
    expect(comment.seq).toBeGreaterThan(baseline);

    // Heavy live data is announced; clients refetch it over REST.
    const adminToken = await signTestToken(TEST_ADMIN_ID);
    const livePushed = next<Envelope<{ kind: string }>>(socket, 'match:live');
    await request(app.getHttpServer())
      .put(`/api/v1/admin/matches/${matchId}/economy`)
      .set(bearer(adminToken))
      .send({ snapshots: [{ team_id: teamIds[0], gold: 12_345 }] })
      .expect(200);
    const live = await livePushed;
    expect(live.data).toEqual({ kind: 'economy' });
    expect(live.seq).toBe(comment.seq + 1);

    // Score/status changes carry the new state.
    const updatePushed = next<Envelope<{ viewer_count: number }>>(
      socket,
      'match:update',
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/matches/${matchId}`)
      .set(bearer(adminToken))
      .send({ viewer_count: 4242 })
      .expect(200);
    const update = await updatePushed;
    expect(update.data.viewer_count).toBe(4242);
    expect(update.seq).toBe(live.seq + 1);
  });

  it('stops pushing after unsubscribe', async () => {
    const room = `match:${matchId}`;
    await expect(
      emitAck(socket, 'unsubscribe', { room }),
    ).resolves.toMatchObject({ ok: true });
    const adminToken = await signTestToken(TEST_ADMIN_ID);
    const pushed = next(socket, 'match:live', 800).then(
      () => 'pushed',
      () => 'silent',
    );
    await request(app.getHttpServer())
      .put(`/api/v1/admin/matches/${matchId}/economy`)
      .set(bearer(adminToken))
      .send({ snapshots: [{ team_id: teamIds[1], gold: 999 }] })
      .expect(200);
    await expect(pushed).resolves.toBe('silent');
  });

  it('accepts a valid token on connect and flags a bad one', async () => {
    const token = await signTestToken(viewerId);
    const authed = io(`${url}/rt`, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token },
    });
    const flagged = next(authed, 'auth:error', 800).then(
      () => 'flagged',
      () => 'accepted',
    );
    await next(authed, 'connect');
    await expect(flagged).resolves.toBe('accepted');
    authed.disconnect();

    const bad = io(`${url}/rt`, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: 'nope' },
    });
    await expect(next(bad, 'auth:error')).resolves.toBeUndefined();
    bad.disconnect();
  });
});
