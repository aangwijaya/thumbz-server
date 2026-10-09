import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { DEFAULT_PORT } from './config/configuration';
import { setupOpenApi } from './openapi';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  // SIGTERM (deploys, scale-down) closes DB pools, sockets and queues cleanly.
  app.enableShutdownHooks();

  configureApp(app);
  setupOpenApi(app);

  const config = app.get(ConfigService);
  await app.listen(config.get<number>('port') ?? DEFAULT_PORT);
}
void bootstrap();
