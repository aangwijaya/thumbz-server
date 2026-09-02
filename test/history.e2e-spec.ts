import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

describe('History (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const matchId = '00000000-0000-4000-8000-000000000000';

  it('rejects anonymous list requests', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me/history')
      .expect(401);
    expect(response.body).toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
        details: null,
      },
    });
  });

  it('rejects anonymous put requests', async () => {
    const response = await request(app.getHttpServer())
      .put(`/api/v1/me/history/${matchId}`)
      .send({ duration_seconds: 1200 })
      .expect(401);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects anonymous delete requests', async () => {
    const response = await request(app.getHttpServer())
      .delete(`/api/v1/me/history/${matchId}`)
      .expect(401);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects garbage tokens', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me/history')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
