# 0006 — A separate worker process

**Status:** accepted (2026-10)

## Context
Jobs (expiring ticket holds, payment reconciliation, retries, reminders, the
demo simulator) must run exactly once per interval however many API
instances are deployed, and must not slow request handling.

## Decision
- `node dist/worker.js`: the same codebase and image, a Nest application
  context without HTTP. BullMQ job schedulers (idempotent upserts in Redis)
  guarantee one execution per interval across workers.
- Jobs that are worthless when late (simulator ticks, reminders) never retry;
  the rest retry with exponential backoff.
- The worker reaches browsers through the Redis emitter and invalidates
  caches directly.

## Consequences
- One more service to run (Railway: same image, different start command).
- `/api/v1/admin/jobs` and `/metrics` expose queue depth and failures.
