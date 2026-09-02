-- CreateTable
CREATE TABLE "match_gold_snapshots" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "gold" INTEGER NOT NULL DEFAULT 0,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_gold_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_gold_snapshots_match_id_recorded_at_idx" ON "match_gold_snapshots"("match_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "match_gold_snapshots_match_id_team_id_recorded_at_key" ON "match_gold_snapshots"("match_id", "team_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "match_gold_snapshots" ADD CONSTRAINT "match_gold_snapshots_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_gold_snapshots" ADD CONSTRAINT "match_gold_snapshots_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Thumbz additions (plan §6 / §9) -------------------------------------------

-- Gold snapshots must be non-negative (plan §6.1).
ALTER TABLE "match_gold_snapshots" ADD CONSTRAINT "match_gold_snapshots_gold_non_negative_check" CHECK ("gold" >= 0);

-- Row Level Security: deny-by-default (plan §9).
ALTER TABLE "match_gold_snapshots" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "match_gold_snapshots" FROM anon, authenticated;
