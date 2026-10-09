import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  if (!process.env.REDIS_URL && process.env.NODE_ENV !== 'test') {
    // Queues live in Redis: a worker without it has nothing to do.
    throw new Error('REDIS_URL is required to run the worker');
  }
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  // SIGTERM lets in-flight jobs finish before the process exits.
  app.enableShutdownHooks();
  app.get(Logger).log('worker started');
}
void bootstrap();
