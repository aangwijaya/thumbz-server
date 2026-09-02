import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

@Controller('probe-auth')
class AuthProbeController {
  @Get()
  protectedProbe(): string {
    return 'ok';
  }
}

describe('Authentication (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AuthProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects protected routes without a token', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/probe-auth',
    );
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
        details: null,
      },
    });
  });

  it('rejects protected routes with a garbage token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe-auth')
      .set('Authorization', 'Bearer not.a.jwt');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
        details: null,
      },
    });
  });

  it('leaves public routes open without a token', async () => {
    const health = await request(app.getHttpServer()).get('/health');
    expect(health.status).toBe(200);

    const catalog = await request(app.getHttpServer()).get('/api/v1');
    expect(catalog.status).toBe(200);
  });
});
