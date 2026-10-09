import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { REDIS } from './redis.constants';

const PING_TIMEOUT_MS = 1_000;

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS) private readonly redis: Redis | null,
    private readonly indicators: HealthIndicatorService,
  ) {}

  isConfigured(): boolean {
    return this.redis !== null;
  }

  async pingCheck<const Key extends string>(key: Key) {
    const indicator = this.indicators.check(key);
    if (this.redis === null) {
      return indicator.up({ configured: false });
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.redis.ping(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timeout')),
            PING_TIMEOUT_MS,
          );
        }),
      ]);
      return indicator.up();
    } catch {
      return indicator.down();
    } finally {
      clearTimeout(timer);
    }
  }
}
