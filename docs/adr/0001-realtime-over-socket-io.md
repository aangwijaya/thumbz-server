# 0001 — Realtime over Socket.IO, REST stays the source of truth

**Status:** accepted (2026-10)

## Context
Live match pages polled every 5–30 s: scores and status never refreshed, and a
busy match multiplied identical requests. Updates flow one way (server → many
viewers); writes (comments, orders) need validation and rate limits.

## Decision
- Socket.IO namespace `/rt` with rooms (`match:<id>`, `user:<id>`, `live`); the
  socket only **pushes**. Every write goes through REST.
- Messages carry a per-room `seq` (Redis `INCR`). A client that sees a gap
  refetches over REST, so a dropped message never leaves the page wrong.
- Horizontal scale through `@socket.io/redis-adapter`; the worker publishes
  with `@socket.io/redis-emitter` without holding sockets.
- Heavy payloads stay on REST: `match:live` says *what* changed and the client
  refetches through the cache, so fan-out cost is constant per message.

## Alternatives
- **SSE:** simpler and HTTP-native, but one stream per page per topic and no
  client → server channel for room changes; Safari/iOS keeps fewer connections.
- **Polling only:** what we had; correct but slow and wasteful at scale.

## Consequences
- Sticky sessions are not needed (WebSocket transport, Redis adapter).
- Polling remains as the fallback when the socket is down.
- Measured locally: 2,000 clients in one room, 100 % reach, p95 spread 45 ms
  (`load/README.md`).
