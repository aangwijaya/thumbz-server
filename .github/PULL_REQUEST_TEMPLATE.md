## What & why

<!-- The change and the problem it solves. Link the issue/task. -->

## API contract

- [ ] No API change
- [ ] Additive change, documented in `docs/API-CONTRACT.md` and `openapi.json` regenerated (`npm run openapi:export`)
- [ ] Breaking change (needs a new version — explain the migration)

## Data

- [ ] No schema change
- [ ] Migration added (`prisma/migrations/…`), safe on a live database (backfills, no long locks), RLS locked for new tables

## Checks

- [ ] `npm run lint:check && npm run typecheck`
- [ ] Unit (`npm run test:cov`) and e2e (`npm run test:e2e -- --coverage`) pass locally against the local stack — never against a shared/cloud database
- [ ] New behaviour has a test that fails without the change
- [ ] New env vars added to `.env.example`, `.env.production.example` and validated in `src/config/configuration.ts`
