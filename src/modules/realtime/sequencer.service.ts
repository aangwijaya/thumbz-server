import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis/redis.constants';

/**
 * Monotonic sequence per room so clients can detect gaps (a missed message
 * after a reconnect) and resync from REST. Global via Redis INCR across
 * instances; a local counter otherwise.
 */
@Injectable()
export class SequencerService {
  private readonly local = new Map<string, number>();

  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  async next(room: string): Promise<number> {
    if (this.redis && this.redis.status === 'ready') {
      try {
        const key = `thumbz:rt:seq:${room}`;
        const [[, seq]] = (await this.redis
          .multi()
          .incr(key)
          .expire(key, 24 * 60 * 60)
          .exec()) as [[null, number], [null, number]];
        return seq;
      } catch {
        // fall through to the local counter
      }
    }
    const seq = (this.local.get(room) ?? 0) + 1;
    this.local.set(room, seq);
    return seq;
  }

  async current(room: string): Promise<number> {
    if (this.redis && this.redis.status === 'ready') {
      const raw = await this.redis
        .get(`thumbz:rt:seq:${room}`)
        .catch(() => null);
      return raw === null ? 0 : Number(raw);
    }
    return this.local.get(room) ?? 0;
  }
}
