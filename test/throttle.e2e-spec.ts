import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Throttle } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { OptionalAuth } from './../src/common/decorators/optional-auth.decorator';
import { Public } from './../src/common/decorators/public.decorator';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { bearer, signTestToken, withTestAuth } from './utils/auth';

@Controller('probe')
class ThrottleProbeController {
  @Public()
  @Get()
  readProbe(): string {
    return 'ok';
  }

  // Optional auth so the throttle tracker is the (unique) test user, not the
  // loopback IP: counters live in Redis and are shared by parallel suites.
  @OptionalAuth()
  @Post()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  writeProbe(): string {
    return 'ok';
  }
}

describe('Throttling (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const builder = await withTestAuth(
      Test.createTestingModule({
        imports: [AppModule],
        controllers: [ThrottleProbeController],
      }),
    );
    const moduleRef = await builder.compile();
    token = await signTestToken(randomUUID());

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('throttles writes with 429 RATE_LIMITED and Retry-After', async () => {
    for (let i = 0; i < 3; i++) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/probe')
        .set(bearer(token))
        .send();
      expect(response.status).toBe(201);
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/probe')
      .set(bearer(token))
      .send();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded',
        details: null,
      },
    });
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('does not throttle reads', async () => {
    for (let i = 0; i < 5; i++) {
      const response = await request(app.getHttpServer()).get('/api/v1/probe');
      expect(response.status).toBe(200);
    }
  });
});
