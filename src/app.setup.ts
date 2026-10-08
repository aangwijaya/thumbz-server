import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { REQUEST_ID_HEADER } from './infra/logging/request-id';
import { MetricsService } from './infra/metrics/metrics.service';

/** Routes served outside `/api/v1` (probes and scrapes, see contract §1). */
export const UNVERSIONED_ROUTES = [
  'health',
  'health/live',
  'health/ready',
  'metrics',
];

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const express = app.getHttpAdapter().getInstance() as {
    set(setting: string, value: unknown): void;
  };

  // Behind Railway's proxy req.ip must come from X-Forwarded-For, or every
  // anonymous client shares one throttling bucket. 0 hops locally, so the
  // header cannot be spoofed when there is no proxy.
  express.set('trust proxy', config.get<number>('trustProxy') ?? 0);

  app.setGlobalPrefix('api/v1', { exclude: UNVERSIONED_ROUTES });
  app.use(app.get(MetricsService).httpMiddleware());
  app.use(helmet());
  app.enableCors({
    origin: config.get<string[]>('corsOrigins'),
    exposedHeaders: [REQUEST_ID_HEADER, 'Retry-After'],
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
}
