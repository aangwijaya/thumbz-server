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

/** Waits until the Redis client is ready so the first request is cacheable. */
async function waitForCache(app: INestApplication<App>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await request(app.getHttpServer()).get('/health/ready');
    if (response.status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Redis did not become ready');
}

describe('HTTP caching (e2e, Redis)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const slug = `e2e-cache-${randomUUID().slice(0, 8)}`;
  const viewerId = randomUUID();

  beforeAll(async () => {
    const builder = await withTestAuth(
      Test.createTestingModule({ imports: [AppModule] }),
    );
    app = (await builder.compile()).createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await waitForCache(app);
  });

  afterAll(async () => {
    await prisma.team.deleteMany({ where: { slug } });
    await prisma.profile.deleteMany({ where: { id: viewerId } });
    await app.close();
  });

  // A unique (ignored) query param gives each test its own cache entry.
  const freshUrl = (path: string) => `${path}?probe=${randomUUID()}`;

  it('serves a public list from cache on the second request', async () => {
    const url = freshUrl('/api/v1/tournaments');
    const first = await request(app.getHttpServer()).get(url).expect(200);
    const second = await request(app.getHttpServer()).get(url).expect(200);

    expect(first.headers['x-cache']).toBe('MISS');
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.body).toEqual(first.body);
    expect(second.headers['cache-control']).toBe(
      'public, max-age=0, s-maxage=60, stale-while-revalidate=120',
    );
    expect(second.headers['vary']).toContain('Authorization');
  });

  it('keeps personalized and private responses out of shared caches', async () => {
    const token = await signTestToken(viewerId);

    // Optional-auth route: a signed-in caller gets a per-user, private entry.
    const home = await request(app.getHttpServer())
      .get('/api/v1/home')
      .set(bearer(token))
      .expect(200);
    expect(home.headers['cache-control']).toBe('private, no-store');

    const anonymousHome = await request(app.getHttpServer())
      .get('/api/v1/home')
      .expect(200);
    expect(anonymousHome.headers['cache-control']).toContain('public');

    // Authenticated-only route: never cached anywhere.
    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set(bearer(token))
      .expect(200);
    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.headers['x-cache']).toBeUndefined();
  });

  it('drops cached catalog entries when an admin changes the catalog', async () => {
    const url = freshUrl('/api/v1/teams');
    await request(app.getHttpServer()).get(url).expect(200);
    const cached = await request(app.getHttpServer()).get(url).expect(200);
    expect(cached.headers['x-cache']).toBe('HIT');

    const adminToken = await signTestToken(TEST_ADMIN_ID);
    await request(app.getHttpServer())
      .post('/api/v1/admin/teams')
      .set(bearer(adminToken))
      .send({ slug, name: 'E2E Cache Team', region: 'Indonesia' })
      .expect(201);

    // Invalidation runs on the emitted domain event; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = await request(app.getHttpServer()).get(url).expect(200);
    expect(after.headers['x-cache']).toBe('MISS');
  });

  it('does not cache validation errors', async () => {
    const url = '/api/v1/matches?status=not-a-status';
    await request(app.getHttpServer()).get(url).expect(400);
    const again = await request(app.getHttpServer()).get(url).expect(400);
    expect(again.headers['x-cache']).toBeUndefined();
  });
});
