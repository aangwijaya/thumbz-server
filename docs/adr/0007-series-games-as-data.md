# 0007 — Games of a series are data; the score is derived from them

**Status:** accepted (2026-10)

## Context
A match is a best-of-N series, but only the series score was stored. Live
data (gold, player snapshots, items, events) had no game, so the page could
not tell game 3 from game 1, and the frontend filled the gaps with
placeholders.

## Decision
- `match_games` holds each game (status, winner, timings). Completing a game
  recomputes `score_a/score_b` in the same transaction; only one game can be
  live.
- Live data rows carry `game_number` (backfilled from the match); reads
  default to the game being played, `?game_number=` picks another.
- Player snapshots carry the hero and a player summary so live rankings render
  before post-match statistics exist.
- `match:update` over the socket includes `game_number` and the games, so the
  series markers move the moment a game ends.

## Consequences
- The score can never disagree with the games (it is computed, not written).
- Series scored before games were tracked show finished games without
  winners until backfilled.
