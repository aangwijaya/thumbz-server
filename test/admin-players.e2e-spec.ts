import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

describe('Admin players (e2e)', () => {
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
    slug: 'e2e-anon-player',
    nickname: 'E2E Anon Player',
    role: 'gold',
  };

  it('rejects anonymous create', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/players')
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
      .patch('/api/v1/admin/players/00000000-0000-4000-8000-000000000000')
      .send({ nickname: 'X' })
      .expect(401);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects anonymous delete', async () => {
    const response = await request(app.getHttpServer())
      .delete('/api/v1/admin/players/00000000-0000-4000-8000-000000000000')
      .expect(401);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
