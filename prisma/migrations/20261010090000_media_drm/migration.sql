-- Protected streaming: packaged media assets and envelope-encrypted content keys.

-- CreateEnum
CREATE TYPE "media_protection" AS ENUM ('none', 'clearkey_aes', 'multidrm');

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "video_id" UUID,
    "title" TEXT NOT NULL,
    "protection" "media_protection" NOT NULL DEFAULT 'clearkey_aes',
    "dash_url" TEXT,
    "hls_url" TEXT,
    "kid" TEXT,
    "provider_content_id" TEXT,
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_keys" (
    "kid" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "auth_tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_keys_pkey" PRIMARY KEY ("kid")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_video_id_key" ON "media_assets"("video_id");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_kid_fkey" FOREIGN KEY ("kid") REFERENCES "content_keys"("kid") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_keys" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "media_assets" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "content_keys" FROM anon, authenticated;
