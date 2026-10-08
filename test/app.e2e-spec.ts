import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  it('echoes a well-formed x-request-id and mints one otherwise', async () => {
    const echoed = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'trace-abc-12345');
    expect(echoed.headers['x-request-id']).toBe('trace-abc-12345');

    const minted = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'bad id with spaces');
    expect(minted.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('serves liveness without touching dependencies', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('exposes Prometheus metrics', async () => {
    const response = await request(app.getHttpServer()).get('/metrics');
    expect(response.status).toBe(200);
    expect(response.text).toContain('http_request_duration_seconds');
  });

  it('unknown API route returns the contract error shape', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/nope');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found', details: null },
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
