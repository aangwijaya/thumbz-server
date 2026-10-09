import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { MetricsService } from '../metrics/metrics.service';
import { REDIS } from '../redis/redis.constants';

const DEFAULT_NAMESPACE = 'thumbz';

/** Tag sets outlive their members; stale members are harmless (DEL no-ops). */
const TAG_TTL_SECONDS = 24 * 60 * 60;
/** Longest a cache rebuild may hold the lock before another caller retries. */
const LOCK_TTL_MS = 5_000;
/** How long a caller waits for another instance's rebuild before loading itself. */
const LOCK_WAIT_MS = 1_000;
const LOCK_POLL_MS = 50;
/** Spread expiries so keys written together do not all miss together. */
const TTL_JITTER = 0.1;

// Deletes every key in a tag set and the set itself, atomically.
const INVALIDATE_TAG_SCRIPT = `
local keys = redis.call('SMEMBERS', KEYS[1])
for i = 1, #keys, 500 do
  redis.call('DEL', unpack(keys, i, math.min(i + 499, #keys)))
end
redis.call('DEL', KEYS[1])
return #keys
`;

// Releases a lock only if this caller still owns it.
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export type CacheResult = 'hit' | 'miss' | 'bypass';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cache-aside over Redis with stampede protection:
 * - in-process single flight (concurrent callers share one loader call)
 * - a short Redis lock so only one instance rebuilds an expired key
 * - jittered TTLs, and tag sets for targeted invalidation.
 *
 * Redis is an optimization, never a dependency: when it is unconfigured,
 * not ready, or errors, callers get the loader's result directly.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly requests;

  private readonly valuePrefix: string;
  private readonly tagPrefix: string;
  private readonly lockPrefix: string;

  constructor(
    @Inject(REDIS) private readonly redis: Redis | null,
    metrics: MetricsService,
    @Optional() config?: ConfigService,
  ) {
    this.requests = metrics.counter(
      'thumbz_cache_requests_total',
      'Cache lookups by result',
      ['result'],
    );
    // Namespacing lets several environments (or parallel test suites) share
    // one Redis without reading each other's entries.
    const namespace =
      config?.get<string>('cacheNamespace') ?? DEFAULT_NAMESPACE;
    this.valuePrefix = `${namespace}:cache:`;
    this.tagPrefix = `${namespace}:tag:`;
    this.lockPrefix = `${namespace}:lock:`;
  }

  private get available(): boolean {
    return this.redis !== null && this.redis.status === 'ready';
  }

  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
    tags: string[] = [],
  ): Promise<{ value: T; result: CacheResult }> {
    if (!this.available) {
      this.requests.inc({ result: 'bypass' });
      return { value: await loader(), result: 'bypass' };
    }

    const pending = this.inFlight.get(key) as
      Promise<{ value: T; result: CacheResult }> | undefined;
    if (pending) {
      return pending;
    }

    const lookup = this.lookup(key, ttlSeconds, loader, tags).finally(() =>
      this.inFlight.delete(key),
    );
    this.inFlight.set(key, lookup);
    return lookup;
  }

  /** Removes every cached entry tagged with any of `tags`. */
  async invalidateTags(tags: string[]): Promise<number> {
    if (!this.available || tags.length === 0) {
      return 0;
    }
    try {
      const counts = await Promise.all(
        [...new Set(tags)].map(
          (tag) =>
            this.redis!.eval(
              INVALIDATE_TAG_SCRIPT,
              1,
              `${this.tagPrefix}${tag}`,
            ) as Promise<number>,
        ),
      );
      return counts.reduce((sum, count) => sum + count, 0);
    } catch (error) {
      this.logger.warn(`tag invalidation failed: ${String(error)}`);
      return 0;
    }
  }

  private async lookup<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
    tags: string[],
  ): Promise<{ value: T; result: CacheResult }> {
    const valueKey = `${this.valuePrefix}${key}`;
    const cached = await this.read<T>(valueKey);
    if (cached !== undefined) {
      this.requests.inc({ result: 'hit' });
      return { value: cached, result: 'hit' };
    }

    const lockKey = `${this.lockPrefix}${key}`;
    const token = randomUUID();
    const locked = await this.tryLock(lockKey, token);
    if (!locked) {
      // Another instance is rebuilding this key: wait briefly for its result.
      const deadline = Date.now() + LOCK_WAIT_MS;
      while (Date.now() < deadline) {
        await sleep(LOCK_POLL_MS);
        const rebuilt = await this.read<T>(valueKey);
        if (rebuilt !== undefined) {
          this.requests.inc({ result: 'hit' });
          return { value: rebuilt, result: 'hit' };
        }
      }
    }

    try {
      const value = await loader();
      this.requests.inc({ result: 'miss' });
      if (value !== undefined) {
        await this.write(valueKey, value, ttlSeconds, tags);
      }
      return { value, result: 'miss' };
    } finally {
      if (locked) {
        await this.redis!.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token).catch(
          () => undefined,
        );
      }
    }
  }

  private async read<T>(valueKey: string): Promise<T | undefined> {
    try {
      const raw = await this.redis!.get(valueKey);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }

  private async tryLock(lockKey: string, token: string): Promise<boolean> {
    try {
      return (
        (await this.redis!.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX')) ===
        'OK'
      );
    } catch {
      return true; // cannot coordinate: just load
    }
  }

  private async write(
    valueKey: string,
    value: unknown,
    ttlSeconds: number,
    tags: string[],
  ): Promise<void> {
    const ttl = Math.max(
      1,
      Math.round(ttlSeconds * (1 + Math.random() * TTL_JITTER)),
    );
    try {
      const tx = this.redis!.multi().set(
        valueKey,
        JSON.stringify(value),
        'EX',
        ttl,
      );
      for (const tag of new Set(tags)) {
        const tagKey = `${this.tagPrefix}${tag}`;
        tx.sadd(tagKey, valueKey).expire(tagKey, TAG_TTL_SECONDS);
      }
      await tx.exec();
    } catch (error) {
      this.logger.warn(`cache write failed: ${String(error)}`);
    }
  }
}
