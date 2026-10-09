# 0008 — The live demo replays real recorded games

**Status:** accepted (2026-10)

## Context
The demo needs matches that are live at any hour, replays with full data and
upcoming matches that sell tickets. Random simulation produced plausible
numbers, but the heroes, builds and outcomes were invented. Real data exists
for one week of MPL Philippines (ph-mpl.com): per game, every player's hero,
K/D/A, gold, damage, build, emblem, talents and the second each item was
bought. Kill and objective times are not published.

## Decision
- A one-off, robots.txt-respecting import (`scripts/data/mpl-ph/`) turns one
  week into committed JSON (`prisma/data/`); the seed never hits the network.
  Item, emblem and talent names come from MLBB Academy reference data and are
  reviewed by hand (`catalog-review.csv`).
- Statistics are stored **per game** (unique key includes `game_number`),
  with the build and icons, so a replay shows every game of the series.
- The week's first day becomes completed replays, its middle day the live
  matches, its last day the upcoming matches (the only ones with tickets).
  Only the calendar is shifted around "now".
- The worker replays each live series from `match_game_recordings` in real
  time through the admin ingestion services: purchases at their real second;
  K/D/A, objectives and gold on a reconstructed timeline (real counts, seeded
  times, `details.reconstructed = true` on events) that ends exactly on the
  real final values; the real winner at the real duration. After a 2-minute
  break the next game starts; a decided series restarts from game 1.
- Upcoming matches about to start move one day later instead of going live.

## Consequences
- Everything the UI shows about heroes, builds and results is real; event
  times are not, and say so.
- The pure model (`src/modules/simulator/replay.ts`) is unit tested; the loop
  (game end, break, restart, calendar roll) has an e2e test with a faked clock.
- Restarting the worker resumes without duplicating events or purchases and
  back-fills the gold chart.
- A live match without a recording is left alone (admin-run matches still
  work).
