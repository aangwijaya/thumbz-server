import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS } from './redis.constants';

const logger = new Logger('Redis');

export function createRedisClient(url: string, name: string): Redis {
  const client = new Redis(url, {
    connectionName: name,
    // Fail commands fast while reconnecting; callers degrade instead of hanging.
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  });
  let warned = false;
  client.on('error', (error: Error) => {
    if (!warned) {
      logger.warn(`${name}: ${error.message}`);
      warned = true;
    }
  });
  client.on('ready', () => {
    warned = false;
    logger.log(`${name}: connected`);
  });
  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis | null => {
        const url = config.get<string | null>('redisUrl');
        return url ? createRedisClient(url, 'thumbz-api') : null;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis && this.redis.status !== 'end') {
      await this.redis.quit().catch(() => this.redis?.disconnect());
    }
  }
}
