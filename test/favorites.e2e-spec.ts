import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

describe('Favorites (e2e)', () => {
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

  const target =
    '/api/v1/me/favorites/team/00000000-0000-4000-8000-000000000000';

  it('rejects anonymous list requests', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me/favorites')
      .expect(401);
    expect(response.body).toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
        details: null,
      },
    });
  });

  it('rejects anonymous add requests', async () => {
    const response = await request(app.getHttpServer()).put(target).expect(401);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects anonymous remove requests', async () => {
    const response = await request(app.getHttpServer())
      .delete(target)
      .expect(401);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects garbage tokens', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me/favorites')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
