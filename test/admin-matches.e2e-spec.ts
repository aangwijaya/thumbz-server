import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

describe('Admin matches (e2e)', () => {
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

  const body = {
    team_a_id: '00000000-0000-4000-8000-000000000000',
    team_b_id: '11111111-1111-4111-8111-111111111111',
    scheduled_at: '2026-09-05T12:00:00Z',
  };

  it('rejects anonymous create', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/matches')
      .send(body)
      .expect(401);
    expect(response.body).toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
        details: null,
      },
    });
  });

  it('rejects anonymous update', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/v1/admin/matches/00000000-0000-4000-8000-000000000000')
      .send({ status: 'cancelled' })
      .expect(401);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects anonymous delete', async () => {
    const response = await request(app.getHttpServer())
      .delete('/api/v1/admin/matches/00000000-0000-4000-8000-000000000000')
      .expect(401);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects anonymous live updates', async () => {
    const response = await request(app.getHttpServer())
      .put('/api/v1/admin/matches/00000000-0000-4000-8000-000000000000/live')
      .send({ status: 'live', viewer_count: 10 })
      .expect(401);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects anonymous statistics upserts', async () => {
    const response = await request(app.getHttpServer())
      .put(
        '/api/v1/admin/matches/00000000-0000-4000-8000-000000000000/statistics',
      )
      .send({ teams: [{ team_id: '11111111-1111-4111-8111-111111111111' }] })
      .expect(401);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
