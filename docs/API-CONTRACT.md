# THUMBZ API Contract

> **Single source of truth for the client/server boundary.**
>
> The client (`thumbz-next-client`, Next.js) MUST consume this contract.
> The server (`thumbz-server`, NestJS) MUST implement this contract.
>
> Neither implementation agent may modify the other repository without updating this document first.

---

## 1. API overview

THUMBZ is a Mobile Legends esports streaming and content platform. The backend exposes a read-heavy catalog API plus a small set of authenticated user features (profile, favorites, watch history) and an admin ingestion API.

| Property | Value |
| --- | --- |
| Protocol | HTTPS, JSON (`application/json`) |
| Base path | `{host}/api/v1` |
| Versioning | URL prefix. Breaking changes require `/api/v2`. Additive changes are allowed within v1. |
| Encoding | UTF-8, `snake_case` field names |
| Dates | ISO 8601 UTC strings (`2026-09-02T14:30:00Z`) |
| IDs | UUID v4 strings |
| Authentication | Supabase Auth JWT in `Authorization: Bearer <access_token>` (see §2) |
| Rate limits | Write + auth endpoints throttled (§9), counters shared across instances via Redis |
| Caching | Redis + CDN for public reads (§4.5) |

Endpoints marked **public** require no authentication. Endpoints marked **user** require a valid session. Endpoints marked **admin** require a valid session whose profile has `role = "admin"`.

The health endpoint lives outside the versioned path:

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Readiness probe (deploy health check). Returns `200 { "status": "ok" }`, `503` when a dependency is down. Public, unauthenticated, no rate limit. |
| `GET` | `/health/live` | Liveness: process is serving. Never checks dependencies. `200 { "status": "ok" }`. |
| `GET` | `/health/ready` | Readiness with per-dependency detail (Terminus format). `503` when any dependency is down. |
| `GET` | `/metrics` | Prometheus exposition. Requires `Authorization: Bearer <METRICS_TOKEN>` when the server sets one. |
| `GET` | `/docs` | Swagger UI generated from the code; raw document at `/docs/openapi.json` (also committed as `openapi.json`). |

**Request IDs.** Every response carries `x-request-id`. A well-formed inbound `x-request-id` (8–64 chars of `[A-Za-z0-9._-]`) is reused so one ID can follow a request from the client through proxies to server logs; otherwise the server mints a UUID. Quote it when reporting errors. CORS exposes `x-request-id` and `Retry-After` to browsers.

---

## 2. Authentication mechanism

- Supabase Auth is the identity provider. The Next.js client manages sessions with cookie-based Supabase sessions (`@supabase/ssr`) and never talks to the NestJS API for sign-in/sign-up/refresh.
- The client sends the Supabase **access token** to the NestJS API as `Authorization: Bearer <token>`.
- NestJS verifies the token signature (RS256) against the Supabase JWKS endpoint (`SUPABASE_JWKS_URL`) and extracts the `sub` claim as the user ID. No local session store is needed.
- Token expiry: 1 hour (Supabase default, `jwt_expiry = 3600`). The client refreshes via Supabase session management; the API does not issue or refresh tokens.
- Expired/invalid tokens → `401 AUTHENTICATION_REQUIRED`.
- On first authenticated request for a user without a `profiles` row, the server creates the profile lazily (idempotent upsert, default role `user`).

### Auth endpoints (handled by Supabase, not NestJS)

Sign-up, sign-in, sign-out, token refresh, password reset are Supabase Auth operations performed directly by the client against the Supabase Auth API. They are **not** part of this contract.

---

## 3. Authorization model

Three effective roles:

| Role | Meaning | Source |
| --- | --- | --- |
| `anonymous` | No valid token | Absence of token |
| `user` | Valid Supabase session | JWT `sub` + `profiles.role = 'user'` |
| `admin` | Valid session + admin profile | JWT `sub` + `profiles.role = 'admin'` |

- Authentication (`who`) is decided by the JWT. Authorization (`what`) is decided by `profiles.role` and by endpoint rules.
- A valid session does NOT grant access to `/api/v1/admin/*`. Only `role = "admin"` does.
- User-owned resources (`/me/*`) are scoped to the authenticated user's own `sub`; there is no way to address another user's data through the API.
- Failed authorization → `403 FORBIDDEN` (valid session, insufficient role).

---

## 4. Base API conventions

### 4.1 Pagination

All list endpoints support offset paging:

| Param | Type | Default | Constraint |
| --- | --- | --- | --- |
| `page` | integer | `1` | `1..500` (deep offsets get slower; page further with `cursor`) |
| `pageSize` | integer | `20` | `1..50` |

`/matches`, `/videos`, `/teams` and `/players` also support **keyset paging** for infinite scroll:

| Param | Type | Notes |
| --- | --- | --- |
| `cursor` | string | opaque; pass back `meta.next_cursor`. When present, `page` is ignored and no total is computed. A cursor is bound to the `sort`/`order` it was issued for; reusing it with another ordering → `400 VALIDATION_ERROR` (`field: "cursor"`). |

Response envelope:

```json
{
  "data": [ ... ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 137,
    "totalPages": 7,
    "next_cursor": "eyJmIjoi… | null",
    "has_more": true
  }
}
```

- Offset responses also carry `next_cursor`, so a client can render page 1 normally and continue with cursors.
- In cursor mode `page`, `total` and `totalPages` are `null`.
- Ordering is always deterministic: the sort key, then `id` as a tie-breaker.

### 4.2 Filtering

Filtering uses query parameters (whitelisted per endpoint, see §6). Unknown query parameters are ignored. Invalid values (e.g. unknown enum) → `400 VALIDATION_ERROR`.

### 4.3 Sorting

`sort` and `order` query parameters, whitelisted per endpoint:

| Param | Value |
| --- | --- |
| `sort` | one of the allowed sort keys for the endpoint |
| `order` | `asc` (default) or `desc` |

Unknown sort key → `400 VALIDATION_ERROR`.

### 4.5 Caching

Public reads are cached server-side (Redis) and are CDN-cacheable; everything else is not.

| Response | `Cache-Control` | Notes |
| --- | --- | --- |
| Public catalog/match reads | `public, max-age=0, s-maxage=<ttl>, stale-while-revalidate=<2×ttl>` | `Vary: Authorization`. TTLs: live sub-resources 3 s, ticket availability 5 s, live lists/match detail 10 s, lists 30 s, catalog 60 s. |
| `GET /home` with a valid token | `private, no-store` | Per-user server cache entry; anonymous callers share one entry. |
| `/me/*`, writes, admin, webhooks | `no-store` | Never cached. |

- `X-Cache: HIT | MISS | BYPASS` reports the server cache outcome (`BYPASS` when Redis is unavailable — the API keeps serving from the database).
- Writes invalidate affected entries immediately (tag-based, driven by domain events); TTLs bound staleness for anything else (e.g. player statistics after a score update, ≤ 60 s).
- Express weak `ETag`s are emitted; `If-None-Match` revalidation returns `304`.
- When `REVALIDATE_SECRET` is configured, the server calls `POST {FRONTEND_URL}/api/revalidate` with `{ "tags": [...] }` (coalesced per 500 ms) so the frontend's data cache refreshes on change.

### 4.4 Search

`GET /api/v1/search` is the only full-text-style endpoint (see §6.8). It is separate from list filtering; list endpoints use exact-match filters.

---

## 5. Endpoint inventory

### 5.1 Matches

| Method | URL | Access |
| --- | --- | --- |
| `GET` | `/matches` | public |
| `GET` | `/matches/live` | public |
| `GET` | `/matches/upcoming` | public |
| `GET` | `/matches/featured` | public |
| `GET` | `/matches/:id` | public |
| `GET` | `/matches/:id/statistics` | public |
| `GET` | `/matches/:id/roster` | public |
| `GET` | `/matches/:id/history` | public |
| `GET` | `/matches/:id/related` | public |
| `GET` | `/matches/:id/economy` | public |
| `GET` | `/matches/:id/live-stats` | public |
| `GET` | `/matches/:id/equipment` | public |
| `GET` | `/matches/:id/events` | public |
| `GET` | `/matches/:id/broadcasts` | public |
| `GET` | `/matches/:id/comments` | public |
| `POST` | `/matches/:id/comments` | user |
| `GET` | `/matches/:id/ticket` | public |
| `POST` | `/matches/:id/orders` | user |

### 5.2 Tournaments

| Method | URL | Access |
| --- | --- | --- |
| `GET` | `/tournaments` | public |
| `GET` | `/tournaments/:id` | public |
| `GET` | `/tournaments/:id/schedule` | public |
| `GET` | `/tournaments/:id/standings` | public |
| `GET` | `/tournaments/:id/teams` | public |
| `GET` | `/tournaments/:id/results` | public |
| `GET` | `/tournaments/:id/stages` | public |

### 5.3 Teams

| Method | URL | Access |
| --- | --- | --- |
| `GET` | `/teams` | public |
| `GET` | `/teams/:id` | public |
| `GET` | `/teams/:id/matches` | public |
| `GET` | `/teams/:id/statistics` | public |
| `GET` | `/teams/:id/roster` | public |

### 5.4 Players

| Method | URL | Access |
| --- | --- | --- |
| `GET` | `/players` | public |
| `GET` | `/players/:id` | public |
| `GET` | `/players/:id/matches` | public |
| `GET` | `/players/:id/statistics` | public |

### 5.5 Videos

| Method | URL | Access |
| --- | --- | --- |
| `GET` | `/videos` | public |

### 5.6 Aggregation

| Method | URL | Access |
| --- | --- | --- |
| `GET` | `/home` | public (optional auth) |
| `GET` | `/search` | public |

### 5.7 Me (authenticated user)

| Method | URL | Access |
| --- | --- | --- |
| `GET` | `/me` | user |
| `GET` | `/me/favorites` | user |
| `PUT` | `/me/favorites/:entityType/:entityId` | user |
| `DELETE` | `/me/favorites/:entityType/:entityId` | user |
| `GET` | `/me/history` | user |
| `PUT` | `/me/history/:matchId` | user |
| `DELETE` | `/me/history/:matchId` | user |
| `DELETE` | `/me/comments/:id` | user |
| `GET` | `/me/orders` | user |
| `GET` | `/me/orders/:id` | user |
| `POST` | `/me/orders/:id/cancel` | user |
| `GET` | `/me/tickets` | user |

### 5.8 Admin (ingestion)

| Method | URL | Access |
| --- | --- | --- |
| `POST` | `/admin/tournaments` | admin |
| `PATCH` | `/admin/tournaments/:id` | admin |
| `DELETE` | `/admin/tournaments/:id` | admin |
| `POST` | `/admin/teams` | admin |
| `PATCH` | `/admin/teams/:id` | admin |
| `DELETE` | `/admin/teams/:id` | admin |
| `POST` | `/admin/players` | admin |
| `PATCH` | `/admin/players/:id` | admin |
| `DELETE` | `/admin/players/:id` | admin |
| `POST` | `/admin/matches` | admin |
| `PATCH` | `/admin/matches/:id` | admin |
| `DELETE` | `/admin/matches/:id` | admin |
| `PUT` | `/admin/matches/:id/live` | admin |
| `PUT` | `/admin/matches/:id/statistics` | admin |
| `PUT` | `/admin/matches/:id/economy` | admin |
| `PUT` | `/admin/matches/:id/live-stats` | admin |
| `PUT` | `/admin/matches/:id/equipment` | admin |
| `PUT` | `/admin/matches/:id/events` | admin |
| `PUT` | `/admin/matches/:id/broadcasts` | admin |
| `DELETE` | `/admin/comments/:id` | admin |
| `PUT` | `/admin/matches/:id/ticket-config` | admin |
| `GET` | `/admin/orders` | admin |
| `POST` | `/admin/videos` | admin |
| `PATCH` | `/admin/videos/:id` | admin |
| `DELETE` | `/admin/videos/:id` | admin |

---

### 5.9 Webhooks

| Method | URL | Access |
| --- | --- | --- |
| `POST` | `/webhooks/nowpayments` | public (signature-verified) |

## 6. Endpoint details

### 6.1 Matches

#### `GET /matches`

**Purpose:** paginated match schedule/results list.

**Query params:**

| Param | Type | Notes |
| --- | --- | --- |
| `status` | `scheduled\|live\|completed\|cancelled\|postponed` | optional |
| `tournament_id` | uuid | optional |
| `team_id` | uuid | optional; matches where the team is A or B |
| `from` | ISO date | optional; `scheduled_at >= from` |
| `to` | ISO date | optional; `scheduled_at <= to` |
| `featured` | `true\|false` | optional |
| `page`, `pageSize` | — | §4.1 |
| `sort` | `scheduled_at` (default) \| `viewer_count` | |
| `order` | `asc` (default) \| `desc` | |

**Response:** `{ "data": [MatchSummary], "meta": {...} }`

```json
{
  "id": "uuid",
  "tournament_id": "uuid | null",
  "tournament": { "id": "uuid", "name": "MPL ID S16", "slug": "mpl-id-s16" } ,
  "stage": "regular_season | group_stage | playoffs | semifinal | grand_final | third_place | null",
  "round": 1,
  "group_name": "A | null",
  "best_of": 3,
  "game_number": null,
  "team_a": { "id": "uuid", "name": "ONIC", "slug": "onic", "logo_url": "https://...", "color_primary": "#FFD700" },
  "team_b": { "id": "uuid", "name": "RRQ", "slug": "rrq", "logo_url": "https://...", "color_primary": "#7B2EFF" },
  "score_a": 2,
  "score_b": 1,
  "winner_team_id": "uuid | null",
  "status": "scheduled | live | completed | cancelled | postponed",
  "scheduled_at": "2026-09-05T12:00:00Z",
  "started_at": "2026-09-05T12:10:00Z | null",
  "ended_at": "2026-09-05T13:40:00Z | null",
  "thumbnail_url": "https://... | null",
  "viewer_count": 24812,
  "featured": false,
  "stream_delay_seconds": 30,
  "broadcasts": [
    { "language": "id", "stream_url": "https://...", "viewer_count": 15200 }
  ]
}
```

`MatchSummary` omits `stream_url` (see MatchDetail). `viewer_count` is only meaningful when `status = "live"`; clients must ignore it otherwise.

`stream_delay_seconds` (default `30`, admin-adjustable 0..600) is how far behind the live stream the broadcast is: clients rendering live Match-center data (economy/events/comments) must hide anything newer than `now − stream_delay_seconds` to avoid spoilers.

**Language broadcast variants (live matches only).** A live match may be broadcast in several languages at once (e.g. MPL ID: `id` + `en`; MPL PH: `tl` + `en`). Every response that embeds a `MatchSummary`/`MatchDetail` (list, live, featured, home, detail, schedule, results, ...) therefore also includes a `broadcasts` array:

```json
"broadcasts": [
  { "language": "en", "stream_url": "https://...", "viewer_count": 9612 },
  { "language": "id", "stream_url": "https://...", "viewer_count": 15200 }
]
```

- `language` ∈ `en | id | ms | tl` (ISO 639-1 codes; `tl` = Tagalog).
- Only present/meaningful when `status = "live"`. For non-live matches the server sends `"broadcasts": []`.
- `broadcasts` is ordered by `viewer_count` desc.
- The card-level `stream_url` on `MatchDetail` remains the primary feed (highest-`viewer_count` variant) and `viewer_count` on the match remains the aggregate count used for ranking; per-variant counts in `broadcasts` are informational. Clients that only render one feed keep working unchanged.
- Live pages must render each variant as a separate, meaningful entry (e.g. "Same Match — Bahasa Indonesia" / "Same Match — English"), never duplicate the same card twice for one language.

#### `GET /matches/live`

**Purpose:** all currently live matches (Live page, homepage "Live now").

**Query params:** `page`, `pageSize`; `sort = viewer_count`, `order = desc` fixed.

**Response:** `{ "data": [MatchSummary], "meta": {...} }` — matches with `status = "live"`, ordered by `viewer_count` desc, `started_at` asc tiebreak.

#### `GET /matches/upcoming`

**Purpose:** next scheduled matches (homepage "Upcoming matches", schedule sections).

**Query params:** `page`, `pageSize`; `from` (default: now); fixed `sort = scheduled_at`, `order = asc`; optionally `tournament_id`.

**Response:** `{ "data": [MatchSummary], "meta": {...} }` — matches with `status = "scheduled"` and `scheduled_at >= from`.

#### `GET /matches/featured`

**Purpose:** the featured live match for the homepage hero.

**Response:** `200` with `{ "data": MatchDetail | null }`. Returns the live match with `featured = true` (most recently `started_at` if several). `null` when no featured live match exists — **not** a 404.

#### `GET /matches/:id`

**Purpose:** match detail (Match Header, video player context, related navigation).

**Response:** `{ "data": MatchDetail }` — `MatchSummary` plus:

```json
{
  "stream_url": "https://... | null",
  "tournament": { "id", "name", "slug", "status", "region" },
  "team_a": { ...TeamSummary, "region": "ID" },
  "team_b": { ...TeamSummary, "region": "ID" }
}
```

**Errors:** `404 NOT_FOUND` when the match does not exist.

#### `GET /matches/:id/statistics`

**Purpose:** match statistics tab (team + player performance).

**Response:** `{ "data": MatchStatistics }`

```json
{
  "match_id": "uuid",
  "teams": [
    {
      "team_id": "uuid",
      "team": { "id": "uuid", "name": "ONIC", "slug": "onic", "logo_url": "...", "color_primary": "#FFD700" },
      "kills": 12,
      "deaths": 8,
      "assists": 24,
      "gold": 45000,
      "towers_destroyed": 7,
      "game_duration_seconds": 1180,
      "details": {}
    }
  ],
  "players": [
    {
      "player_id": "uuid",
      "player": { "id": "uuid", "nickname": "Kairi", "slug": "kairi", "role": "jungle", "photo_url": "..." },
      "team_id": "uuid",
      "kills": 6,
      "deaths": 1,
      "assists": 7,
      "gold": 9800,
      "damage": 45000,
      "damage_taken": 12000,
      "level": 12,
      "hero_picked": "Ling",
      "mvp": true,
      "details": {}
    }
  ]
}
```

`details` is an opaque JSON object for game-specific data (hero picks/bans, objectives). The client renders it defensively (optional chaining); it may be absent or partial. Empty arrays when no statistics exist for the match.

#### `GET /matches/:id/roster`

**Purpose:** roster tab — the players who participated in this match.

**Response:** `{ "data": [PlayerSummary] }` — derived from `player_match_statistics` rows for this match (player details joined). Empty array when no statistics exist.

#### `GET /matches/:id/history`

**Purpose:** head-to-head history between the match's two teams (design §7 "History" tab).

**Response:** `{ "data": [MatchSummary] }` — `completed` matches where the same two teams faced each other (either side), excluding the current match, sorted `ended_at` desc, at most 20. Empty array when no prior meetings.

#### `GET /matches/:id/related`

**Purpose:** related matches (same tournament, or same team pairing).

**Response:** `{ "data": [MatchSummary] }` — at most 12 matches: same `tournament_id` first (excluding self), then matches sharing team A/B; completed or live preferred; ordered `scheduled_at` desc. Empty array is valid.

#### `GET /matches/:id/economy`

**Purpose:** gold economy trend chart on the streaming page — team gold snapshots over match time.

**Query params:**

| Param | Type | Notes |
| --- | --- | --- |
| `from` | ISO datetime | optional; `recorded_at >= from` |
| `to` | ISO datetime | optional; `recorded_at <= to` |

**Response:** `{ "data": [GoldSnapshot] }` — ordered `recorded_at` asc (both teams' snapshots interleaved). Empty array when no data exists.

```json
{ "data": [ { "team_id": "uuid", "gold": 42300, "recorded_at": "2026-09-05T12:15:00Z" } ] }
```

**Errors:** `404 NOT_FOUND` when the match does not exist.

#### `GET /matches/:id/live-stats`

**Purpose:** streaming-page live rankings & head-to-head panel — per-player snapshots over match time (kills, gold, damage, damage taken, level).

**Query params:** `from`, `to` (ISO datetime, optional; `recorded_at` window).

**Response:** `{ "data": [PlayerSnapshot] }` — ordered `recorded_at` asc (all players interleaved). Empty array when no data exists.

```json
{ "data": [ { "player_id": "uuid", "team_id": "uuid", "kills": 6, "deaths": 1, "assists": 7, "gold": 9800, "damage": 45000, "damage_taken": 12000, "level": 12, "recorded_at": "2026-09-05T12:15:00Z" } ] }
```

Clients derive current rankings/latest values themselves (the endpoint is a raw, ordered series).

#### `GET /matches/:id/equipment`

**Purpose:** streaming-page equipment/build timeline — item purchases per player over match time.

**Response:** `{ "data": [ItemPurchase] }` — ordered `purchased_at` asc.

```json
{ "data": [ { "player_id": "uuid", "team_id": "uuid", "item_id": "war-axe", "item_name": "War Axe", "phase": "phase3", "slot": 2, "purchased_at": "2026-09-05T12:15:00Z" } ] }
```

`phase` ∈ `phase2 | phase3`. `slot` is nullable (position inside the phase).

#### `GET /matches/:id/events`

**Purpose:** streaming-page live events / objectives feed.

**Query params:** `from`, `to` (ISO datetime, optional; `occurred_at` window).

**Response:** `{ "data": [MatchEvent] }` — ordered `occurred_at` asc.

```json
{ "data": [ { "id": "uuid", "team_id": "uuid | null", "player_id": "uuid | null", "event_type": "lord", "title": "ONIC secured the Lord", "details": {}, "occurred_at": "2026-09-05T12:15:00Z" } ] }
```

`event_type` is a free-form string (`kill`, `tower`, `lord`, `turtle`, ...); `title` is the display text; `details` is opaque JSONB.

#### `GET /matches/:id/broadcasts`

**Purpose:** language broadcast variants of a match (watch page variant switcher, polling per-variant viewer counts).

**Response:** `{ "data": [BroadcastSummary] }` — ordered `viewer_count` desc. Empty array when the match is not live or has no variants.

```json
{ "data": [ { "language": "id", "stream_url": "https://...", "viewer_count": 15200 } ] }
```

- `language` ∈ `en | id | ms | tl`.
- At most one entry per `language` per match.
- **Errors:** `404 NOT_FOUND` when the match does not exist.

#### `GET /matches/:id/comments`

**Purpose:** live comments panel next to the stream. Public read; polling endpoint designed for small incremental fetches.

**Query params:**

| Param | Type | Notes |
| --- | --- | --- |
| `after` | cursor | optional; only newer comments — pass `meta.next_cursor` (an ISO timestamp is still accepted for older clients) |
| `before` | cursor | optional; only older comments — pass `meta.prev_cursor` (scroll-back). Not combinable with `after` |
| `limit` | int 1..50 | optional, default `30` |

**Response:** `{ "data": [MatchComment], "meta": { "next_cursor": "…", "prev_cursor": "… | null", "has_more": false, "total": 137 } }`

- `data` is always newest first.
- Cursors are opaque and encode `(created_at, id)`, so comments sharing a timestamp are never skipped.
- With `after`, the oldest `limit` newer comments are returned (still newest-first in `data`); `has_more: true` means more are waiting — fetch again immediately. A burst larger than `limit` therefore arrives over consecutive calls with nothing lost. With no news, `next_cursor` echoes the cursor you sent.
- `prev_cursor` is `null` once the start of the chat is reached.
- Live updates are also pushed over WebSocket (see realtime section); polling remains the fallback. Never poll faster than ~5 s.
- Comments are immutable; there is no edit. Deleted comments disappear from the series.
- **Errors:** `404 NOT_FOUND` when the match does not exist; `400` for an invalid cursor or `after` + `before` together.

#### `POST /matches/:id/comments`

**Purpose:** post a comment in the live panel. Requires authentication.

**Body:**

```json
{ "body": "Lord fight incoming 👀" }
```

- `body`: 1–280 characters after trimming; empty/whitespace-only → `400 VALIDATION_ERROR`; HTML is not interpreted (plain text).
- `author_name` is snapshotted server-side from the authenticated user (JWT display name, falling back to the profile username, then `User`). Clients cannot set it.
- Comments are only accepted while the match is `live` → otherwise `422 UNPROCESSABLE`.
- Rate limit: at most **one comment per user per 3 seconds** across all matches → `429 RATE_LIMITED` (in addition to the global write throttler).
- **Response:** `201 { "data": MatchComment }`.
- **Errors:** `401` unauthenticated, `404` unknown match, `422` match not live, `429` too fast.

#### `GET /matches/:id/ticket`

**Purpose:** venue ticket availability for a match (buy-tickets CTA on the match page).

**Response:** `{ "data": TicketAvailability | null }` — `null` when the match has no ticket configuration.

```json
{
  "match_id": "uuid",
  "venue_name": "GBK Basketball Hall",
  "venue_city": "Jakarta",
  "price_usd": 25.00,
  "quota_total": 5000,
  "quota_remaining": 4213,
  "sales_open_at": "2026-09-01T00:00:00Z | null",
  "sales_close_at": "2026-09-29T09:00:00Z | null",
  "on_sale": true
}
```

- `quota_remaining = quota_total − (paid tickets + non-expired pending holds)`; never negative.
- `on_sale` is true only when the config is active, the sales window is open (nullable bounds = unbounded), the match is `scheduled` or `live`, and `quota_remaining > 0`. Advisory only — the server re-checks at order time.
- **Errors:** `404 NOT_FOUND` when the match does not exist.

#### `POST /matches/:id/orders`

**Purpose:** reserve venue tickets and create a crypto payment invoice (NOWPayments hosted checkout).

**Body:**

```json
{ "quantity": 2 }
```

- `quantity` 1..4 → else `400 VALIDATION_ERROR`; at most **4 tickets per user per match** across pending + paid orders → else `422 UNPROCESSABLE`.
- Tickets are only sold while `on_sale` → else `422 UNPROCESSABLE`.
- Quota is enforced transactionally; concurrent orders cannot oversell. A `pending` order holds its tickets for **30 minutes**; once `expires_at` passes the hold is released automatically and the order reads as `expired`.
- **Response:** `201 { "data": TicketOrder }`:

```json
{
  "data": {
    "id": "uuid",
    "match_id": "uuid",
    "quantity": 2,
    "unit_price_usd": 25.00,
    "total_usd": 50.00,
    "status": "pending",
    "expires_at": "2026-09-05T12:45:00Z",
    "created_at": "2026-09-05T12:15:00Z",
    "paid_at": null,
    "payment": {
      "provider": "nowpayments",
      "invoice_url": "https://nowpayments.io/payment/?iid=...",
      "payment_id": "5123456789 | null"
    }
  }
}
```

- The client opens `payment.invoice_url`; the payer picks any coin the provider supports; the provider auto-converts to USDT (merchant-side setting). Client polls `GET /me/orders/:id` until the status leaves `pending`.
- **Errors:** `401` unauthenticated, `404` unknown match, `422` not on sale / quota exceeded / per-user limit, `503 SERVICE_UNAVAILABLE` when the payment provider is not configured.

### 6.2 Tournaments

#### `GET /tournaments`

**Query params:**

| Param | Type | Notes |
| --- | --- | --- |
| `status` | `upcoming\|ongoing\|completed` | optional |
| `region` | string | optional, exact match |
| `featured` | `true\|false` | optional |
| `page`, `pageSize` | — | |
| `sort` | `start_date` (default) \| `name` | |
| `order` | — | default `desc` for `start_date`, `asc` for `name` |

**Response:** `{ "data": [TournamentSummary], "meta": {...} }`

```json
{
  "id": "uuid",
  "slug": "mpl-id-s16",
  "name": "MPL Indonesia Season 16",
  "status": "ongoing",
  "region": "Indonesia",
  "start_date": "2026-08-01",
  "end_date": "2026-10-30",
  "prize_pool": "350000 USD | null",
  "logo_url": "https://... | null",
  "featured": false,
  "current_stage": "playoffs | null"
}
```

- `current_stage` is a computed convenience for badges ("Ongoing · Playoffs"), so clients do not need `/tournaments/:id/stages` per card. Priority: stage of a `live` match → earliest stage among `scheduled` matches → latest stage among `completed` matches → `null` when the tournament has no matches with a stage.

#### `GET /tournaments/:id`

**Response:** `{ "data": TournamentDetail }` — `TournamentSummary` plus `description`. `404` when missing.

#### `GET /tournaments/:id/schedule`

**Purpose:** tournament schedule tab — matches grouped by stage.

**Query params:** `stage`, `status`, `from`, `to`, `page`, `pageSize`.

**Response:**

```json
{
  "data": [
    { "stage": "group_stage", "matches": [MatchSummary] },
    { "stage": "playoffs", "matches": [MatchSummary] }
  ],
  "meta": { ... }
}
```

Stages ordered by tournament progression (see enum order below); stages with zero matches are omitted. Pagination counts groups.

#### `GET /tournaments/:id/standings`

**Purpose:** standings tab — computed from completed matches. **No standings table exists; this is computed on read.**

**Response:**

```json
{
  "data": {
    "tournament_id": "uuid",
    "standings": [
      { "rank": 1, "team": TeamSummary, "played": 6, "wins": 5, "losses": 1, "win_rate": 0.833 }
    ]
  }
}
```

Sorting: `wins` desc, then `win_rate` desc, then team `name` asc. Ties share the same rank (1, 1, 3...). Empty `standings` array when no completed matches.

#### `GET /tournaments/:id/teams`

**Response:** `{ "data": [TeamSummary] }` — teams participating in the tournament (via matches). Sorted by name asc.

#### `GET /tournaments/:id/results`

**Purpose:** completed matches of the tournament, newest first.

**Response:** `{ "data": [MatchSummary], "meta": {...} }` — `status = completed`, `sort = ended_at desc`. Standard pagination.

#### `GET /tournaments/:id/stages`

**Purpose:** stage navigation list.

**Response:**

```json
{
  "data": [
    { "stage": "group_stage", "match_count": 24, "completed_count": 20, "live_count": 1 },
    { "stage": "playoffs", "match_count": 8, "completed_count": 0, "live_count": 0 }
  ]
}
```

Only stages present in the tournament's matches are returned, in tournament progression order.

**Stage progression order:** `group_stage` → `regular_season` → `playoffs` → `semifinal` → `third_place` → `grand_final`.

### 6.3 Teams

#### `GET /teams`

**Query params:**

| Param | Type | Notes |
| --- | --- | --- |
| `region` | string | optional, exact match |
| `tournament_id` | uuid | optional; teams in that tournament |
| `page`, `pageSize` | — | |
| `sort` | `name` (default) \| `created_at` | |
| `order` | `asc` (default) | |

**Response:** `{ "data": [TeamSummary], "meta": {...} }`

```json
{
  "id": "uuid",
  "slug": "onic",
  "name": "ONIC Esports",
  "short_name": "ONIC | null",
  "region": "Indonesia",
  "logo_url": "https://... | null",
  "color_primary": "#FFD700 | null",
  "color_secondary": "#0A0A0A | null",
  "is_active": true
}
```

- `short_name` is an optional narrow-space label (e.g. "RRQ"); clients fall back to `name` when `null`.

#### `GET /teams/:id`

**Response:** `{ "data": TeamDetail }` — `TeamSummary` plus `description`, `founded_year`, and aggregate stats:

```json
{
  "description": "...",
  "founded_year": 2018,
  "stats": {
    "matches_played": 42,
    "matches_won": 31,
    "win_rate": 0.738,
    "current_form": ["W", "W", "L", "W", "W"]
  },
  "live_match": MatchSummary | null,
  "next_match": MatchSummary | null
}
```

`current_form` = outcome of the 5 most recent completed matches, newest last, `"W"`/`"L"` (postponed/cancelled excluded). `404` when team missing.

#### `GET /teams/:id/matches`

**Query params:** `status`, `from`, `to`, `page`, `pageSize`; `sort = scheduled_at`, `order = desc` (default).

**Response:** `{ "data": [MatchSummary], "meta": {...} }`

#### `GET /teams/:id/statistics`

**Response:** `{ "data": TeamStatistics }`

```json
{
  "team_id": "uuid",
  "matches_played": 42,
  "matches_won": 31,
  "win_rate": 0.738,
  "avg_kills": 13.2,
  "avg_deaths": 7.9,
  "avg_gold": 48750,
  "per_tournament": [
    { "tournament": { "id": "uuid", "name": "MPL ID S16", "slug": "..." }, "matches_played": 10, "wins": 8 }
  ]
}
```

Averages computed from `match_team_statistics` of completed matches. All numeric fields are nullable when no data exists (`matches_played = 0`).

#### `GET /teams/:id/roster`

**Response:** `{ "data": [PlayerSummary] }` — active players whose `team_id` matches, sorted by role order (`gold`, `mid`, `exp`, `jungle`, `roam`, `flex`, `coach`), then nickname asc.

### 6.4 Players

#### `GET /players`

**Query params:**

| Param | Type | Notes |
| --- | --- | --- |
| `team_id` | uuid | optional |
| `role` | `gold\|mid\|exp\|jungle\|roam\|flex\|coach` | optional |
| `page`, `pageSize` | — | |
| `sort` | `nickname` (default) | |
| `order` | `asc` (default) | |

**Response:** `{ "data": [PlayerSummary], "meta": {...} }`

```json
{
  "id": "uuid",
  "slug": "kairi",
  "nickname": "Kairi",
  "real_name": null,
  "role": "jungle",
  "country": "Philippines | null",
  "team_id": "uuid | null",
  "team": TeamSummary | null,
  "photo_url": "https://... | null",
  "is_active": true
}
```

#### `GET /players/:id`

**Response:** `{ "data": PlayerDetail }` — `PlayerSummary` plus:

```json
{
  "stats": {
    "matches_played": 120,
    "avg_kills": 5.8,
    "avg_deaths": 1.9,
    "avg_assists": 6.4,
    "mvp_count": 22,
    "win_rate": 0.72
  },
  "tournament_history": [
    { "tournament": TournamentSummary, "placement": "1st | null", "matches_played": 12 }
  ]
}
```

Aggregates computed from `player_match_statistics` + match outcomes. `404` when player missing.

#### `GET /players/:id/matches`

**Query params:** `status`, `page`, `pageSize`; `sort = scheduled_at desc` fixed.

**Response:** `{ "data": [MatchSummary], "meta": {...} }` — matches the player participated in (per `player_match_statistics`).

#### `GET /players/:id/statistics`

**Response:** `{ "data": PlayerStatistics }`

```json
{
  "player_id": "uuid",
  "matches_played": 120,
  "avg_kills": 5.8,
  "avg_deaths": 1.9,
  "avg_assists": 6.4,
  "avg_gold": 9100,
  "mvp_count": 22,
  "win_rate": 0.72,
  "per_hero": [
    { "hero": "Ling", "games": 18, "wins": 13, "avg_kills": 6.4 }
  ]
}
```

`per_hero` derives from `hero_picked` in `player_match_statistics`; sorted by games desc, at most 10 entries.

### 6.5 Videos

#### `GET /videos`

**Purpose:** homepage "Latest content" and future content sections.

**Query params:**

| Param | Type | Notes |
| --- | --- | --- |
| `type` | `replay\|highlight\|vod` | optional |
| `match_id` | uuid | optional |
| `page`, `pageSize` | — | |
| `sort` | `published_at` (default), `order = desc` fixed | |

**Response:** `{ "data": [VideoSummary], "meta": {...} }`

```json
{
  "id": "uuid",
  "match_id": "uuid | null",
  "title": "Grand Final — ONIC vs RRQ",
  "type": "replay",
  "url": "https://...",
  "thumbnail_url": "https://... | null",
  "duration_seconds": 7340,
  "published_at": "2026-09-01T10:00:00Z",
  "result": { "game_number": 2, "winner_team": TeamSummary }
}
```

- `result` is `null` for videos without a recorded per-game result (highlights, trailers, or replays not linked to a specific game). When present, `winner_team` is a `TeamSummary` of the game winner; clients hide it while spoiler mode is on.
- `game_number` is the game within the series (1-based) the video covers.

### 6.6 Home aggregation

#### `GET /home`

**Purpose:** single homepage payload (design §5 homepage sections). Optional auth: when a valid Bearer token is present, `continue_watching` is populated.

**Response:**

```json
{
  "data": {
    "featured_live_match": MatchDetail | null,
    "live_now": [MatchSummary],
    "upcoming": [MatchSummary & { "ticket": TicketAvailability | null }],
    "featured_tournaments": [TournamentSummary],
    "popular_teams": [TeamSummary],
    "latest_videos": [VideoSummary],
    "continue_watching": []
  }
}
```

Section limits: `live_now` ≤ 8, `upcoming` ≤ 8, `featured_tournaments` ≤ 6, `popular_teams` ≤ 8, `latest_videos` ≤ 12. `popular_teams` = teams with the most completed matches in the last 90 days. `continue_watching` is `[]` when anonymous or when the user has no history; each item is the watch-history row with its match embedded:

```json
{
  "match_id": "uuid",
  "watched_at": "2026-09-02T09:00:00Z",
  "duration_seconds": 1200,
  "total_seconds": 7340,
  "match": MatchSummary
}
```

- `total_seconds` is the total playable duration reported by the client player (`null` when unknown) — used for progress bars; `duration_seconds` remains the watched progress.

Each `upcoming` item carries its venue `ticket` availability inline (`null` when the match has no ticket config), so the homepage needs no per-match ticket calls.

### 6.7 Search

#### `GET /search`

**Purpose:** URL-driven, shareable cross-entity search (`/search?q=onic&type=team`).

**Query params:**

| Param | Type | Notes |
| --- | --- | --- |
| `q` | string | required, 1–100 chars; `400` when missing/empty |
| `type` | `all\|match\|team\|player\|tournament\|video` | default `all` |
| `page`, `pageSize` | — | applies per entity type; `pageSize` capped at 20 for search |

**Response:**

```json
{
  "data": {
    "query": "onic",
    "matches": [MatchSummary],
    "teams": [TeamSummary],
    "players": [PlayerSummary],
    "tournaments": [TournamentSummary],
    "videos": [VideoSummary]
  },
  "meta": { "page": 1, "pageSize": 20, "total": 3, "totalPages": 1 }
}
```

- `meta.counts` gives per-type totals (`{ "matches": 3, "teams": 1, ... }`) for result tabs; `meta.total` is their sum.
- Matching (Postgres): a row matches when its full-text document matches every query token as a prefix (`onic ph` → `onic:* & ph:*`), when the label contains `q` (trigram-indexed `ILIKE`), or when the label is similar to `q` (trigram similarity, tolerates typos like `onik`). Documents: teams = name + short name + slug; players = nickname + real name + slug; tournaments = name + slug; videos = title.
- Ranking: exact label/slug match, then label prefix, then `ts_rank`, then similarity; ties by label. Paging happens in SQL.
- Matches are found through matching teams (A or B) and tournaments, newest first.
- When `type` is set, only that key is populated; the others are `[]`.

#### `GET /search/suggest`

**Purpose:** typeahead for the header search box. Public, cached 60 s.

| Param | Type | Notes |
| --- | --- | --- |
| `q` | string | required, 1–100 chars |
| `limit` | int 1..10 | default `8` |

**Response:** `{ "data": [SearchSuggestion] }`, interleaving the best teams, players and tournaments:

```json
{ "type": "team | player | tournament", "id": "uuid", "slug": "onic",
  "label": "ONIC Esports", "sublabel": "Indonesia", "image_url": "https://… | null" }
```

### 6.8 Me — profile, favorites, history

#### `GET /me`

**Response:** `{ "data": UserProfile }`

```json
{
  "id": "uuid",
  "username": "agni | null",
  "avatar_url": "https://... | null",
  "role": "user | admin",
  "created_at": "2026-08-01T00:00:00Z"
}
```

#### `GET /me/favorites`

**Response:** `{ "data": Favorite[] }` — sorted by `created_at` desc.

```json
{
  "entity_type": "team | player",
  "entity_id": "uuid",
  "created_at": "2026-08-15T10:00:00Z",
  "entity": TeamSummary | PlayerSummary
}
```

#### `PUT /me/favorites/:entityType/:entityId`

**Purpose:** add a favorite. Idempotent — adding an existing favorite returns the existing row, not an error.

- `entityType` ∈ {`team`, `player`} → else `400 VALIDATION_ERROR`.
- Entity must exist → else `404 NOT_FOUND`.
- Response: `200 { "data": Favorite }` (both on create and on duplicate).

#### `DELETE /me/favorites/:entityType/:entityId`

Idempotent. `204 No Content` always (even when the favorite did not exist). `400` on invalid `entityType`.

#### `GET /me/history`

**Response:** `{ "data": [WatchHistoryItem], "meta": {...} }` — sorted `watched_at` desc.

```json
{
  "match_id": "uuid",
  "watched_at": "2026-09-02T09:00:00Z",
  "duration_seconds": 1200,
  "total_seconds": 7340,
  "match": MatchSummary
}
```

- `total_seconds` is the total playable duration reported by the client player (`null` when unknown) — used for progress bars; `duration_seconds` remains the watched progress.

#### `PUT /me/history/:matchId`

**Purpose:** record/refresh watch progress when a user opens a match. Upsert on `(user_id, match_id)`, updating `watched_at` and `duration_seconds`.

**Body (all optional):**

```json
{ "duration_seconds": 1200, "total_seconds": 7340 }
```

- `total_seconds` optional, non-negative integer; when omitted the stored value is left unchanged.
- Match must exist → else `404 NOT_FOUND`.
- Response: `200 { "data": WatchHistoryItem }`.

#### `DELETE /me/history/:matchId`

Idempotent. `204 No Content` always. `404` only if `matchId` is not a valid UUID (→ `400` instead; see §7).

#### `DELETE /me/comments/:id`

**Purpose:** delete the caller's own comment (moderation for users).

- Ownership is derived from the JWT `sub`; impossible to delete another user's comment.
- **Response:** `204` (idempotent for already-deleted own comments as well: a second call returns `204`).
- **Errors:** `404 NOT_FOUND` when the comment exists but belongs to someone else (no existence leak).

#### `GET /me/orders`

**Purpose:** the caller's ticket orders, newest first.

**Query params:** `status` (`pending|paid|cancelled|expired|failed`), `page`, `pageSize`.

**Response:** `{ "data": [TicketOrder], "meta": {...} }`.

#### `GET /me/orders/:id`

**Purpose:** single order status (polled every ~5s after the checkout opens; stop when it is no longer `pending`).

**Response:** `{ "data": TicketOrder & { "tickets": [MatchTicket] } }` — `tickets` stays empty until the order is `paid`.

**Errors:** `404 NOT_FOUND` when the order does not exist or belongs to someone else.

#### `POST /me/orders/:id/cancel`

**Purpose:** cancel a pending order and release its quota immediately.

- Only `pending` orders can be cancelled; a `paid` order → `422 UNPROCESSABLE` (crypto payments are not refunded automatically — contact support).
- Cancellation is best-effort: if the invoice is paid afterwards anyway, the payment is honoured and the tickets are still issued (the order ends as `paid`).
- **Response:** `204`.

#### `GET /me/tickets`

**Purpose:** the caller's tickets with their unique codes (QR payloads rendered in the app).

**Query params:** `match_id`, `page`, `pageSize`.

**Response:** `{ "data": [MatchTicket], "meta": {...} }`:

```json
{
  "id": "uuid",
  "match_id": "uuid",
  "order_id": "uuid",
  "code": "THMZ-7F3K-9Q2M-4XDT",
  "status": "valid",
  "issued_at": "2026-09-05T12:20:00Z",
  "match": { "id": "uuid", "tournament": { "id": "uuid", "name": "...", "slug": "..." }, "team_a": {}, "team_b": {}, "status": "live", "scheduled_at": "..." }
}
```

### 6.9 Admin — ingestion

All admin endpoints require `role = "admin"`. Request bodies use the same shapes as the public responses (minus derived fields). Creation/update bodies:

```json
// POST/PATCH /admin/tournaments
{ "slug": "mpl-id-s16", "name": "MPL Indonesia Season 16", "status": "upcoming",
  "region": "Indonesia", "start_date": "2026-08-01", "end_date": "2026-10-30",
  "prize_pool": "350000 USD", "description": "...", "logo_url": "...", "featured": false }

// POST/PATCH /admin/teams
{ "slug": "onic", "name": "ONIC Esports", "short_name": "ONIC", "region": "Indonesia",
  "logo_url": "...", "color_primary": "#FFD700", "color_secondary": null,
  "description": "...", "founded_year": 2018, "is_active": true }

// POST/PATCH /admin/players
{ "slug": "kairi", "nickname": "Kairi", "real_name": null, "role": "jungle",
  "country": "Philippines", "team_id": "uuid | null", "photo_url": "...", "is_active": true }

// POST/PATCH /admin/matches
{ "tournament_id": "uuid | null", "stage": "playoffs", "round": 1, "group_name": null,
  "best_of": 3, "game_number": null, "team_a_id": "uuid", "team_b_id": "uuid",
  "score_a": null, "score_b": null, "winner_team_id": null, "status": "scheduled",
  "scheduled_at": "2026-09-05T12:00:00Z", "started_at": null, "ended_at": null,
  "stream_url": null, "thumbnail_url": null, "viewer_count": 0, "featured": false,
  "stream_delay_seconds": 30 }

// POST/PATCH /admin/videos
{ "match_id": "uuid | null", "title": "...", "type": "replay",
  "url": "https://...", "thumbnail_url": "...", "duration_seconds": 7340,
  "game_number": 2, "winning_team_id": "uuid | null" }
```

`PATCH` is a partial update (only provided fields change). `DELETE` returns `204`. Deleting an entity with dependent rows follows these rules:

- Deleting a team with matches/players referencing it → `422 UNPROCESSABLE` (data integrity over cascade).
- Deleting a tournament with matches → `422 UNPROCESSABLE`.
- Deleting a match cascades its statistics rows.
- Video `winning_team_id` (when set) must be one of the linked match's two teams, and `match_id` must be set → else `422 UNPROCESSABLE`.

#### `PATCH /admin/matches/:id` — additive fields

The match patch body additionally accepts:

| Field | Type | Notes |
| --- | --- | --- |
| `stream_delay_seconds` | int 0..600 | broadcast delay used by spoiler-shield on live pages; default `30` |

#### `PUT /admin/matches/:id/live`

**Purpose:** the single endpoint for live-match state updates (status transitions, live scores, viewer counts). Admins call this when a match goes live, when the score changes, and periodically with fresh viewer counts.

**Body (all optional — partial updates allowed):**

```json
{
  "status": "live | completed | cancelled | postponed",
  "score_a": 2,
  "score_b": 1,
  "winner_team_id": "uuid",
  "viewer_count": 24812,
  "stream_url": "https://..."
}
```

- Status transitions validated against the state machine (§8).
- `viewer_count` only stored when `status = live` (rejected otherwise → `422`).
- Response: `200 { "data": MatchDetail }`.

#### `PUT /admin/matches/:id/statistics`

**Purpose:** bulk upsert team + player statistics for a match.

**Body:**

```json
{
  "teams": [
    { "team_id": "uuid", "kills": 12, "deaths": 8, "assists": 24, "gold": 45000,
      "towers_destroyed": 7, "game_duration_seconds": 1180, "details": {} }
  ],
  "players": [
    { "player_id": "uuid", "team_id": "uuid", "kills": 6, "deaths": 1, "assists": 7,
      "gold": 9800, "hero_picked": "Ling", "mvp": true, "details": {} }
  ]
}
```

- `team_id` values must be the match's team A/B → else `422`.
- Re-submission replaces existing rows for the same `(match_id, team_id)` / `(match_id, player_id)` (idempotent).
- Response: `200 { "data": MatchStatistics }` (the stored result).

#### `PUT /admin/matches/:id/economy`

**Purpose:** append gold economy snapshots for the streaming-page gold trend chart.

**Body:**

```json
{
  "snapshots": [
    { "team_id": "uuid", "gold": 42300, "recorded_at": "2026-09-05T12:15:00Z" }
  ]
}
```

- `recorded_at` is optional (server uses `now()`).
- `team_id` values must be the match's team A/B → else `422 UNPROCESSABLE`.
- `gold` must be a non-negative integer → else `400 VALIDATION_ERROR`.
- Snapshots are **appended**, never replaced; re-submitting the same `(match_id, team_id, recorded_at)` is ignored (idempotent).
- Response: `200 { "data": [GoldSnapshot] }` — the stored rows, ordered `recorded_at` asc.

#### `PUT /admin/matches/:id/live-stats`

**Purpose:** append per-player live snapshots (streaming-page rankings & head-to-head panel).

**Body:**

```json
{
  "snapshots": [
    { "player_id": "uuid", "team_id": "uuid", "kills": 6, "deaths": 1, "assists": 7,
      "gold": 9800, "damage": 45000, "damage_taken": 12000, "level": 12,
      "recorded_at": "2026-09-05T12:15:00Z" }
  ]
}
```

- Numeric fields default to `0` when omitted; `level` and `recorded_at` are optional (server uses `now()`).
- `team_id` values must be the match's team A/B → else `422 UNPROCESSABLE`.
- `player_id` must reference an existing player → else `404 NOT_FOUND`.
- Snapshots are **appended**, never replaced; re-submitting the same `(match_id, player_id, recorded_at)` is ignored (idempotent).
- Response: `200 { "data": [PlayerSnapshot] }` — the stored rows, ordered `recorded_at` asc.

#### `PUT /admin/matches/:id/equipment`

**Purpose:** append item purchases for the streaming-page equipment timeline.

**Body:**

```json
{
  "purchases": [
    { "player_id": "uuid", "team_id": "uuid", "item_id": "war-axe",
      "item_name": "War Axe", "phase": "phase3", "slot": 2,
      "purchased_at": "2026-09-05T12:15:00Z" }
  ]
}
```

- `slot` and `purchased_at` are optional (server uses `now()`); `phase` ∈ `phase2 | phase3`.
- `team_id` must be the match's team A/B → else `422 UNPROCESSABLE`; `player_id` must exist → else `404 NOT_FOUND`.
- Purchases are **appended**, never replaced; re-submitting the same `(match_id, player_id, item_name, purchased_at)` is ignored (idempotent).
- Response: `200 { "data": [ItemPurchase] }` — the stored rows, ordered `purchased_at` asc.

#### `PUT /admin/matches/:id/events`

**Purpose:** append events for the streaming-page events/objectives feed.

**Body:**

```json
{
  "events": [
    { "team_id": "uuid | null", "player_id": "uuid | null",
      "event_type": "lord", "title": "ONIC secured the Lord",
      "details": {}, "occurred_at": "2026-09-05T12:15:00Z" }
  ]
}
```

- `team_id` (when provided) must be the match's team A/B → else `422 UNPROCESSABLE`; `player_id` (when provided) must exist → else `404 NOT_FOUND`.
- `details` defaults to `{}`; `occurred_at` defaults to `now()`.
- Events are **appended**; there is no uniqueness constraint — retries may create duplicate events and clients must tolerate them.
- Response: `200 { "data": [MatchEvent] }` — the stored rows, ordered `occurred_at` asc.

#### `PUT /admin/matches/:id/broadcasts`

**Purpose:** set (replace) the language broadcast variants of a live match.

**Body:**

```json
{
  "broadcasts": [
    { "language": "id", "stream_url": "https://...", "viewer_count": 15200 },
    { "language": "en", "stream_url": "https://...", "viewer_count": 9612 }
  ]
}
```

- Replace semantics: the previous variant set for the match is deleted, the submitted list becomes the current set (idempotent for identical submissions).
- `language` ∈ `en | id | ms | tl`; `stream_url` must be an https URL → else `400 VALIDATION_ERROR`.
- `viewer_count` optional, non-negative integer, defaults to `0`.
- Empty `broadcasts: []` clears all variants.
- Match must exist → else `404 NOT_FOUND`. The match should be `live`; the endpoint does not enforce the state machine but variants are only served for live matches.
- Response: `200 { "data": [BroadcastSummary] }` — the stored rows, ordered `viewer_count` desc.

#### `DELETE /admin/comments/:id`

**Purpose:** moderate (delete) any live comment, regardless of author.

- **Response:** `204` (idempotent).
- **Errors:** none beyond `401`/`403`; deleting a non-existent id is also `204`.

#### `PUT /admin/matches/:id/ticket-config`

**Purpose:** create or replace the venue ticket configuration of a match.

**Body:**

```json
{
  "venue_name": "GBK Basketball Hall",
  "venue_city": "Jakarta",
  "price_usd": 25.00,
  "quota_total": 5000,
  "sales_open_at": "2026-09-01T00:00:00Z",
  "sales_close_at": "2026-09-29T09:00:00Z",
  "is_active": true
}
```

- `price_usd` > 0 with max 2 decimals; `quota_total` ≥ 1; `sales_close_at` ≥ `sales_open_at` when both are set; `venue_city` optional.
- `quota_total` cannot be lowered below the tickets already paid + active pending holds → `422 UNPROCESSABLE`.
- Match must exist → `404 NOT_FOUND`.
- Response: `200 { "data": TicketAvailability }` (stored config plus `quota_remaining`).

#### `GET /admin/orders`

**Purpose:** order monitoring for ingestion tooling.

**Query params:** `match_id`, `status` (`pending|paid|cancelled|expired|failed`), `page`, `pageSize`.

**Response:** `{ "data": [TicketOrder & { "user_id": "uuid" }], "meta": {...} }`.

### 6.10 Webhooks

#### `POST /webhooks/nowpayments`

**Purpose:** NOWPayments IPN callback. Public but signature-verified: HMAC-SHA512 over the raw JSON body using `NOWPAYMENTS_IPN_SECRET`, compared against header `x-nowpayments-sig`.

- Invalid/missing signature → `400 VALIDATION_ERROR` (no details).
- `payment_status` drives the order: `finished` / `confirmed` → order `paid` and tickets issued exactly once; `failed` / `refunded` → `failed`; `expired` → `expired`.
- Idempotent: repeated, duplicated, or out-of-order callbacks never double-issue tickets; unknown `payment_id` values are acknowledged and ignored.
- Responds `200 { "ok": true }` quickly (the provider retries non-2xx).
- **Errors:** `400` bad signature/body, `503 SERVICE_UNAVAILABLE` when the provider is not configured.

---

## 7. Request schemas and validation summary

All request bodies, path params and query params are runtime-validated by the server (`class-validator` DTOs + global `ValidationPipe` with `whitelist: true`, `transform: true`). The client must treat the backend as strict.

- Unknown body fields are stripped (whitelist).
- Malformed UUIDs → `400 VALIDATION_ERROR`.
- Out-of-range pagination (`page < 1`, `pageSize > 50`) → `400 VALIDATION_ERROR`.
- Unknown enum values → `400 VALIDATION_ERROR`.
- Validation error details list the failing fields:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [ { "field": "score_a", "message": "score_a must be a non-negative integer" } ]
  }
}
```

---

## 8. Important business rules

These rules are enforced by the server. The client must never be able to violate them through API usage.

1. **Match state machine:** `scheduled → live → completed | cancelled | postponed`. `live` may only be entered from `scheduled`. `cancelled`/`postponed` from `scheduled` or `live`. No other transitions. Admin-only. Violations → `422 UNPROCESSABLE`.
2. **Completed matches** must have `score_a`, `score_b` and `winner_team_id` set; `winner_team_id` must equal `team_a_id` or `team_b_id`, consistent with scores (higher score wins; equal scores invalid). → `422` otherwise.
3. **`team_a_id != team_b_id`** on create/update → `422`.
4. **`viewer_count`** is only stored on live matches; on transition away from live the count is retained but ignored by readers.
5. **Favorites** are limited to `team` and `player` entity types. Adding is idempotent; deleting is idempotent.
6. **Watch history** upserts per user+match; one row per user per match.
7. **Standings** are computed, never stored; only `completed` matches count; tiebreak: wins desc, win_rate desc, name asc.
8. **Slugs** (`teams.slug`, `players.slug`, `tournaments.slug`) are unique, lowercase, `[a-z0-9-]+`. Slug conflicts → `409 CONFLICT`.
9. **Ownership:** `/me/*` endpoints are always scoped to the caller's JWT `sub`. Cross-user access is impossible by design.
10. **Deletion protection:** teams/tournaments with dependent matches cannot be deleted (`422`); matches cascade-delete their statistics.
11. **Search** requires a non-empty `q`; results are limited per entity type.
12. **No speculative writes:** anonymous users cannot create anything; the only writes are `/me/*` (self) and `/admin/*` (role-gated).
13. **Live comments:** readable by anyone; writable only by authenticated users and only while the match is `live`; `body` 1–280 chars (trimmed, plain text); author name is a server-side snapshot the client cannot set; at most one comment per user per 3 seconds (`429`); authors may delete their own comments, admins may delete any.
14. **Tickets:** sold per match against a venue quota (no seat categories); quota is enforced transactionally (`quota_remaining` never negative, no oversell); pending orders hold tickets for 30 minutes then expire; max 4 tickets per order and per user per match; sales only while the match is `scheduled` or `live` and the admin-configured window is open; crypto payments via NOWPayments with merchant-side auto-conversion to USDT; tickets are codes (QR payloads) issued exactly once on a verified payment webhook; crypto payments are not auto-refunded (pending orders may be cancelled).
15. **Video results & stream delay:** a video's `winning_team_id` must reference one of the linked match's two teams (and requires `match_id`) → else `422`; `stream_delay_seconds` is 0..600 and is exposed on every match payload.
13. **Gold snapshots** are append-only per `(match_id, team_id, recorded_at)`; duplicate submissions are ignored; `gold` is non-negative.
14. **Player live snapshots** are append-only per `(match_id, player_id, recorded_at)`; **item purchases** per `(match_id, player_id, item_name, purchased_at)`; duplicate submissions are ignored. **Match events** have no uniqueness constraint — retries may duplicate them and clients must tolerate duplicates.

---

## 9. Error model

Single consistent error shape on every non-2xx response:

```json
{
  "error": {
    "code": "MACHINE_CODE",
    "message": "Human-readable, safe message",
    "details": null
  }
}
```

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Malformed body/query/path per §7, including unparseable JSON |
| 4xx | `BAD_REQUEST` | Any other client error status not listed here |
| 401 | `AUTHENTICATION_REQUIRED` | Missing, expired or invalid JWT on a protected endpoint |
| 403 | `FORBIDDEN` | Valid session but insufficient role (admin endpoints) |
| 404 | `NOT_FOUND` | Entity does not exist (or is inactive and caller is anonymous) |
| 405 | `METHOD_NOT_ALLOWED` | HTTP method not supported on the path |
| 409 | `CONFLICT` | Unique constraint violation (e.g. duplicate slug), or a delete blocked because other records reference the resource (message: "Resource is referenced by other records") |
| 413 | `PAYLOAD_TOO_LARGE` | Request body over the server limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Body is not `application/json` where JSON is required |
| 422 | `UNPROCESSABLE` | Business rule violation (§8) |
| 429 | `RATE_LIMITED` | Throttling (writes, auth'd endpoints) |
| 500 | `INTERNAL_ERROR` | Unexpected failure |
| 503 | `SERVICE_UNAVAILABLE` | Payment provider not configured or upstream unavailable |

Guarantees:

- No stack traces, SQL, secrets, or infrastructure details in error bodies.
- All unexpected exceptions collapse to `500 INTERNAL_ERROR` with a generic message and are logged server-side.
- `429` responses include a `Retry-After` header.
- Rate limits: authenticated writes and admin endpoints share a per-IP+per-user limit (implementation: `@nestjs/throttler`, generous defaults); public reads are not throttled beyond infrastructure limits.

---

## 10. Pagination, filtering, sorting — summary

| Concern | Mechanism |
| --- | --- |
| Pagination | `page`/`pageSize` + `meta` envelope (§4.1); offset-based |
| Filtering | Whitelisted exact-match query params per endpoint (§6) |
| Sorting | Whitelisted `sort`/`order` per endpoint (§4.3) |
| Search | `GET /search` with `q`/`type` (§6.7) |

---

## 11. Frontend integration requirements

The Next.js client MUST:

1. Read `NEXT_PUBLIC_API_URL` for the API base; never hardcode hosts.
2. Attach the Supabase access token as `Bearer` on `/me/*` calls; use server-side Supabase session access (`@supabase/ssr`) so tokens are never exposed to unrelated code.
3. Refresh the session through Supabase (middleware), never through the NestJS API.
4. Map every API error code to user-safe UI states (§9 codes): `AUTHENTICATION_REQUIRED` → redirect to login; `NOT_FOUND` → not-found UI; `VALIDATION_ERROR`/`CONFLICT`/`UNPROCESSABLE` → inline message; `INTERNAL_ERROR` → retryable error state.
5. Use `GET /home` for the homepage; do not fire N parallel list calls.
6. Poll live endpoints (`/matches/live`, live match detail) every 30 seconds; stop polling when the tab is hidden.
7. Keep search/filter/tab state in the URL (shareable): `/search?q=&type=`, `/matches?status=`, `/matches/[id]?tab=statistics`.
8. Record watch history with `PUT /me/history/:matchId` when a match page is opened (authenticated users only).
9. Render `details` (JSONB) fields defensively with optional chaining — they are partial/opaque.
10. Treat `viewer_count` as meaningful only for `status = "live"`.
11. Never call `/admin/*`; those endpoints are for ingestion tooling only.
12. Never embed Supabase service-role credentials or any server secrets in client code.
13. Poll `GET /matches/:id/economy` (same 30s cadence) to extend the gold economy chart. Never fabricate points; keep the last valid data while stale/reconnecting; resume from the latest valid state.
14. Poll `GET /matches/:id/live-stats`, `/matches/:id/equipment` and `/matches/:id/events` on the same cadence for the streaming page. Derive current rankings client-side from the latest snapshots; append events/purchases locally; never fabricate data.
15. Live list pages render each language broadcast variant of a match as its own meaningful entry (label: "Same Match — <Language>"); use the embedded `broadcasts` from list responses — never fan out N detail calls to discover variants. `GET /matches/:id/broadcasts` is for the watch page (variant switcher / per-variant viewer counts, same 30s cadence).
16. Poll `GET /matches/:id/comments?after=<next_cursor>` on a ~5s cadence only while the comments panel is visible (pause when hidden); prepend delta results, never refetch the whole list on each tick. Posting is optimistic-free: render the comment after `201` (or use the returned comment as the optimistic entry).
17. Ticket flow: read `GET /matches/:id/ticket` before showing the CTA; `POST /matches/:id/orders` then open `payment.invoice_url`; poll `GET /me/orders/:id` every ~5s while `pending` and stop on any terminal status; render tickets from `GET /me/tickets` (code = QR payload). Refresh availability after failures/expiry; never cache invoice URLs past `expires_at`.

---

## 12. Versioning strategy

- Current version: `v1` (`/api/v1`).
- Additive, non-breaking changes (new fields, new endpoints) ship within `v1`.
- Breaking changes (field removal/rename, semantic change, auth model change) require `/api/v2` and a deprecation window; the client plan and this contract are updated together.
- Deprecation is signaled via a `Deprecation` response header at least one release before removal.

---

## 13. Open/derived notes for implementers

- `standings`, `current_form`, `per_hero`, `per_tournament`, `related` and the `home` payload are computed read models — no dedicated tables.
- `match_gold_snapshots`, `player_match_snapshots`, `match_item_events` and `match_events` ARE stored tables (append-only live data for the streaming page: economy chart, live rankings, equipment timeline, events feed). Current totals remain in the statistics tables.
- `match_broadcasts` IS a stored table (replace-only): language broadcast variants (`en | id | ms | tl`) of a live match, unique per `(match_id, language)`, ordered for clients by `viewer_count` desc. `matches.viewer_count` stays the aggregate ranking number; per-variant counts are informational.
- `match_comments` IS a stored table (append-only): live comments per match with a server-snapshotted `author_name`; deleted rows are gone for good (no soft delete, no edit). `GET /matches/:id/comments` uses `after` + `next_cursor` for lightweight delta polling — there is no websocket/SSE transport by design.
- `tournaments.current_stage` is computed (never stored): live stage → earliest scheduled stage → latest completed stage.
- Video per-game results live on `videos.game_number` + `videos.winning_team_id` (nullable, admin-set); `stream_delay_seconds` lives on `matches` (default 30); `teams.short_name` and `watch_history.total_seconds` are nullable client/admin-provided conveniences.
- Ticketing IS stored: `match_ticket_configs` (one per match: venue, price USD, quota, sales window), `ticket_orders` (crypto checkout state, 30-minute holds), `tickets` (one row per ticket with a unique code/QR payload). Payments run through NOWPayments hosted invoices with merchant-side auto-conversion to USDT; there is no websocket/polling transport beyond `GET /me/orders/:id`.
- Match statistics `details` (JSONB) exists because Mobile Legends stats shape varies per game/patch; do not model per-hero columns relationally in MVP.
- The server may return extra fields added later; clients must ignore unknown fields (forward compatibility).
