import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { MetricsService } from '../metrics/metrics.service';
import { CacheService } from './cache.service';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

async function readyClient(): Promise<Redis> {
  const client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  if (client.status !== 'ready') {
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve);
      client.once('error', reject);
    });
  }
  return client;
}

describe('CacheService (Redis)', () => {
  let redisA: Redis;
  let redisB: Redis;
  let cacheA: CacheService;
  let cacheB: CacheService;
  let ns: string;

  beforeAll(async () => {
    redisA = await readyClient();
    redisB = await readyClient();
    cacheA = new CacheService(redisA, new MetricsService());
    cacheB = new CacheService(redisB, new MetricsService());
  });

  beforeEach(() => {
    ns = `spec:${randomUUID()}`;
  });

  afterAll(async () => {
    await redisA.quit();
    await redisB.quit();
  });

  it('misses once, then serves the cached value', async () => {
    const loader = jest.fn().mockResolvedValue({ n: 1 });

    const first = await cacheA.getOrSet(`${ns}:k`, 30, loader);
    const second = await cacheA.getOrSet(`${ns}:k`, 30, loader);

    expect(first).toEqual({ value: { n: 1 }, result: 'miss' });
    expect(second).toEqual({ value: { n: 1 }, result: 'hit' });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent callers in one process into a single load', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return calls;
    };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => cacheA.getOrSet(`${ns}:k`, 30, loader)),
    );

    expect(calls).toBe(1);
    expect(new Set(results.map((r) => r.value))).toEqual(new Set([1]));
  });

  it('lets only one instance rebuild an expired key (distributed lock)', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return 'fresh';
    };

    const [a, b] = await Promise.all([
      cacheA.getOrSet(`${ns}:k`, 30, loader),
      cacheB.getOrSet(`${ns}:k`, 30, loader),
    ]);

    expect(calls).toBe(1);
    expect(a.value).toBe('fresh');
    expect(b.value).toBe('fresh');
  });

  it('invalidates every entry carrying a tag, and only those', async () => {
    const tag = `${ns}:tag`;
    await cacheA.getOrSet(`${ns}:a`, 30, () => Promise.resolve('a'), [tag]);
    await cacheA.getOrSet(`${ns}:b`, 30, () => Promise.resolve('b'), [tag]);
    await cacheA.getOrSet(`${ns}:c`, 30, () => Promise.resolve('c'), [
      `${ns}:other`,
    ]);

    await expect(cacheA.invalidateTags([tag])).resolves.toBe(2);

    const a = await cacheA.getOrSet(`${ns}:a`, 30, () => Promise.resolve('a2'));
    const c = await cacheA.getOrSet(`${ns}:c`, 30, () => Promise.resolve('c2'));
    expect(a).toEqual({ value: 'a2', result: 'miss' });
    expect(c).toEqual({ value: 'c', result: 'hit' });
  });

  it('does not cache loader failures', async () => {
    await expect(
      cacheA.getOrSet(`${ns}:k`, 30, () => Promise.reject(new Error('db'))),
    ).rejects.toThrow('db');

    const retry = await cacheA.getOrSet(`${ns}:k`, 30, () =>
      Promise.resolve('ok'),
    );
    expect(retry).toEqual({ value: 'ok', result: 'miss' });
  });

  it('applies a jittered TTL close to the requested one', async () => {
    await cacheA.getOrSet(`${ns}:k`, 100, () => Promise.resolve(1));
    const ttl = await redisA.ttl(`thumbz:cache:${ns}:k`);
    expect(ttl).toBeGreaterThanOrEqual(99);
    expect(ttl).toBeLessThanOrEqual(110);
  });
});

describe('CacheService (no Redis)', () => {
  it('bypasses the cache and always calls the loader', async () => {
    const cache = new CacheService(null, new MetricsService());
    const loader = jest.fn().mockResolvedValue('v');

    await expect(cache.getOrSet('k', 30, loader)).resolves.toEqual({
      value: 'v',
      result: 'bypass',
    });
    await cache.getOrSet('k', 30, loader);

    expect(loader).toHaveBeenCalledTimes(2);
    await expect(cache.invalidateTags(['t'])).resolves.toBe(0);
  });
});
