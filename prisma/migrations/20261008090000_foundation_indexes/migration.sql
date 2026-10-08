-- Foundation hardening: index foreign keys that block deletes (ON DELETE RESTRICT
-- scans), the comment-cooldown lookup, ticket-by-order reads and video lists.

-- DropIndex
DROP INDEX "matches_tournament_id_idx";

-- CreateIndex
CREATE INDEX "matches_tournament_id_status_idx" ON "matches"("tournament_id", "status");

-- CreateIndex
CREATE INDEX "matches_winner_team_id_idx" ON "matches"("winner_team_id");

-- CreateIndex
CREATE INDEX "videos_match_id_idx" ON "videos"("match_id");

-- CreateIndex
CREATE INDEX "videos_winning_team_id_idx" ON "videos"("winning_team_id");

-- CreateIndex
CREATE INDEX "videos_published_at_idx" ON "videos"("published_at" DESC);

-- CreateIndex
CREATE INDEX "match_gold_snapshots_team_id_idx" ON "match_gold_snapshots"("team_id");

-- CreateIndex
CREATE INDEX "player_match_snapshots_player_id_idx" ON "player_match_snapshots"("player_id");

-- CreateIndex
CREATE INDEX "player_match_snapshots_team_id_idx" ON "player_match_snapshots"("team_id");

-- CreateIndex
CREATE INDEX "match_item_events_player_id_idx" ON "match_item_events"("player_id");

-- CreateIndex
CREATE INDEX "match_item_events_team_id_idx" ON "match_item_events"("team_id");

-- CreateIndex
CREATE INDEX "match_events_team_id_idx" ON "match_events"("team_id");

-- CreateIndex
CREATE INDEX "match_events_player_id_idx" ON "match_events"("player_id");

-- CreateIndex
CREATE INDEX "match_comments_user_id_created_at_idx" ON "match_comments"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tickets_order_id_idx" ON "tickets"("order_id");


-- Redundant with match_broadcasts_match_id_language_key (same leading column).
-- Created by 20260903090000 but never declared in schema.prisma (drift).
DROP INDEX IF EXISTS "match_broadcasts_match_id_idx";
