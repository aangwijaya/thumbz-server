-- DropIndex
DROP INDEX "match_team_statistics_match_id_team_id_key";

-- DropIndex
DROP INDEX "player_match_statistics_match_id_player_id_key";

-- AlterTable
ALTER TABLE "match_item_events" ADD COLUMN     "icon_url" TEXT,
ADD COLUMN     "tier" INTEGER;

-- AlterTable
ALTER TABLE "match_team_statistics" ADD COLUMN     "game_number" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "player_match_snapshots" ADD COLUMN     "hero_icon_url" TEXT;

-- AlterTable
ALTER TABLE "player_match_statistics" ADD COLUMN     "emblem" JSONB,
ADD COLUMN     "game_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "hero_icon_url" TEXT,
ADD COLUMN     "items" JSONB,
ADD COLUMN     "talents" JSONB,
ADD COLUMN     "tower_damage" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "match_game_recordings" (
    "match_id" UUID NOT NULL,
    "game_number" INTEGER NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "winner_team_id" UUID NOT NULL,
    "script" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_game_recordings_pkey" PRIMARY KEY ("match_id","game_number")
);

-- CreateIndex
CREATE UNIQUE INDEX "match_team_statistics_match_id_team_id_game_number_key" ON "match_team_statistics"("match_id", "team_id", "game_number");

-- CreateIndex
CREATE UNIQUE INDEX "player_match_statistics_match_id_player_id_game_number_key" ON "player_match_statistics"("match_id", "player_id", "game_number");

-- AddForeignKey
ALTER TABLE "match_game_recordings" ADD CONSTRAINT "match_game_recordings_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Served through the API only, like the other match tables.
ALTER TABLE "match_game_recordings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "match_game_recordings" FROM anon, authenticated;
