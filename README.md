# thumbz-server

NestJS backend for the THUMBZ esports companion app. Serves the API contract in [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md) against a Supabase PostgreSQL database.

## Stack

- NestJS 11 (CommonJS) + TypeScript
- Prisma 6 (`@prisma/client`), schema in `prisma/schema.prisma`
- Supabase: PostgreSQL (local via `supabase start`, or cloud), JWKS-based JWT verification
- JWT auth: RS256 verified via `SUPABASE_JWKS_URL` (no client-secret key exchange)
- `helmet`, `@nestjs/throttler` (write + authenticated rate limiting), global validation

## Prerequisites

- Node 20+
- Local Supabase stack (Docker Desktop + `supabase` CLI) OR a cloud project
- `.env` copied from `.env.example` (see below)

## Setup

```bash
cp .env.example .env      # then fill in real values
npm install
```

### Database target

`DATABASE_URL` points at a Supabase Postgres. Two proven setups:

- **Cloud (production/current):** session pooler URI from the dashboard
  (Connect tab), with `?pgbouncer=true` appended. Supabase's IPv4 pooler is
  required: the direct host (`db.<ref>.supabase.co:5432`) is IPv6-only on new
  projects, and the *transaction* pooler port (`:6543`) fails Prisma's
  migration engine with `prepared statement "s1" already exists` / hangs.
  ```
  postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres?pgbouncer=true&connection_limit=4
  ```
  Do not wrap the password in `[...]` (dashboard display format) — Prisma
  sends the brackets verbatim and auth fails.
- **Local dev fallback:** `supabase start` (Docker Desktop), then
  `postgresql://postgres:postgres@127.0.0.1:44322/postgres` (ports remapped to
  4432x because the 5432x range is excluded on this Windows host).

### Env vars

| Var | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | Session-pooler URI (see above). For Vercel serverless, lower `connection_limit` (e.g. `=1`) per function instance |
| `SUPABASE_JWKS_URL` | yes | `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `CORS_ORIGINS` | yes | Comma-separated browser origins (e.g. `http://localhost:3000`) |
| `PORT` | no | API port (default `3001`) |
| `NOWPAYMENTS_API_KEY` / `NOWPAYMENTS_IPN_SECRET` | no | Enable venue-ticket crypto checkout (NOWPayments). Empty = checkout returns `503` |
| `NOWPAYMENTS_API_BASE` | no | Sandbox by default (`https://api-sandbox.nowpayments.io`) |
| `PUBLIC_API_URL` | no | Public base URL of this API, used for the provider IPN callback |

Secrets never go to the client; the API only ever receives short-lived access
tokens which it verifies against the JWKS endpoint.

## Database

```bash
npx prisma migrate deploy   # apply migrations to the target DB
npx prisma db seed          # idempotent demo dataset (cleans + recreates)
npx prisma generate         # after schema changes / fresh install
```

Migrations encode application-layer enforcement:

- Row Level Security enabled on every business table (deny-by-default, no
  direct grants to `anon`/`authenticated`) — the API uses the service role and
  enforces auth/authz itself via guards.
- Referential checks (`CHECK`), enums, and FKs live in the schema.

Seed output (browsable demo data): 3 tournaments, 14 teams, 70 players,
~98 matches (incl. 3 live with full economy/live-stats/equipment/events,
language broadcast variants, live comments, venue ticket configs and league
key-art thumbnails), 20 videos.
MPL ID runs a 9-team double round robin; MPL PH runs a 4-team round robin
(ONIC Philippines, AP.Bren, Aurora Gaming, Falcons) with real team branding
(logos served via the wsrv/imagekit image proxy). `npx prisma db seed` cleans and recreates; it never touches
user-scoped data (favorites/history) beyond cleanup of its own fixture slugs.
Optional env `SEED_ADMIN_ID` (with `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
to fetch the matching user) creates the `admin` profile; a default
fallback admin profile (fixed UUID `00000000-0000-4000-8000-000000000001`)
already exists for local dev.

## Running

```bash
npm run start:dev   # watch mode on PORT (3001)
npm start           # compiled build
```

- Public: `GET /api/v1/health`, all catalog/home/search endpoints (see API contract)
- Auth: access tokens from Supabase Auth; `Authorization: Bearer <token>`

## Admin flows (local dev)

Admin role users gate every `/admin/*` route (`@Roles('admin')`). Roles are
resolved from the JWT; admin profile rows are created lazily by profile type.

## Tests

```bash
npm run lint        # eslint (fixes in place)
npm run build       # nest build
npm test            # unit + integration specs (Prisma against local Postgres)
npm run test:e2e    # HTTP-level e2e (starts app on an ephemeral port)
```

Both suites run against the seeded local database; specs use unique slug/URL
prefixes (`e2e-*`, `https://e2e.example.com/`) and clean up after themselves,
so they are safe to run repeatedly on seeded data.

## Troubleshooting

- `DATABASE_URL` on local: use `127.0.0.1:44322`; if Supabase isn't running,
  `supabase start` first (Docker Desktop must be up).
- Port 3001 in use: change `PORT` in `.env`.
- Prepared-statement errors against Supabase pooler: connect via the
  transaction port (`:6543`) which Prisma supports without
  `pgbouncer=true` connection-options workarounds.
- `.env` is gitignored; never commit real secrets. If a key leaked, rotate it
  in Supabase immediately.
