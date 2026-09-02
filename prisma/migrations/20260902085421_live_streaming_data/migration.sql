-- CreateEnum
CREATE TYPE "match_item_phase" AS ENUM ('phase2', 'phase3');

-- CreateTable
CREATE TABLE "player_match_snapshots" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "gold" INTEGER NOT NULL DEFAULT 0,
    "damage" INTEGER NOT NULL DEFAULT 0,
    "damage_taken" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_match_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_item_events" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "item_id" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "phase" "match_item_phase" NOT NULL,
    "slot" INTEGER,
    "purchased_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_item_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_events" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "team_id" UUID,
    "player_id" UUID,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_match_snapshots_match_id_recorded_at_idx" ON "player_match_snapshots"("match_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "player_match_snapshots_match_id_player_id_recorded_at_key" ON "player_match_snapshots"("match_id", "player_id", "recorded_at");

-- CreateIndex
CREATE INDEX "match_item_events_match_id_purchased_at_idx" ON "match_item_events"("match_id", "purchased_at");

-- CreateIndex
CREATE UNIQUE INDEX "match_item_events_match_id_player_id_item_name_purchased_at_key" ON "match_item_events"("match_id", "player_id", "item_name", "purchased_at");

-- CreateIndex
CREATE INDEX "match_events_match_id_occurred_at_idx" ON "match_events"("match_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "player_match_snapshots" ADD CONSTRAINT "player_match_snapshots_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_match_snapshots" ADD CONSTRAINT "player_match_snapshots_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_match_snapshots" ADD CONSTRAINT "player_match_snapshots_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_item_events" ADD CONSTRAINT "match_item_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_item_events" ADD CONSTRAINT "match_item_events_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_item_events" ADD CONSTRAINT "match_item_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Thumbz additions (plan §6 / §9) -------------------------------------------

-- New columns on player_match_statistics (final damage/level stats).
ALTER TABLE "player_match_statistics" ADD COLUMN "damage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "player_match_statistics" ADD COLUMN "damage_taken" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "player_match_statistics" ADD COLUMN "level" INTEGER;

-- Non-negative live-stat counters.
ALTER TABLE "player_match_snapshots" ADD CONSTRAINT "player_match_snapshots_kills_non_negative_check" CHECK ("kills" >= 0);
ALTER TABLE "player_match_snapshots" ADD CONSTRAINT "player_match_snapshots_deaths_non_negative_check" CHECK ("deaths" >= 0);
ALTER TABLE "player_match_snapshots" ADD CONSTRAINT "player_match_snapshots_assists_non_negative_check" CHECK ("assists" >= 0);
ALTER TABLE "player_match_snapshots" ADD CONSTRAINT "player_match_snapshots_gold_non_negative_check" CHECK ("gold" >= 0);
ALTER TABLE "player_match_snapshots" ADD CONSTRAINT "player_match_snapshots_damage_non_negative_check" CHECK ("damage" >= 0);
ALTER TABLE "player_match_snapshots" ADD CONSTRAINT "player_match_snapshots_damage_taken_non_negative_check" CHECK ("damage_taken" >= 0);
ALTER TABLE "player_match_snapshots" ADD CONSTRAINT "player_match_snapshots_level_non_negative_check" CHECK ("level" IS NULL OR "level" >= 0);
ALTER TABLE "player_match_statistics" ADD CONSTRAINT "player_match_statistics_damage_non_negative_check" CHECK ("damage" >= 0);
ALTER TABLE "player_match_statistics" ADD CONSTRAINT "player_match_statistics_damage_taken_non_negative_check" CHECK ("damage_taken" >= 0);
ALTER TABLE "player_match_statistics" ADD CONSTRAINT "player_match_statistics_level_non_negative_check" CHECK ("level" IS NULL OR "level" >= 0);

-- Row Level Security: deny-by-default (plan §9).
ALTER TABLE "player_match_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_item_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_events" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "player_match_snapshots" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "match_item_events" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "match_events" FROM anon, authenticated;
