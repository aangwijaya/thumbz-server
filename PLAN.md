# THUMBZ Server Implementation Plan (thumbz-server)

> **NestJS backend for THUMBZ. This plan is the primary execution guide for the server implementation agent.**
>
> Authoritative inputs:
> 1. `../docs/API-CONTRACT.md` — the API the server MUST implement.
> 2. `design/design.md` — NOTE: currently a verbatim copy of the client's visual design document. It contains **no backend-specific requirements**. Backend requirements are therefore derived from the product identity and feature sections of that document (matches, tournaments, teams, players, statistics, streams, videos, authenticated favorites/watch history) and are fully formalized in the API contract. If a product question is not answered by the API contract, ask the planner — do not invent requirements.

---

## 1. Executive summary

Build a NestJS + TypeScript + PostgreSQL (Supabase) backend for THUMBZ: a read-heavy esports streaming/content platform. The backend owns all business logic, validation, authorization, and persistence; Supabase provides managed Postgres and authentication infrastructure. The server exposes a versioned REST API (`/api/v1`) defined in `docs/API-CONTRACT.md`, with three access tiers (public catalog, authenticated `/me/*`, admin ingestion), plus a seed script for demo data.

**Deliberately out of scope (MVP):** Redis caching, Supabase Realtime, video hosting/transcoding, microservices, MFA, social login. Redis is intentionally not required for the current architecture. Live freshness is handled by client polling (30s) against normal endpoints.

## 2. Current architecture

- Repository contains only: `README.md` (one line), `design/design.md` (visual design duplicate), `.env` (live Supabase credentials, untracked).
- No `package.json`, no source code, no `AGENTS.md`, no tests, no migrations.
- Supabase: linked cloud project `thumbz` (ref `qshjcszsvsgwpcgggkiv`, region ap-northeast-1, Postgres 17); `../supabase/config.toml` exists for the local dev stack (Auth, Storage, Studio; Realtime enabled in config but unused).

This is a greenfield backend. Nothing to reuse; nothing to rewrite.

## 3. Target architecture

```text
                    ┌─────────────────┐
                    │     Next.js     │
                    │     Client      │
                    └────────┬────────┘
                             │ HTTP/JSON  (Authorization: Bearer <supabase JWT>)
                             ▼
                    ┌─────────────────┐
                    │     NestJS      │
                    │                 │
                    │ JWT guard (JWKS)│
                    │ Business logic  │
                    │ Authorization   │
                    │ Validation      │
                    │ REST /api/v1    │
                    └────────┬────────┘
                             │ Prisma (service_role credentials, server-side only)
                             ▼
                    ┌─────────────────┐
                    │   PostgreSQL    │  ← Supabase managed (auth schema lives here too)
                    └─────────────────┘
```

- Single NestJS modular monolith. No microservices.
- Supabase = managed Postgres + Auth (JWT issuing/verification source) + optional Storage (not used in MVP — all media are external URLs).
- No Redis. No message queue. No cron jobs in MVP (viewer counts arrive via `PUT /admin/matches/:id/live`).

## 4. NestJS architecture

### 4.1 Stack

| Concern | Choice |
| --- | --- |
| Framework | NestJS 11 (Express platform, default) |
| Language | TypeScript (strict) |
| ORM + migrations | Prisma (PostgreSQL provider) |
| Validation | `class-validator` + `class-transformer` DTOs, global `ValidationPipe` |
| JWT verification | `jose` (JWKS fetch + RS256 verify) in a custom guard — no Passport dependency |
| Env validation | `@nestjs/config` with a hand-rolled env schema check (fail fast at boot) |
| Health | `@nestjs/terminus` (`/health` outside versioned prefix) |
| Security | `helmet`, CORS allowlist, `@nestjs/throttler` on writes |
| Logging | NestJS built-in logger (structured JSON in production via a custom `Logger` setup — keep it simple: default logger with request context) |
| Testing | Jest (unit + service) and Nest e2e (supertest) against a real local Postgres |

### 4.2 Module map (modular monolith)

```text
AppModule
├── ConfigModule          env loading/validation
├── PrismaModule          global PrismaService
├── AuthModule            JWKS JWT guard, @Public, @Roles, @CurrentUser
├── UsersModule           /me, lazy profile creation
├── FavoritesModule       /me/favorites
├── HistoryModule         /me/history
├── TournamentsModule     /tournaments (incl. schedule, standings, teams, results, stages)
├── TeamsModule           /teams (incl. matches, statistics, roster)
├── PlayersModule         /players (incl. matches, statistics)
├── MatchesModule         /matches (incl. live, upcoming, featured, statistics, roster, history, related)
├── VideosModule          /videos
├── SearchModule          /search
├── HomeModule            /home aggregation
├── AdminModule           /admin/* ingestion (all five entity types + live + statistics)
└── HealthModule          /health
```

### 4.3 Layering inside modules

Each module follows the standard, boring NestJS pattern — no extra abstraction layers:

```text
module/
├── <name>.module.ts
├── <name>.controller.ts     route + HTTP concerns only
├── <name>.service.ts        business logic + repository access via PrismaService
├── dto/                     request DTOs (create, update, query, param)
└── <name>.service.spec.ts   unit tests
```

- Controllers never contain business rules.
- Services use `PrismaService` directly (no generic repository layer — Prisma already IS the repository).
- Cross-module reads (e.g. MatchesService needing teams for `/home`) go through the other module's service or a shared query in PrismaService — prefer direct service injection; do not build event buses.

### 4.4 Common infrastructure (`src/common/`)

```text
common/
├── decorators/
│   ├── public.decorator.ts        @Public() — skips JWT guard
│   ├── roles.decorator.ts         @Roles('admin')
│   └── current-user.decorator.ts  @CurrentUser() — extracts verified JWT payload
├── guards/
│   ├── jwt-auth.guard.ts          global guard; verifies RS256 via JWKS (SUPABASE_JWKS_URL), caches JWKS per kid
│   └── roles.guard.ts             enforces @Roles() via profiles.role
├── filters/
│   └── http-exception.filter.ts   maps everything to the contract error shape (§16)
├── dto/
│   ├── pagination.dto.ts          page/pageSize (defaults, caps)
│   └── sort.dto.ts                sort/order whitelist helper
└── utils/
    └── slug.ts                    slug normalization/validation
```

Global guard strategy: JWT guard is registered globally; catalog endpoints are marked `@Public()`. Role checks are per-route via `@Roles()`. A valid session never implies admin.

## 5. Supabase architecture

| Responsibility | Owner | Notes |
| --- | --- | --- |
| Managed PostgreSQL hosting | Supabase | Connect via the transaction pooler URL (port 5432 / prepared statements off) |
| Auth: signup/signin/session/refresh/password | Supabase Auth | Client talks to Supabase directly; server never handles credentials |
| Auth: token verification | NestJS | JWKS (`SUPABASE_JWKS_URL`), RS256, `sub` claim = user id |
| Database migrations | Prisma + `prisma migrate` | Run against Supabase Postgres (local via `supabase start`, then cloud via `DATABASE_URL`) |
| RLS policy definition | Prisma migrations (SQL) | Deny-by-default for anon/authenticated (§9) |
| Storage | Not used in MVP | Media = external URLs stored in the DB; Supabase Storage buckets remain available for a future upload workflow |
| Realtime | Not used in MVP | Client polls REST endpoints |
| PostgREST / Data API | Effectively disabled for app data | RLS deny-by-default + no grants to anon/authenticated; all app data flows through NestJS |

**Credential rule:** the Supabase **secret key** lives ONLY in the server environment (`DATABASE_URL` / Prisma connection). The client only ever receives the publishable/anon key via its own Supabase setup. The server never returns Supabase credentials in any response.

Local dev workflow:

```text
supabase start          # local Postgres (port 54322) + Auth + Studio
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
prisma migrate dev      # apply + generate
npm run seed            # demo data
npm run start:dev       # NestJS on :3001
```

## 6. PostgreSQL schema

All tables live in the `public` schema. UUIDs use `gen_random_uuid()`. All tables have `created_at`/`updated_at` (timestamptz). No soft deletes in MVP (deletion is protected by dependency checks instead).

### 6.1 Tables

#### `profiles`

Application profile mirroring `auth.users`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | FK → `auth.users(id)` (schema provided by Supabase) |
| `username` | text, unique | nullable; user-set later |
| `avatar_url` | text, nullable | |
| `role` | enum `user_role` (`user`,`admin`), default `user` | authorization source |
| `created_at` / `updated_at` | timestamptz | |

Rules: created lazily on first authenticated API call (upsert by id). Seed script creates an `admin` profile + a Supabase Auth test admin user.

#### `tournaments`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `slug` | text, unique, `[a-z0-9-]+` | URL identifier |
| `name` | text | |
| `status` | enum `tournament_status` (`upcoming`,`ongoing`,`completed`) | |
| `region` | text | e.g. "Indonesia" |
| `start_date` / `end_date` | date | |
| `prize_pool` | text, nullable | free-form ("350000 USD") |
| `description` | text, nullable | |
| `logo_url` | text, nullable | |
| `featured` | boolean, default false | |

Indexes: unique `slug`; `(status, start_date desc)`.

#### `teams`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `slug` | text, unique | |
| `name` | text | |
| `region` | text | |
| `logo_url` | text, nullable | |
| `color_primary` | text, nullable | hex |
| `color_secondary` | text, nullable | hex |
| `description` | text, nullable | |
| `founded_year` | int, nullable | |
| `is_active` | boolean, default true | |

Indexes: unique `slug`; `name` (asc).

#### `players`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `slug` | text, unique | |
| `nickname` | text | |
| `real_name` | text, nullable | |
| `role` | enum `player_role` (`gold`,`mid`,`exp`,`jungle`,`roam`,`flex`,`coach`) | |
| `country` | text, nullable | |
| `team_id` | uuid, nullable | FK → teams (SET NULL) |
| `photo_url` | text, nullable | |
| `is_active` | boolean, default true | |

Indexes: unique `slug`; `(team_id)`; `nickname`.

#### `matches`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `tournament_id` | uuid, nullable | FK → tournaments (RESTRICT) |
| `stage` | enum `match_stage` (`group_stage`,`regular_season`,`playoffs`,`semifinal`,`third_place`,`grand_final`), nullable | |
| `round` | int, nullable | |
| `group_name` | text, nullable | |
| `best_of` | int, default 1 | |
| `game_number` | int, nullable | |
| `team_a_id` / `team_b_id` | uuid | FK → teams (RESTRICT); CHECK `team_a_id <> team_b_id` |
| `score_a` / `score_b` | int, nullable | non-negative CHECK |
| `winner_team_id` | uuid, nullable | FK → teams; CHECK winner ∈ {a, b} enforced in service |
| `status` | enum `match_status` (`scheduled`,`live`,`completed`,`cancelled`,`postponed`), default `scheduled` | |
| `scheduled_at` | timestamptz | |
| `started_at` / `ended_at` | timestamptz, nullable | |
| `stream_url` | text, nullable | external HLS/DASH/YouTube URL |
| `thumbnail_url` | text, nullable | |
| `viewer_count` | int, default 0 | meaningful only when live |
| `featured` | boolean, default false | |

Indexes: `(status, scheduled_at)`; `(tournament_id)`; `(team_a_id)`; `(team_b_id)`; partial `(started_at) WHERE status = 'live'`; partial `(featured) WHERE featured`.

#### `match_team_statistics`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `match_id` | uuid | FK → matches (CASCADE) |
| `team_id` | uuid | FK → teams (RESTRICT) |
| `kills` / `deaths` / `assists` | int, default 0 | |
| `gold` | int, default 0 | |
| `towers_destroyed` | int, default 0 | |
| `game_duration_seconds` | int, nullable | |
| `details` | jsonb, default `{}` | opaque game-specific data |

Unique `(match_id, team_id)`. Index `(team_id)` for team aggregates.

#### `player_match_statistics`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `match_id` | uuid | FK → matches (CASCADE) |
| `player_id` | uuid | FK → players (RESTRICT) |
| `team_id` | uuid | FK → teams (RESTRICT) |
| `kills` / `deaths` / `assists` / `gold` | int, default 0 | |
| `damage` / `damage_taken` | int, default 0 | non-negative CHECK |
| `level` | int, nullable | |
| `hero_picked` | text, nullable | |
| `mvp` | boolean, default false | |
| `details` | jsonb, default `{}` | |

Unique `(match_id, player_id)`. Indexes: `(player_id)`, `(match_id)` (covered by unique), `(team_id, match_id)`.

#### `videos`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `match_id` | uuid, nullable | FK → matches (SET NULL) |
| `title` | text | |
| `type` | enum `video_type` (`replay`,`highlight`,`vod`) | |
| `url` | text | external |
| `thumbnail_url` | text, nullable | |
| `duration_seconds` | int, nullable | |
| `published_at` | timestamptz, default now() | |

Index: `(type, published_at desc)`.

#### `favorites`

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | uuid | FK → profiles (CASCADE) |
| `entity_type` | enum `favorite_type` (`team`,`player`) | |
| `entity_id` | uuid | polymorphic — validated in service against the target table |
| `created_at` | timestamptz | |

PK `(user_id, entity_type, entity_id)`. Index `(entity_type, entity_id)`.

#### `watch_history`

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | uuid | FK → profiles (CASCADE) |
| `match_id` | uuid | FK → matches (CASCADE) |
| `watched_at` | timestamptz, default now() | |
| `duration_seconds` | int, nullable | |

PK `(user_id, match_id)`. Index `(user_id, watched_at desc)`.

#### `match_gold_snapshots`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `match_id` | uuid | FK → matches (CASCADE) |
| `team_id` | uuid | FK → teams (RESTRICT) |
| `gold` | int, default 0 | non-negative CHECK |
| `recorded_at` | timestamptz, default now() | |

Unique `(match_id, team_id, recorded_at)` — idempotent appends. Index `(match_id, recorded_at)`.

#### `player_match_snapshots`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `match_id` | uuid | FK → matches (CASCADE) |
| `player_id` | uuid | FK → players (RESTRICT) |
| `team_id` | uuid | FK → teams (RESTRICT) |
| `kills` / `deaths` / `assists` / `gold` / `damage` / `damage_taken` | int, default 0 | non-negative CHECK |
| `level` | int, nullable | |
| `recorded_at` | timestamptz, default now() | |

Unique `(match_id, player_id, recorded_at)`. Index `(match_id, recorded_at)`.

#### `match_item_events`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `match_id` | uuid | FK → matches (CASCADE) |
| `player_id` | uuid | FK → players (RESTRICT) |
| `team_id` | uuid | FK → teams (RESTRICT) |
| `item_id` | text | game item identifier |
| `item_name` | text | display name |
| `phase` | enum `match_item_phase` (`phase2`,`phase3`) | |
| `slot` | int, nullable | position inside the phase |
| `purchased_at` | timestamptz, default now() | |

Unique `(match_id, player_id, item_name, purchased_at)`. Index `(match_id, purchased_at)`.

#### `match_events`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `match_id` | uuid | FK → matches (CASCADE) |
| `team_id` | uuid, nullable | FK → teams (RESTRICT) |
| `player_id` | uuid, nullable | FK → players (RESTRICT) |
| `event_type` | text | free-form (`kill`, `tower`, `lord`, ...) |
| `title` | text | display text |
| `details` | jsonb, default `{}` | opaque |
| `occurred_at` | timestamptz, default now() | |

No unique constraint (duplicates tolerated on retry). Index `(match_id, occurred_at)`.

#### `match_broadcasts`

Language broadcast variants of a live match (approved contract change: FE needs per-language feeds — MPL ID `id`+`en`, MPL PH `tl`+`en`, MPL MY `ms`+`en`, ... — rendered as distinct list entries).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `match_id` | uuid | FK → matches (CASCADE) |
| `language` | enum `broadcast_language` | `en \| id \| ms \| tl` (ISO 639-1) |
| `stream_url` | text | https only (validated at API) |
| `viewer_count` | int, default 0 | per-variant viewers, informational |
| `created_at` / `updated_at` | timestamptz | |

Unique `(match_id, language)` (one feed per language per match). Replace-only via `PUT /admin/matches/:id/broadcasts`; embedded as `broadcasts` (ordered `viewer_count` desc) in every `MatchSummary`/`MatchDetail` where `status = "live"`, plus `GET /matches/:id/broadcasts`. `matches.viewer_count` remains the aggregate ranking number.

### 6.2 Deliberately NOT modeled

- `standings` table — computed from completed matches.
- `bracket`/`stages` table — stages are an enum + grouping on matches.
- `games` table (per-game rows within a Bo3/Bo5) — MVP keeps a single match row; per-game detail lives in statistics `details` JSONB if ever needed.
- `viewer_events` — viewer counts are a stored snapshot updated via admin API.
- Gold history IS modeled via `match_gold_snapshots` (streaming-page economy chart requirement; approved contract change). Gold timeseries was previously listed as not modeled.

## 7. Authentication

1. Client obtains a Supabase session (cookie-based) and calls the API with `Authorization: Bearer <access_token>`.
2. Global `JwtAuthGuard`:
   - `@Public()` routes skip verification.
   - Otherwise: fetch JWKS from `SUPABASE_JWKS_URL` (cached, refresh on unknown `kid`), verify RS256 signature, issuer and audience, check `exp`.
   - Extract `sub` → `req.user`.
3. Lazy profile: on any authenticated request, ensure a `profiles` row exists for `sub` (idempotent upsert, role `user`). Admin seeding happens through the seed script, which also creates the corresponding Supabase Auth user.
4. Failures → `401 AUTHENTICATION_REQUIRED` per contract.
5. The server never issues, refreshes, or stores tokens. No sessions table of its own.

## 8. Authorization

- Authentication ≠ authorization. A valid JWT grants nothing beyond `user` tier.
- `RolesGuard` reads `profiles.role` (DB lookup per request — correctness over micro-optimization; single indexed PK lookup).
- `@Roles('admin')` on every `/admin/*` route.
- `/me/*` endpoints derive the user id exclusively from the verified JWT `sub` (never from params/body) — cross-user access is structurally impossible.
- Failures → `403 FORBIDDEN`.

## 9. RLS strategy

RLS is **defense-in-depth**, not the primary authorization layer. Primary authorization is application-level (§8) because all data access goes through NestJS.

Policy per migration:

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on every `public` table.
- No policies granting anything to `anon` or `authenticated` (deny-by-default). Do **not** publish GRANTs to those roles for `public` tables.
- `service_role` bypasses RLS automatically (Supabase built-in) — this is the role Prisma connects with.
- Consequence: Supabase PostgREST/Data API returns nothing useful to any client; the NestJS API is the only data path.

This satisfies the security posture with minimal policy code: no per-row policies to maintain, no drift risk.

## 10. Domain modules and responsibilities

| Module | Responsibilities |
| --- | --- |
| `Tournaments` | CRUD-read, schedule grouping, standings computation (wins/win_rate/tiebreak), teams-in-tournament, results, stages rollup |
| `Teams` | Read, detail with aggregate stats + form (last 5 outcomes) + live/next match, roster by role order, per-tournament stats |
| `Players` | Read, detail aggregates (avg K/D/A, MVP count, win rate), match list via statistics, per-hero stats |
| `Matches` | List/filter/sort, live/upcoming/featured selection, detail, statistics read, roster read, head-to-head history, related computation, gold economy history read, live-stats/equipment/events reads |
| `Videos` | List/filter |
| `Search` | Cross-entity ILIKE search with type filter and relevance ordering (exact slug > prefix > substring) |
| `Home` | Aggregated homepage payload; optional-auth continue-watching |
| `Users` | `/me`, lazy profile creation |
| `Favorites` | Add/remove/list favorites for teams+players (existence checks, idempotency) |
| `History` | Watch-history upsert/delete/list with match joins |
| `Admin` | Full ingestion CRUD for all entities, live-state updates, statistics bulk upsert, gold economy snapshot appends, live-stats/equipment/events appends, deletion protection, slug conflict handling |

Business rules (contract §8) live in these services, notably:

- Match state machine validation in `Matches`/`Admin` services (shared private validator).
- Completed-match score/winner consistency.
- Standings tiebreak: wins desc → win_rate desc → name asc.
- Deletion protection (teams/tournaments with matches → 422).

## 11. API implementation notes

- All endpoints implement `docs/API-CONTRACT.md` §6 exactly (paths, params, shapes, status codes).
- Controllers use DTOs for params/query/body; services return typed response objects (hand-rolled interfaces matching the contract, derived from Prisma types where practical).
- The `meta` envelope is built by a small shared helper (pagination + total count via Prisma `count` in the same round trip pattern).
- `/home` executes its section queries in parallel (`Promise.all`) — one endpoint, bounded payloads.
- Keep SQL simple: Prisma queries + a few raw computed aggregations (`groupBy`); no stored procedures, no views in MVP.

## 12. Validation

- Global `ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false })`; unknown fields stripped.
- DTOs:
  - Path params: `ParseUUIDPipe`-equivalent DTOs (400 on malformed UUIDs).
  - Query params: pagination + filter + sort DTOs with `@IsEnum`, `@IsISO8601`, `@IsInt`, `@Min/@Max`, `@IsOptional`.
  - Bodies: per-endpoint DTOs with explicit validators (`@IsUrl`, hex color regex for `color_*`, slug regex, score ≥ 0, `best_of ≥ 1`).
- `entityType` path param validated against `team|player` before any DB access.
- Admin statistics body validated for team membership against the match (422 when a stats team is not A/B).
- External data treated as untrusted: JWT claims validated (`sub` present); Supabase JWKS responses parsed defensively (optional chaining on all external payloads).

## 13. Transactions

| Workflow | Transaction | Reason |
| --- | --- | --- |
| `PUT /admin/matches/:id/statistics` | yes — replace `match_team_statistics` + `player_match_statistics` rows for the match | multi-row upsert must be atomic |
| Match completion (`status → completed` via live endpoint) | yes — status/score/winner update + optional stats write | related writes must succeed or fail together |
| Entity create with slug | no (single insert) | — |
| Economy snapshot append | no (single `createMany skipDuplicates`, idempotent) | duplicates ignored via unique key |
| Live-stats / equipment appends | no (per-key upserts / skipDuplicates, idempotent) | duplicates ignored via unique keys |
| Events append | no (single insert) | no unique constraint; duplicates tolerated |
| Favorites / watch history | no (single-row upsert/delete, idempotent) | — |
| Match delete cascading stats | relies on FK `ON DELETE CASCADE` (no explicit tx) | single delete statement |
| Lazy profile creation | no (idempotent single upsert) | — |

Idempotency notes: favorites `PUT` and history `PUT` are natural upserts (unique keys); statistics `PUT` replaces per unique key; slug conflicts return 409 (client re-picks slug). All are safe to retry.

Use Prisma interactive transactions (`prisma.$transaction`) — no distributed transactions, single database.

## 14. Integrations

| Integration | Type | Usage |
| --- | --- | --- |
| Supabase Auth (JWKS) | external HTTP | JWT verification; cached JWKS; graceful 503-ish failure → 401 for requests, log server-side |
| Supabase PostgreSQL | database | Prisma connection (pooler URL) |
| Video/stream providers | none at runtime | `stream_url`/`url` are external URLs consumed by the client player; server never proxies or transcodes |

No payment, email, or analytics integrations in MVP.

## 15. Caching

Redis is intentionally not required for the current architecture.

- Dataset is small-to-medium; reads are indexed; Postgres handles the load.
- No server-side cache. No cache keys, TTLs, or invalidation strategy needed.
- Client-side freshness for live pages is polling (30s), per contract §11.
- If live-endpoint load ever becomes a problem, the first mitigation is a short-TTL in-memory cache on `/matches/live` (documented here as a future option, NOT implemented now).

## 16. Error handling

- One global `HttpExceptionFilter` producing the contract error shape:

```json
{ "error": { "code": "...", "message": "...", "details": null } }
```

- Mapping:
  - `BadRequestException`/validation → `400 VALIDATION_ERROR` (details array for class-validator).
  - JWT guard failures → `401 AUTHENTICATION_REQUIRED`.
  - Roles guard failures → `403 FORBIDDEN`.
  - `NotFoundException` → `404 NOT_FOUND`.
  - Prisma `P2002` (unique) → `409 CONFLICT`.
  - Business rule violations → dedicated `BusinessRuleException` → `422 UNPROCESSABLE`.
  - `ThrottlerException` → `429 RATE_LIMITED` + `Retry-After`.
  - Anything else → `500 INTERNAL_ERROR`, generic message, full details logged server-side.
- Never leak stack traces, SQL, or env values. Log `code` + request id (attach a per-request id header via middleware).

## 17. Observability

- Structured logs via NestJS logger: request id, route, user id (when authenticated), status code, duration; error logs include stack internally only.
- `/health` (terminus): DB connectivity + uptime → `{ "status": "ok" }`.
- No APM/OpenTelemetry in MVP.

## 18. Testing

Priority on behavior, not coverage percentages:

| Layer | Tool | What |
| --- | --- | --- |
| Unit | Jest | standings computation (tiebreaks), form/win-rate aggregates, match state machine validator, related-matches selection, search relevance ordering |
| Guard unit | Jest | JWT guard: valid token, expired, bad signature, missing header; roles guard |
| Service integration | Jest + real local Postgres (`supabase start`) | favorites idempotency + existence checks, history upsert, admin statistics upsert atomicity, deletion protection |
| e2e | Nest `supertest` + local Postgres | contract conformance for every endpoint group: public catalog (filters/pagination/sorting), auth 401/403 paths, admin ingestion incl. state machine and slug 409s, error shape assertions |

Critical workflow tests (must pass before "done"):
1. Admin creates tournament + 2 teams + match → public lists show it → `PUT live` with viewer_count → `/matches/live` returns it → `completed` with scores → standings reflect the win.
2. User session: favorites add (twice = same row), remove (idempotent), watch history upsert, `/me` profile lazy creation.
3. Anonymous access to `/admin/*` → 403; anonymous catalog reads → 200.

## 19. Migrations

- Tool: `prisma migrate dev` (local) / `prisma migrate deploy` (CI/cloud). Migration SQL files are committed.
- Every migration: `ENABLE ROW LEVEL SECURITY` + no anon/authenticated grants (§9). This is a checklist item in code review, since `prisma migrate dev` generates the DDL.
- Seed data: `prisma/seed.ts` (idempotent upserts): 2–3 tournaments, 8–10 teams, ~40 players, ~60 matches across statuses, statistics for completed matches, ~20 videos, 1 admin user (Supabase Auth admin user created via the local/cloud Auth API during seed — documented in README).
- Env switch: `DATABASE_URL` local (port 54322) vs cloud pooler.

## 20. Environment configuration

`.env` (gitignored) — validated at boot, fail fast:

```text
PORT=3001
DATABASE_URL=postgresql://postgres.qshjcszsvsgwpcgggkiv:...@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres
SUPABASE_JWKS_URL=https://qshjcszsvsgwpcgggkiv.supabase.co/auth/v1/.well-known/jwks.json
CORS_ORIGINS=http://localhost:3000
```

`.env.example` committed with placeholders. **Security action item:** the current `.env` contains a live Supabase secret key on disk — rotate the key, remove `SUPABASE_SECRET_KEY` from the file, ensure `.gitignore` covers `.env`. Server DB access uses `DATABASE_URL` only.

## 21. Security review checklist

- [x] Supabase secret key never shipped to client; rotate existing key.
- [x] JWT verified (RS256/JWKS), expiry enforced.
- [x] Authorization separate from authentication (roles guard).
- [x] RLS deny-by-default as defense-in-depth.
- [x] Input validation on all boundaries (DTOs, whitelist, enums).
- [x] SQL injection: Prisma parameterization everywhere; no raw string interpolation.
- [x] Error responses leak nothing (no stacks/SQL).
- [x] CORS allowlist via `CORS_ORIGINS`.
- [x] Helmet headers.
- [x] Rate limiting on writes + authenticated endpoints.
- [x] Slug/URL fields validated; `stream_url`/`url` validated with `@IsUrl` (https-only) to prevent `javascript:` URIs reaching the client player.
- [x] Secrets in env, validated at boot, never logged.
- [ ] (Post-MVP, if needed) admin audit log table for ingestion actions.

## 22. File-level changes

Repository: `thumbz-server`

| File/directory | Responsibility | Change | Depends on | Reason |
| --- | --- | --- | --- | --- |
| `package.json`, `tsconfig.json`, `nest-cli.json`, `eslint`, `jest` config | NestJS project scaffold | Create (Nest CLI) | — | Greenfield |
| `.env.example`, `.gitignore` | env template + secret hygiene | Create | — | Current `.env` holds live secrets unignored |
| `src/main.ts` | bootstrap: helmet, CORS, pipes, filter, throttler, global guard, version prefix | Create | common infra | Contract conformance |
| `src/app.module.ts` | module wiring | Create | all modules | |
| `src/config/configuration.ts` | env load + validation (fail fast) | Create | `.env.example` | Boot safety |
| `src/prisma/prisma.module.ts`, `prisma.service.ts` | global DB access | Create | env | Single DB client |
| `prisma/schema.prisma` | all 10 tables, enums, relations, indexes (§6) | Create | — | Domain persistence |
| `prisma/migrations/*` | DDL + RLS statements | Create via migrate dev, then append RLS SQL | schema | DB structure + §9 |
| `prisma/seed.ts` | idempotent demo data + admin user | Create | schema | Demo/dev data (admin API + seed chosen) |
| `src/common/**` | decorators, guards, filter, pagination/sort DTOs, slug util (§4.4) | Create | — | Shared auth/validation/error infra |
| `src/modules/auth/**` | JWKS verification guard | Create | `SUPABASE_JWKS_URL` | API auth (contract §2) |
| `src/modules/users/**` | `GET /me` + lazy profile upsert | Create | auth, profiles | Contract §6.8 |
| `src/modules/favorites/**` | favorites endpoints | Create | users, teams, players | Contract §6.8 |
| `src/modules/history/**` | watch-history endpoints | Create | users, matches | Contract §6.8 |
| `src/modules/tournaments/**` | tournament endpoints + standings computation | Create | schema | Contract §6.2 |
| `src/modules/teams/**` | team endpoints + aggregates | Create | schema | Contract §6.3 |
| `src/modules/players/**` | player endpoints + aggregates | Create | schema | Contract §6.4 |
| `src/modules/matches/**` | match endpoints + state machine + economy history | Create | schema | Contract §6.1 |
| `src/modules/videos/**` | video list | Create | schema | Contract §6.5 |
| `src/modules/search/**` | cross-entity search | Create | all catalog modules | Contract §6.7 |
| `src/modules/home/**` | home aggregation | Create | catalog modules + history | Contract §6.6 |
| `src/modules/admin/**` | ingestion CRUD + live + statistics + economy snapshots | Create | all entities, roles guard | Contract §6.9 |
| `src/modules/health/**` | `/health` | Create | terminus | Observability |
| `test/*.e2e-spec.ts` | contract e2e suites | Create | local Postgres | Testing §18 |
| `README.md` | local dev/run/seed docs | Rewrite | — | Replace one-liner |

## 23. Implementation phases

**Phase 1 — Foundation (architecture + contracts):** scaffold NestJS app, config module, `.env` hygiene (rotate key), Prisma setup + schema + first migration (RLS included), health endpoint, global error filter, throttler/helmet/CORS.

**Phase 2 — Auth foundation:** JWKS guard, roles guard, decorators, lazy profile creation, unit tests for the guard.

**Phase 3 — Catalog modules (read path):** Tournaments → Teams → Players → Matches → Videos, in that order (dependency: matches reference teams/tournaments), then Search and Home aggregation. Unit + integration tests alongside.

**Phase 4 — User features:** `/me`, favorites, history (upserts, idempotency tests).

**Phase 5 — Admin ingestion:** CRUD for all entities, live-state endpoint with state machine, statistics bulk upsert, economy snapshot append (implemented early in Phase 4/5 boundary per approved FE streaming-page requirement), deletion protection, seed script. e2e workflows.

**Phase 6 — Validation & hardening:** full contract e2e pass, error-shape audits, security checklist re-run, README.

Phase 2 may start in parallel with Phase 3 by a second agent; Phases 4 and 5 depend on 2 and 3 respectively. The API contract is frozen before Phase 3 begins.

## 24. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Server design doc duplicates client visual spec — no backend requirements of its own | Scope ambiguity | API contract is the binding spec; escalate open questions instead of inventing |
| Live Supabase secret key already on disk | Credential exposure | Rotate immediately; `.gitignore`; env-only usage |
| MLBB stats shape varies per patch | Schema churn | JSONB `details` absorbs variation; core numeric columns stay stable |
| ILIKE search on large catalogs | Slow queries | Fine at MVP scale; future: pg_trgm GIN index or full-text |
| Computed aggregates (standings, form) on large tournaments | Slow responses | MVP scale OK; future: materialized views (documented, not built) |
| Prisma + Supabase pooler quirks (prepared statements) | Runtime errors | Use pooler transaction port / `pgbouncer=true` settings; documented in README |
| No realtime — live pages poll | Stale viewer counts (≤30s) | Accepted product decision; future Supabase Realtime documented as upgrade path |

## 25. Definition of done

- [ ] NestJS app boots with validated env; `/health` returns ok.
- [ ] All `docs/API-CONTRACT.md` §6 endpoints implemented with exact paths, params, shapes and status codes.
- [ ] Global JWT guard + roles guard behave per contract §2–§3 (unit tests pass).
- [ ] Error filter emits the contract shape for all mapped failures; no stack traces leak.
- [ ] Prisma schema matches §6; migrations apply cleanly to local and cloud DB; RLS deny-by-default present on all public tables.
- [ ] Seed script produces a browsable demo dataset idempotently.
- [ ] Admin ingestion supports the full lifecycle: create → go live (viewer counts) → complete (scores) → standings reflect results.
- [ ] Favorites/watch-history idempotency verified by tests.
- [ ] Contract e2e suite green against local Postgres.
- [ ] `.env` secrets rotated; `.env` gitignored; `.env.example` committed.
- [ ] Security checklist §21 items verified.
- [ ] README documents setup, migration, seed, and test commands.
- [ ] No Redis, no realtime, no microservices, no speculative abstractions introduced.
