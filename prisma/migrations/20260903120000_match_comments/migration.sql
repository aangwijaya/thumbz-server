-- CreateTable
CREATE TABLE "match_comments" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_comments_match_id_created_at_idx" ON "match_comments"("match_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "match_comments" ADD CONSTRAINT "match_comments_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_comments" ADD CONSTRAINT "match_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Thumbz additions (plan §6.1) ----------------------------------------------

ALTER TABLE "match_comments" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "match_comments" FROM anon, authenticated;

-- Comment body must fit the API limit.
ALTER TABLE "match_comments" ADD CONSTRAINT "match_comments_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 280);
