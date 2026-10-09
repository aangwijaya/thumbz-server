-- Search: full-text documents (prefix matching) + trigram indexes (substring
-- and typo-tolerant matching). The 'simple' config is used on purpose: these
-- are names and handles, not natural-language text, so no stemming/stopwords.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Generated columns keep the documents in sync with no triggers or app code.
-- (schema.prisma declares them as Unsupported("tsvector") for drift checks.)
ALTER TABLE "teams" ADD COLUMN "search_document" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig,
      coalesce("name", '') || ' ' || coalesce("short_name", '') || ' ' || replace("slug", '-', ' '))
  ) STORED;

ALTER TABLE "players" ADD COLUMN "search_document" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig,
      coalesce("nickname", '') || ' ' || coalesce("real_name", '') || ' ' || replace("slug", '-', ' '))
  ) STORED;

ALTER TABLE "tournaments" ADD COLUMN "search_document" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig,
      coalesce("name", '') || ' ' || replace("slug", '-', ' '))
  ) STORED;

ALTER TABLE "videos" ADD COLUMN "search_document" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, coalesce("title", ''))
  ) STORED;

CREATE INDEX "teams_search_document_idx" ON "teams" USING GIN ("search_document");
CREATE INDEX "players_search_document_idx" ON "players" USING GIN ("search_document");
CREATE INDEX "tournaments_search_document_idx" ON "tournaments" USING GIN ("search_document");
CREATE INDEX "videos_search_document_idx" ON "videos" USING GIN ("search_document");

CREATE INDEX "teams_name_trgm_idx" ON "teams" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "players_nickname_trgm_idx" ON "players" USING GIN ("nickname" gin_trgm_ops);
CREATE INDEX "tournaments_name_trgm_idx" ON "tournaments" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "videos_title_trgm_idx" ON "videos" USING GIN ("title" gin_trgm_ops);
