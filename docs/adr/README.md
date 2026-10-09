# Architecture decision records

Short records of decisions that shape the system: the context, what was
decided, and what it costs. Newest last; a superseded record says so at the top.

| # | Decision |
| --- | --- |
| [0001](0001-realtime-over-socket-io.md) | Realtime over Socket.IO (WebSocket), REST stays the source of truth |
| [0002](0002-keyset-and-offset-pagination.md) | Keyset cursors for feeds, offsets for numbered pages |
| [0003](0003-payments-behind-one-provider-interface.md) | Payments behind one provider interface, webhooks through an inbox |
| [0004](0004-hybrid-drm.md) | Hybrid DRM: ClearKey + HLS AES-128 self-hosted, commercial DRM pluggable |
| [0005](0005-redis-cache-aside-with-tags.md) | Redis cache-aside with tag invalidation and CDN headers |
| [0006](0006-separate-worker-process.md) | A separate worker process for jobs and the simulator |
| [0007](0007-series-games-as-data.md) | Games of a series are data; the score is derived from them |
| [0008](0008-demo-replays-real-recorded-games.md) | The live demo replays real recorded games |

Frontend-only decisions live in the client repo (`docs/adr/`).
