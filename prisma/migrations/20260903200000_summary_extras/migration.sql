-- Approved FE summary extras (contract §6.1/§6.2/§6.3/§6.5/§6.8)

ALTER TABLE "matches" ADD COLUMN "stream_delay_seconds" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "videos" ADD COLUMN "game_number" INTEGER;
ALTER TABLE "videos" ADD COLUMN "winning_team_id" UUID;
ALTER TABLE "teams" ADD COLUMN "short_name" TEXT;
ALTER TABLE "watch_history" ADD COLUMN "total_seconds" INTEGER;

ALTER TABLE "videos" ADD CONSTRAINT "videos_winning_team_id_fkey" FOREIGN KEY ("winning_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "matches" ADD CONSTRAINT "matches_stream_delay_range_check" CHECK ("stream_delay_seconds" BETWEEN 0 AND 600);
ALTER TABLE "videos" ADD CONSTRAINT "videos_game_number_positive_check" CHECK ("game_number" IS NULL OR "game_number" >= 1);
ALTER TABLE "watch_history" ADD CONSTRAINT "watch_history_total_seconds_non_negative_check" CHECK ("total_seconds" IS NULL OR "total_seconds" >= 0);
