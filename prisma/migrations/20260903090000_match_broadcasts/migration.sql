-- CreateEnum
CREATE TYPE "broadcast_language" AS ENUM ('en', 'id', 'ms', 'tl');

-- CreateTable
CREATE TABLE "match_broadcasts" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "language" "broadcast_language" NOT NULL,
    "stream_url" TEXT NOT NULL,
    "viewer_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "match_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "match_broadcasts_match_id_language_key" ON "match_broadcasts"("match_id", "language");

-- CreateIndex
CREATE INDEX "match_broadcasts_match_id_idx" ON "match_broadcasts"("match_id");

-- AddForeignKey
ALTER TABLE "match_broadcasts" ADD CONSTRAINT "match_broadcasts_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Thumbz additions (plan §6.1) ----------------------------------------------

ALTER TABLE "match_broadcasts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "match_broadcasts" FROM anon, authenticated;
