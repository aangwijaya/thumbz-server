# 0005 — Redis cache-aside with tag invalidation and CDN headers

**Status:** accepted (2026-10)

## Context
Every page view hit Postgres, the throttler was in-memory per instance, and
responses had no cache headers for a CDN.

## Decision
- `CacheService.getOrSet(key, ttl, loader, tags)`: in-process single flight,
  a short Redis lock so one instance rebuilds an expired key, jittered TTLs.
- Tags (`match:<id>`, `catalog`, …) are Redis sets; domain events invalidate
  tags after commits, so admin writes and the live simulator refresh exactly
  what they touch.
- Public GETs send `Cache-Control: public, s-maxage, stale-while-revalidate`
  and a strong ETag (304); `/me/*` sends `private, no-store`.
- After a write the API calls the frontend's revalidation webhook with the
  same tags, so Vercel's ISR cache follows the API's.
- Redis is an optimization: when it is down, callers get the loader result.

## Consequences
- Reads stay fast under load (k6: 2,012 req/s, p95 88 ms on one instance).
- Tag sets can hold stale members; deleting a missing key is a no-op.
