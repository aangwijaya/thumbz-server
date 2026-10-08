import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import type { ConnectionOptions } from 'bullmq';

export const MAINTENANCE_QUEUE = 'maintenance';

/** BullMQ needs its own connection settings (blocking commands, no retry cap). */
export function bullConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1)) || 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

/**
 * Queues are Redis-backed: without REDIS_URL (local quick start) the module
 * registers nothing and job features report themselves as disabled.
 * Read at import time, after ConfigModule.forRoot has loaded the env file.
 */
@Module({})
export class QueueModule {
  static forRoot(): DynamicModule {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) {
      return { module: QueueModule };
    }
    return {
      module: QueueModule,
      global: true,
      imports: [
        BullModule.forRoot({
          connection: bullConnection(redisUrl),
          prefix: 'thumbz:bull',
        }),
        BullModule.registerQueue({
          name: MAINTENANCE_QUEUE,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2_000 },
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 7 * 24 * 3600 },
          },
        }),
      ],
      exports: [BullModule],
    };
  }
}
