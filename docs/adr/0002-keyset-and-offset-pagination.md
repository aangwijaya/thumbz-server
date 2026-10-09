# 0002 — Keyset cursors for feeds, offsets for numbered pages

**Status:** accepted (2026-10)

## Context
Lists used `page/pageSize` with a `COUNT(*)` on every request; infinite feeds
over offsets skip or repeat rows when new rows arrive, and deep offsets get
linearly slower. Numbered pages are still what people share as links.

## Decision
- `/matches`, `/videos`, `/teams`, `/players` accept an opaque `cursor`
  (base64url of `{sort value, id}`), bound to the sort it was issued for; `id`
  breaks ties, so ordering is total and stable.
- Offset paging stays for numbered UIs, capped at `page <= 500`; offset
  responses also return `next_cursor`, so a feed can render page 1 on the
  server and continue with cursors.
- Comments use a composite `(created_at, id)` cursor with `after` (deltas) and
  `before` (history).

## Consequences
- Infinite scroll costs the same at item 10 and item 10,000; no totals in
  cursor mode (`total: null`).
- Cursors are opaque: the encoding can change without breaking clients.
