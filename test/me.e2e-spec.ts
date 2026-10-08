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

/** Authenticated flows over HTTP, using locally signed Supabase-shaped JWTs. */
describe('Me (e2e, authenticated)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const userId = randomUUID();
  let token: string;
  let teamId: string;
  let matchId: string;

  beforeAll(async () => {
    const builder = await withTestAuth(
      Test.createTestingModule({ imports: [AppModule] }),
    );
    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    token = await signTestToken(userId, { name: 'E2E Viewer' });
    const team = await prisma.team.findFirstOrThrow({ select: { id: true } });
    const match = await prisma.match.findFirstOrThrow({
      select: { id: true },
    });
    teamId = team.id;
    matchId = match.id;
  });

  afterAll(async () => {
    await prisma.profile.deleteMany({ where: { id: userId } });
    await app.close();
  });

  it('lazily creates the profile on first authenticated request', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set(bearer(token))
      .expect(200);
    const body = response.body as { data: { id: string; role: string } };
    expect(body.data.id).toBe(userId);
    expect(body.data.role).toBe('user');
  });

  it('rejects expired tokens', async () => {
    const expired = await signTestToken(userId, {
      expiresIn: Math.floor(Date.now() / 1000) - 60,
    });
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set(bearer(expired))
      .expect(401);
  });

  it('adds, lists and removes a favorite idempotently', async () => {
    const path = `/api/v1/me/favorites/team/${teamId}`;
    await request(app.getHttpServer()).put(path).set(bearer(token)).expect(200);
    await request(app.getHttpServer()).put(path).set(bearer(token)).expect(200);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/me/favorites')
      .set(bearer(token))
      .expect(200);
    const list = listed.body as { data: Array<{ entity_id: string }> };
    expect(list.data.map((item) => item.entity_id)).toEqual([teamId]);

    await request(app.getHttpServer())
      .delete(path)
      .set(bearer(token))
      .expect(204);
    await request(app.getHttpServer())
      .delete(path)
      .set(bearer(token))
      .expect(204);
  });

  it('records watch progress and returns it in history', async () => {
    await request(app.getHttpServer())
      .put(`/api/v1/me/history/${matchId}`)
      .set(bearer(token))
      .send({ duration_seconds: 120, total_seconds: 3600 })
      .expect(200);

    const history = await request(app.getHttpServer())
      .get('/api/v1/me/history')
      .set(bearer(token))
      .expect(200);
    const body = history.body as {
      data: Array<{ match_id: string; duration_seconds: number }>;
    };
    expect(body.data[0]).toMatchObject({
      match_id: matchId,
      duration_seconds: 120,
    });
  });

  it('keeps admin routes closed to regular users', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/orders')
      .set(bearer(token))
      .expect(403);
  });

  it('opens admin routes to the seeded admin profile', async () => {
    const adminToken = await signTestToken(TEST_ADMIN_ID);
    await request(app.getHttpServer())
      .get('/api/v1/admin/orders')
      .set(bearer(adminToken))
      .expect(200);
  });
});
