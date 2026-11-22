# thumbz-server

API and background worker for **THUMBZ**, a Mobile Legends: Bang Bang (MLBB)
esports companion. Fans watch matches live with realtime stats and chat,
rewatch protected replays game by game, buy venue tickets (QRIS, bank virtual
account or crypto), search everything with typo tolerance, and get match
reminders as push notifications.

- **Web app:** [`thumbz-next-client`](../thumbz-next-client) (Next.js, deployed on Vercel)
- **API contract:** [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md) plus the
  generated [`openapi.json`](openapi.json); `/docs` serves Swagger UI
- **Production API:** `https://thumbz-server-production.up.railway.app`
  (`/health/ready`, `/docs`)

NestJS 11 · TypeScript · Prisma 6 on Supabase Postgres · Redis (cache, rate
limits, queues, realtime fan-out) · BullMQ · Socket.IO · Docker · Railway.

## What it does

| Feature | Summary |
| --- | --- |
| Matches & series | Tournaments, teams, players, matches as best-of-N series; games are data and the score is derived from them |
| Live data | Gold lead, player stats, item purchases, kills and objectives per game, pushed over WebSocket |
| Real demo data | One real week of MPL Philippines S18 (rosters, heroes, builds, emblems, talents, item sequence); live matches replay the recorded games in real time and loop, so something is always live |
| Replays & DRM | Encrypted HLS/DASH, ClearKey license server and HLS key proxy, rotating playback tokens, 2-device limit |
| Tickets & payments | Hold → pay → issue signed ticket QR; Xendit (QRIS, bank VA), NOWPayments (crypto) or a built-in sandbox |
| Search | Postgres `pg_trgm` + full text, typo-tolerant (`onik` → ONIC), suggestions |
| Accounts | Supabase Auth (JWT verified via JWKS), profiles, favorites, watch history, comments |
| Reminders | Web Push (VAPID) before followed matches start |
| Admin API | Create and update tournaments, teams, players, matches, games, live data, videos |

## Architecture

```mermaid
flowchart LR
  subgraph Vercel
    web[Next.js client<br/>ISR + edge CDN, PWA]
  end
  subgraph Railway
    api[API<br/>REST + Socket.IO /rt]
    worker[Worker<br/>BullMQ jobs, live replay]
  end
  redis[(Redis<br/>cache · rate limits · queues<br/>socket.io adapter/emitter)]
  pg[(Supabase Postgres<br/>RLS locked, API-only)]
  storage[(Supabase Storage<br/>encrypted HLS/DASH)]
  auth[Supabase Auth]
  pay[Xendit · NOWPayments]
  push[Web Push services]

  web -- REST / WebSocket --> api
  web -- sign in --> auth
  api -- verify JWT (JWKS) --> auth
  api --> pg
  api --> redis
  worker --> pg
  worker --> redis
  redis -. fan-out .-> api
  pay -- webhooks --> api
  api -- revalidate tags --> web
  worker -- reminders --> push
  web -- segments --> storage
```

Two processes from the same image:

- **api** (`src/main.ts`): HTTP + WebSocket. Stateless; every instance shares
  Redis for cache, rate limits and socket fan-out.
- **worker** (`src/worker.ts`): scheduled jobs. It never serves HTTP. Jobs:
  ticket-hold expiry, payment reconciliation, match reminders and, with
  `LIVE_SIMULATOR=true`, the live replay.

## Flows

### Live match data

The worker plays back recorded games through the same admin services an
operator would use, so caching, realtime and push behave exactly as with real
ingestion.

```mermaid
sequenceDiagram
  participant W as Worker (every 5 s)
  participant S as Admin services
  participant DB as Postgres
  participant R as Redis
  participant A as API instances
  participant C as Browser
  W->>S: state of the game at second t (stats, gold, purchases, events)
  S->>DB: write snapshots, item events, match events
  S->>R: invalidate cache tags + publish "match:live"
  R-->>A: fan-out to every API instance
  A-->>C: Socket.IO room match:<id> → "match:live" {kind}
  C->>A: GET /matches/:id/live-stats (refetch only that resource)
  Note over W,S: at the recorded duration: final stats, real winner,<br/>2-min break, next game; a decided series restarts
```

### Ticket checkout

```mermaid
sequenceDiagram
  participant C as Browser
  participant A as API
  participant P as Provider (Xendit / NOWPayments / sandbox)
  C->>A: POST /matches/:id/orders (Idempotency-Key)
  A->>A: lock quota row, create order + hold (expires)
  C->>A: POST /me/orders/:id/payments (QRIS / VA / crypto)
  A->>P: create the invoice
  A-->>C: payment instructions (QR string, VA number, crypto address)
  P-->>A: webhook (verified, deduplicated)
  A->>A: state machine: pending → paid, issue signed ticket QR
  A-->>C: "order:update" over the socket
  Note over A: worker expires unpaid holds and reconciles stuck payments
```

### Protected replay

```mermaid
sequenceDiagram
  participant C as Player (shaka)
  participant A as API
  participant S as Supabase Storage
  C->>A: POST /playback/sessions (signed in, video id)
  A->>A: device limit check, issue short-lived playback token
  A-->>C: manifest URLs + license / key URLs + token
  C->>S: encrypted segments (public CDN)
  C->>A: POST /drm/clearkey/license or GET /drm/hls/key (with token)
  A->>A: unseal content key with DRM_MASTER_KEY
  A-->>C: content key
  loop every 30 s
    C->>A: POST /playback/sessions/:sid/heartbeat (keeps the stream slot)
  end
```

## Project structure

```text
src/
  main.ts, worker.ts        entry points (api, worker)
  app.setup.ts              global prefix /api/v1, CORS, helmet, validation
  config/                   zod-validated environment (fails fast at boot)
  common/                   errors, pagination cursors, idempotency, guards
  infra/                    cache, events, queue, revalidation, metrics, logging
  prisma/                   Prisma service + test database guard
  modules/
    matches, tournaments, teams, players, videos, search, home   public reads
    admin                   operator writes (matches, games, live data)
    realtime                Socket.IO gateway, rooms, broadcaster
    tickets, payments       checkout, providers, webhooks, reconciliation
    media                   DRM license/key server, playback sessions
    users, favorites, history, comments, push
    jobs, simulator         worker jobs and the live replay engine
prisma/
  schema.prisma, migrations/, seed.ts
  data/                     MPL PH week 8 dataset (committed JSON)
scripts/
  data/mpl-ph/              polite fetcher + parsers for ph-mpl.com
  media/                    package (ffmpeg + Shaka Packager) and register DRM assets
docs/                       API contract, architecture decision records (adr/)
test/                       end-to-end tests (HTTP + Socket.IO)
load/                       k6 and WebSocket load tests
```

## Getting started (local)

### Requirements

- Node 22 (`.nvmrc`; `nvm use`)
- Docker (Postgres and Redis)
- Optional: [Supabase CLI](https://supabase.com/docs/guides/cli) for local
  Auth + Storage (needed to sign in locally)

### Option A: everything local (recommended for development)

Your own database, so you can seed, run the worker and break things freely.

```bash
npm ci
cp .env.example .env
```

Edit `.env` for local services:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:44322/postgres
REDIS_URL=redis://127.0.0.1:6379
CORS_ORIGINS=http://localhost:3000
SUPABASE_JWKS_URL=http://127.0.0.1:44321/auth/v1/.well-known/jwks.json
PAYMENTS_SANDBOX=true
LIVE_SIMULATOR=true
```

Then:

```bash
supabase start                   # local Auth/Storage + Postgres on 44322
# or, without sign-in: docker compose up -d postgres
docker compose up -d redis
npx prisma migrate deploy
npx prisma db seed               # MPL PH S18 week 8: replays, live, upcoming
```

Run the API and the worker in two terminals:

```bash
npm run start:dev                # API on http://localhost:3001  (Swagger: /docs)
```

```bash
npm run start:worker:dev         # jobs + live replay (LIVE_SIMULATOR=true)
```

Check: `http://localhost:3001/health/ready` → `{"status":"ok", ...}`.

### Option B: local API against the shared Supabase project

Development and production share one Supabase project. With `.env` pointing at
it (session pooler `DATABASE_URL`, cloud `SUPABASE_JWKS_URL`), run only:

```bash
docker compose up -d redis
npm run start:dev
```

Rules for the shared database:

- **Never run a local worker against it.** Production already runs one: two
  workers would both drive the live matches, and different VAPID keys would
  delete real users' push subscriptions.
- Don't seed it by accident: the seed replaces all catalog data and refuses a
  remote database unless `SEED_REMOTE=replace-catalog` is set.
- Tests never touch it (see Testing).

### Environment variables

The full annotated list is in [`.env.example`](.env.example) (development) and
[`.env.production.example`](.env.production.example). The essentials:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres; Supabase **session pooler** URI in the cloud |
| `SUPABASE_JWKS_URL` | Verifies Supabase Auth JWTs |
| `REDIS_URL` | Cache, rate limits, queues, socket fan-out |
| `CORS_ORIGINS` | Comma-separated web origins with scheme, e.g. `http://localhost:3000` |
| `FRONTEND_URL`, `PUBLIC_API_URL` | Public URLs (revalidation, payment callbacks) |
| `PAYMENTS_SANDBOX` | `true` = demo checkout without real money |
| `LIVE_SIMULATOR` | `true` on the worker = replay live matches |
| `TICKET_SIGNING_SECRET`, `DRM_MASTER_KEY`, `PLAYBACK_TOKEN_SECRET` | Required in production; dev defaults locally |
| `VAPID_*` | Web Push reminders (all three or none) |
| `XENDIT_*`, `NOWPAYMENTS_*` | Real payment providers (optional) |

### Protected replay (optional)

```bash
FFMPEG=ffmpeg PACKAGER=packager npm run media:package -- demo   # synthetic clip unless a source is given
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… DRM_MASTER_KEY=… DATABASE_URL=… \
  npm run media:register -- media-out/demo --video <video-id>
```

Use the same `DRM_MASTER_KEY` as the API that will serve the video.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run start:dev` | API with hot reload |
| `npm run start:worker:dev` | Worker with hot reload |
| `npm run build` | Compile to `dist/` (`dist/main.js`, `dist/worker.js`) |
| `npm run start:prod` / `start:worker:prod` | Run the compiled API / worker |
| `npm run lint:check`, `npm run typecheck` | ESLint, TypeScript |
| `npm run test:cov`, `npm run test:e2e` | Unit and end-to-end tests |
| `npm run openapi:export` | Regenerate `openapi.json` (CI checks for drift) |
| `npm run data:fetch` / `data:build` | Refresh the MPL PH dataset (see Demo data) |
| `npm run media:package` / `media:register` | Prepare and publish a DRM-protected video |

## Engineering highlights

| Area | What | Where | Why |
| --- | --- | --- | --- |
| Realtime | Socket.IO rooms, per-room `seq` + REST resync, Redis adapter/emitter, presence | `src/modules/realtime/` | [ADR 0001](docs/adr/0001-realtime-over-socket-io.md) |
| Pagination | Opaque keyset cursors (stable ties), capped offsets, `before`/`after` comment cursors | `src/common/utils/cursor.ts` | [ADR 0002](docs/adr/0002-keyset-and-offset-pagination.md) |
| Search | `pg_trgm` + `tsvector`, typo-tolerant (`onik` → ONIC), cached suggestions | `src/modules/search/` | |
| Caching | Cache-aside, single flight + Redis lock, jittered TTL, tag invalidation, ETag/304, CDN headers, frontend revalidation | `src/infra/cache/`, `src/infra/revalidation/` | [ADR 0005](docs/adr/0005-redis-cache-aside-with-tags.md) |
| Payments | One provider interface (Xendit QRIS/VA, NOWPayments, sandbox), inbox dedupe, row locks, pure state machine, amount checks, idempotency keys, signed ticket QR | `src/modules/payments/`, `src/common/idempotency/` | [ADR 0003](docs/adr/0003-payments-behind-one-provider-interface.md) |
| DRM | ClearKey license server, HLS AES-128 key proxy, sealed keys, 2-device limit, commercial CDM passthrough, packaging pipeline | `src/modules/media/`, `scripts/media/` | [ADR 0004](docs/adr/0004-hybrid-drm.md) |
| Jobs | Separate worker, idempotent schedulers: hold expiry, reconciliation, reminders, live replay | `src/worker.ts`, `src/modules/jobs/` | [ADR 0006](docs/adr/0006-separate-worker-process.md) |
| Series model | Games as data, score derived, per-game statistics, builds and item sequence | `src/modules/matches/`, `src/modules/admin/` | [ADR 0007](docs/adr/0007-series-games-as-data.md) |
| Real data | One week of MPL PH S18 imported politely (robots.txt, cache, pauses), parsed and tested; live matches replay the recorded games in real time and loop | `scripts/data/mpl-ph/`, `src/modules/simulator/` | [ADR 0008](docs/adr/0008-demo-replays-real-recorded-games.md) |
| Web Push | VAPID, per-device subscriptions, deduped reminders, dead-endpoint cleanup | `src/modules/push/` | |
| Operations | zod-validated env (fails fast), pino JSON logs + request ids, Prometheus `/metrics`, `/health/live` + `/health/ready`, graceful shutdown | `src/config/`, `src/infra/` | |
| Safety | Test runs refuse non-local databases, RLS deny-by-default, write rate limits per user/IP, error envelope that never leaks internals | `src/prisma/test-database-guard.ts`, `src/common/` | |

## Testing

| Suite | Command | Notes |
| --- | --- | --- |
| Lint + types | `npm run lint:check && npm run typecheck` | |
| Unit / integration | `npm run test:cov` | Coverage floor in `package.json` |
| End to end (HTTP + Socket.IO) | `npm run test:e2e -- --coverage` | Against real Postgres/Redis, incl. the live replay loop on a faked clock; floor in `test/jest-e2e.json` |
| Load | see [`load/README.md`](load/README.md) | k6 read paths: 2,012 req/s, p95 88 ms · 2,000 sockets: 100 % reach, p95 45 ms |

Tests only run against a local database: `test/setup-env.ts` loads
`.env.test` (Docker Postgres on 44322, Redis on 6379), and the Prisma client
refuses any non-local host while `NODE_ENV=test`. Start them with
`docker compose up -d postgres redis`. Stop any local worker first: it would
replay the test's live match too.

CI (`.github/workflows/ci.yml`) runs lint, types, build, an OpenAPI drift
check, migrations + seed, both suites with coverage floors, and a Docker image
build. `load.yml` runs the load tests against a given URL on demand.

## Database notes

- Migrations live in `prisma/migrations/`; every business table has Row Level
  Security enabled with no grants to `anon`/`authenticated`. Only the API
  (service role) reads them and enforces auth itself.
- Supabase in production: use the **session pooler** URI with
  `?pgbouncer=true&connection_limit=4`. The direct host is IPv6-only on new
  projects, and the transaction pooler (`:6543`) breaks Prisma migrations.
  Don't keep the `[...]` around the password from the dashboard.
- `npx prisma db seed` replaces all catalog data (tournaments, teams, players,
  matches, videos) with the dataset in `prisma/data/`, keeps user accounts and
  re-links a registered protected replay. It refuses a non-local database
  unless `SEED_REMOTE=replace-catalog` is set.

## Demo data

Real match data of **MPL Philippines Season 18, week 8** (ph-mpl.com):
rosters, heroes, K/D/A, gold, damage, builds, emblems, talents and the item
purchase sequence of every game. Names of items, emblems and talents come from
MLBB Academy reference data. Dates are shifted around "now": the first day's
matches are yesterday's replays, the middle day's are live (the worker replays
the recorded games, looping), the last day's are upcoming with tickets.

**MPL Indonesia Season 18** is demo data built from the same week: every MPL PH
team is swapped for an MPL ID team and each player for the MPL ID player in the
same role (`indonesiaFrom()` in `prisma/seed.ts`), so the games, builds and
item sequences are the PH ones under Indonesian names. Its calendar runs an
hour earlier, with Bahasa Indonesia + English broadcasts.

```bash
npm run data:fetch -- --week 8   # polite: robots.txt paths only, cached in data-cache/
npm run data:build -- --week 8   # → prisma/data/*.json + catalog-review.csv
```

Kill and objective counts are real; their times are reconstructed (ph-mpl.com
doesn't publish them) and flagged `details.reconstructed = true`.

## Deployment

Railway, from the `Dockerfile`:

- **api**: default start command (`node dist/main.js`), config `railway.json`
  (runs `prisma migrate deploy` before each release, healthcheck `/health`),
  public domain.
- **worker**: same repo and variables, config file `railway.worker.json`
  (start command `node dist/worker.js`, no healthcheck), no public domain,
  `LIVE_SIMULATOR=true`.
- A Redis plugin shared by both (`REDIS_URL=${{Redis.REDIS_URL}}`).

Required production variables are validated at boot; see
`.env.production.example`. Pushing to `main` deploys.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Browser: "blocked by CORS policy" | The web app's origin isn't in `CORS_ORIGINS` (exact match, with `http://` or `https://`, no trailing slash); a dev server on port 3002 needs `http://localhost:3002` too |
| API won't start: "X is required" | Missing env var in production; the message names it |
| `${{Redis.REDIS_URL}}` error on Railway | No Redis service with that name in the environment; add the plugin or use its actual name |
| Live matches show no data | No worker running with `LIVE_SIMULATOR=true` against that database |
| Protected replay won't play | `DRM_MASTER_KEY` differs from the one used at `media:register`; re-register |

Match data © Moonton / MPL Philippines, used for a non-commercial portfolio.
