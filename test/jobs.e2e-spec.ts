import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import {
  bearer,
  signTestToken,
  TEST_ADMIN_ID,
  withTestAuth,
} from './utils/auth';

describe('Admin jobs (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const builder = await withTestAuth(
      Test.createTestingModule({ imports: [AppModule] }),
    );
    app = (await builder.compile()).createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is admin only', async () => {
    const token = await signTestToken(randomUUID());
    await request(app.getHttpServer())
      .get('/api/v1/admin/jobs')
      .set(bearer(token))
      .expect(403);
  });

  it('reports queue state for admins', async () => {
    const token = await signTestToken(TEST_ADMIN_ID);
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/jobs')
      .set(bearer(token))
      .expect(200);
    const body = response.body as {
      data: {
        enabled: boolean;
        counts: Record<string, number>;
        schedulers: unknown[];
      };
    };
    expect(body.data.enabled).toBe(true);
    expect(typeof body.data.counts.waiting).toBe('number');
    expect(typeof body.data.counts.failed).toBe('number');
    expect(Array.isArray(body.data.schedulers)).toBe(true);
  });

  it('exposes queue depth to Prometheus', async () => {
    const metrics = await request(app.getHttpServer())
      .get('/metrics')
      .expect(200);
    expect(metrics.text).toContain('thumbz_queue_jobs{state="waiting"}');
  });
});
