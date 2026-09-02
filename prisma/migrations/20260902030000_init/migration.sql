-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "tournament_status" AS ENUM ('upcoming', 'ongoing', 'completed');

-- CreateEnum
CREATE TYPE "player_role" AS ENUM ('gold', 'mid', 'exp', 'jungle', 'roam', 'flex', 'coach');

-- CreateEnum
CREATE TYPE "match_stage" AS ENUM ('group_stage', 'regular_season', 'playoffs', 'semifinal', 'third_place', 'grand_final');

-- CreateEnum
CREATE TYPE "match_status" AS ENUM ('scheduled', 'live', 'completed', 'cancelled', 'postponed');

-- CreateEnum
CREATE TYPE "video_type" AS ENUM ('replay', 'highlight', 'vod');

-- CreateEnum
CREATE TYPE "favorite_type" AS ENUM ('team', 'player');

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "username" TEXT,
    "avatar_url" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournaments" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "tournament_status" NOT NULL DEFAULT 'upcoming',
    "region" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "prize_pool" TEXT,
    "description" TEXT,
    "logo_url" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "logo_url" TEXT,
    "color_primary" TEXT,
    "color_secondary" TEXT,
    "description" TEXT,
    "founded_year" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "real_name" TEXT,
    "role" "player_role" NOT NULL,
    "country" TEXT,
    "team_id" UUID,
    "photo_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "tournament_id" UUID,
    "stage" "match_stage",
    "round" INTEGER,
    "group_name" TEXT,
    "best_of" INTEGER NOT NULL DEFAULT 1,
    "game_number" INTEGER,
    "team_a_id" UUID NOT NULL,
    "team_b_id" UUID NOT NULL,
    "score_a" INTEGER,
    "score_b" INTEGER,
    "winner_team_id" UUID,
    "status" "match_status" NOT NULL DEFAULT 'scheduled',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "stream_url" TEXT,
    "thumbnail_url" TEXT,
    "viewer_count" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_team_statistics" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "gold" INTEGER NOT NULL DEFAULT 0,
    "towers_destroyed" INTEGER NOT NULL DEFAULT 0,
    "game_duration_seconds" INTEGER,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "match_team_statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_match_statistics" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "gold" INTEGER NOT NULL DEFAULT 0,
    "hero_picked" TEXT,
    "mvp" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "player_match_statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "videos" (
    "id" UUID NOT NULL,
    "match_id" UUID,
    "title" TEXT NOT NULL,
    "type" "video_type" NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "duration_seconds" INTEGER,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "user_id" UUID NOT NULL,
    "entity_type" "favorite_type" NOT NULL,
    "entity_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("user_id","entity_type","entity_id")
);

-- CreateTable
CREATE TABLE "watch_history" (
    "user_id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "watched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_seconds" INTEGER,

    CONSTRAINT "watch_history_pkey" PRIMARY KEY ("user_id","match_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_username_key" ON "profiles"("username");

-- CreateIndex
CREATE UNIQUE INDEX "tournaments_slug_key" ON "tournaments"("slug");

-- CreateIndex
CREATE INDEX "tournaments_status_start_date_idx" ON "tournaments"("status", "start_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "teams_slug_key" ON "teams"("slug");

-- CreateIndex
CREATE INDEX "teams_name_idx" ON "teams"("name");

-- CreateIndex
CREATE UNIQUE INDEX "players_slug_key" ON "players"("slug");

-- CreateIndex
CREATE INDEX "players_team_id_idx" ON "players"("team_id");

-- CreateIndex
CREATE INDEX "players_nickname_idx" ON "players"("nickname");

-- CreateIndex
CREATE INDEX "matches_status_scheduled_at_idx" ON "matches"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "matches_tournament_id_idx" ON "matches"("tournament_id");

-- CreateIndex
CREATE INDEX "matches_team_a_id_idx" ON "matches"("team_a_id");

-- CreateIndex
CREATE INDEX "matches_team_b_id_idx" ON "matches"("team_b_id");

-- CreateIndex
CREATE INDEX "match_team_statistics_team_id_idx" ON "match_team_statistics"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_team_statistics_match_id_team_id_key" ON "match_team_statistics"("match_id", "team_id");

-- CreateIndex
CREATE INDEX "player_match_statistics_player_id_idx" ON "player_match_statistics"("player_id");

-- CreateIndex
CREATE INDEX "player_match_statistics_team_id_match_id_idx" ON "player_match_statistics"("team_id", "match_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_match_statistics_match_id_player_id_key" ON "player_match_statistics"("match_id", "player_id");

-- CreateIndex
CREATE INDEX "videos_type_published_at_idx" ON "videos"("type", "published_at" DESC);

-- CreateIndex
CREATE INDEX "favorites_entity_type_entity_id_idx" ON "favorites"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "watch_history_user_id_watched_at_idx" ON "watch_history"("user_id", "watched_at" DESC);

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_a_id_fkey" FOREIGN KEY ("team_a_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_b_id_fkey" FOREIGN KEY ("team_b_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_team_id_fkey" FOREIGN KEY ("winner_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_team_statistics" ADD CONSTRAINT "match_team_statistics_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_team_statistics" ADD CONSTRAINT "match_team_statistics_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_match_statistics" ADD CONSTRAINT "player_match_statistics_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_match_statistics" ADD CONSTRAINT "player_match_statistics_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_match_statistics" ADD CONSTRAINT "player_match_statistics_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_history" ADD CONSTRAINT "watch_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_history" ADD CONSTRAINT "watch_history_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Thumbz additions (plan §6 / §9) -------------------------------------------

-- Matches invariants not expressible in the Prisma datamodel (plan §6.1):
-- team_a_id must differ from team_b_id; scores must be non-negative.
ALTER TABLE "matches" ADD CONSTRAINT "matches_teams_distinct_check" CHECK ("team_a_id" <> "team_b_id");
ALTER TABLE "matches" ADD CONSTRAINT "matches_score_a_non_negative_check" CHECK ("score_a" IS NULL OR "score_a" >= 0);
ALTER TABLE "matches" ADD CONSTRAINT "matches_score_b_non_negative_check" CHECK ("score_b" IS NULL OR "score_b" >= 0);

-- Partial indexes (plan §6.1).
CREATE INDEX "matches_live_started_at_idx" ON "matches" ("started_at") WHERE "status" = 'live';
CREATE INDEX "matches_featured_idx" ON "matches" ("featured") WHERE "featured" = true;

-- profiles.id is a mirror of auth.users.id (plan §6.1). No DB-level FK is
-- created here: Prisma cannot introspect cross-schema foreign keys into the
-- Supabase-managed `auth` schema (P4002). Integrity is enforced at the
-- application layer — profiles are lazily created only from verified JWT
-- `sub` claims, which by construction exist in auth.users.

-- Row Level Security: deny-by-default (plan §9).
-- No policies are granted to anon/authenticated; service_role bypasses RLS.
-- All application data flows through the NestJS API only.
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournaments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "players" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_team_statistics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "player_match_statistics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "videos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "favorites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "watch_history" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "profiles" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "tournaments" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "teams" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "players" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "matches" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "match_team_statistics" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "player_match_statistics" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "videos" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "favorites" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "watch_history" FROM anon, authenticated;

