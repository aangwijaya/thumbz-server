import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis/redis.constants';

/** A viewer counts as present while it pinged within this window. */
const PRESENCE_TTL_MS = 60_000;

/**
 * "N watching on THUMBZ" per match: a Redis sorted set of socket ids scored
 * by last heartbeat, so counts are correct across API instances and stale
 * sockets (crashed instances) age out. Falls back to local room sizes.
 */
@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  private key(room: string): string {
    return `thumbz:presence:${room}`;
  }

  private get available(): boolean {
    return this.redis !== null && this.redis.status === 'ready';
  }

  async touch(room: string, socketId: string): Promise<void> {
    if (!this.available) return;
    await this.redis!.zadd(this.key(room), Date.now(), socketId).catch(
      () => undefined,
    );
  }

  async leave(room: string, socketId: string): Promise<void> {
    if (!this.available) return;
    await this.redis!.zrem(this.key(room), socketId).catch(() => undefined);
  }

  /** Present viewers; `localCount` is used when Redis is unavailable. */
  async count(room: string, localCount: number): Promise<number> {
    if (!this.available) return localCount;
    const key = this.key(room);
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    try {
      const [, [, count]] = (await this.redis!.multi()
        .zremrangebyscore(key, 0, cutoff)
        .zcard(key)
        .pexpire(key, PRESENCE_TTL_MS * 2)
        .exec()) as [[null, number], [null, number], [null, number]];
      return count;
    } catch {
      return localCount;
    }
  }
}
