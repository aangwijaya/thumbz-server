import { SetMetadata } from '@nestjs/common';

export const CACHED_KEY = 'thumbz:cached';

export interface CachedOptions {
  /** Server-side (Redis) TTL in seconds; also the CDN `s-maxage`. */
  ttl: number;
  /** Tags for invalidation, derived from route params. */
  tags?: (params: Record<string, string>) => string[];
  /**
   * The response depends on the caller (optional-auth routes): signed-in
   * callers get a per-user entry and `private, no-store`; anonymous callers
   * share the public entry.
   */
  perUser?: boolean;
  /** CDN stale-while-revalidate window in seconds (default 2 × ttl). */
  staleWhileRevalidate?: number;
}

/**
 * Caches a public GET response in Redis and marks it CDN-cacheable.
 * Undecorated routes are `Cache-Control: no-store`.
 */
export const Cached = (options: CachedOptions) =>
  SetMetadata(CACHED_KEY, options);
