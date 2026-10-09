-- Games of a series + per-game live data (contract §19).

-- CreateEnum
CREATE TYPE "game_status" AS ENUM ('live', 'completed');

-- DropIndex
DROP INDEX "match_events_match_id_occurred_at_idx";

-- DropIndex
DROP INDEX "match_gold_snapshots_match_id_recorded_at_idx";

-- DropIndex
DROP INDEX "match_item_events_match_id_purchased_at_idx";

-- DropIndex
DROP INDEX "player_match_snapshots_match_id_recorded_at_idx";

-- AlterTable
ALTER TABLE "match_events" ADD COLUMN     "game_number" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "match_gold_snapshots" ADD COLUMN     "game_number" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "match_item_events" ADD COLUMN     "game_number" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "player_match_snapshots" ADD COLUMN     "game_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "hero" TEXT;

-- CreateTable
CREATE TABLE "match_games" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "game_number" INTEGER NOT NULL,
    "status" "game_status" NOT NULL DEFAULT 'live',
    "winner_team_id" UUID,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_games_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_games_winner_team_id_idx" ON "match_games"("winner_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_games_match_id_game_number_key" ON "match_games"("match_id", "game_number");

-- CreateIndex
CREATE INDEX "match_events_match_id_game_number_occurred_at_idx" ON "match_events"("match_id", "game_number", "occurred_at");

-- CreateIndex
CREATE INDEX "match_gold_snapshots_match_id_game_number_recorded_at_idx" ON "match_gold_snapshots"("match_id", "game_number", "recorded_at");

-- CreateIndex
CREATE INDEX "match_item_events_match_id_game_number_purchased_at_idx" ON "match_item_events"("match_id", "game_number", "purchased_at");

-- CreateIndex
CREATE INDEX "player_match_snapshots_match_id_game_number_recorded_at_idx" ON "player_match_snapshots"("match_id", "game_number", "recorded_at");

-- AddForeignKey
ALTER TABLE "match_games" ADD CONSTRAINT "match_games_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_games" ADD CONSTRAINT "match_games_winner_team_id_fkey" FOREIGN KEY ("winner_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Existing live data belongs to the match's current game (else game 1).
UPDATE "match_gold_snapshots" AS t SET "game_number" = m."game_number" FROM "matches" AS m WHERE t."match_id" = m."id" AND m."game_number" IS NOT NULL;
UPDATE "player_match_snapshots" AS t SET "game_number" = m."game_number" FROM "matches" AS m WHERE t."match_id" = m."id" AND m."game_number" IS NOT NULL;
UPDATE "match_item_events" AS t SET "game_number" = m."game_number" FROM "matches" AS m WHERE t."match_id" = m."id" AND m."game_number" IS NOT NULL;
UPDATE "match_events" AS t SET "game_number" = m."game_number" FROM "matches" AS m WHERE t."match_id" = m."id" AND m."game_number" IS NOT NULL;

-- Served through the API only, like the other match tables.
ALTER TABLE "match_games" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "match_games" FROM anon, authenticated;
