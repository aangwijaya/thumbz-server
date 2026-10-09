# Load tests

Two scripts, both against a running stack (API + worker with `LIVE_SIMULATOR=true`).

## HTTP read paths — k6

Weighted like match-day traffic: home 30 %, match lists 20 %, match detail
(+ live stats + events) 25 %, search 13 %, replays 12 %. Reads are never rate
limited (only writes are), so one load generator is enough.

```bash
docker run --rm -i -e BASE_URL=http://<api-host>:3001 -e VUS=100 -e DURATION=1m \
  grafana/k6:1.3.0 run - < load/read-paths.js
```

Thresholds: < 1 % errors; p95 < 250 ms (search < 400 ms).

## Realtime fan-out — Socket.IO

N clients join one live match room; each `match:live` broadcast's arrival is
timed on every client (one process, one clock). Reports connection success,
connect time, reach and the first-to-last delivery spread.

```bash
API_URL=http://<api-host>:3001 node load/ws-fanout.mjs 2000 30
```

## Latest local results (2026-10-09)

One API process (`NODE_ENV=development`, request logging on), Postgres and
Redis in Docker, load generated on the same WSL2 machine — so these are a
floor, not a production capacity figure.

| Test | Load | Result |
| --- | --- | --- |
| HTTP reads (k6) | 100 VUs, 1 min | 2,012 req/s, 0 % errors, p95 88 ms (home 78, match detail 102, list 88, search 88, replays 80) |
| Fan-out | 1,000 clients, 30 s | 1,000/1,000 connected, 100 % reach, spread p95 41 ms |
| Fan-out | 2,000 clients, 30 s | 2,000/2,000 connected, 100 % reach, spread p95 45 ms |

Horizontal scale: API instances share rooms through the Redis adapter, and the
worker publishes through the Redis emitter, so fan-out grows with instances.
