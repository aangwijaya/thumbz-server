/**
 * Publishes a packaged asset (scripts/media/package.sh output):
 *  1. uploads every file to the public Supabase Storage bucket `media`
 *     (CDN; segments are encrypted, so public is fine),
 *  2. seals the content key with DRM_MASTER_KEY and stores it,
 *  3. upserts the media asset and optionally links it to a video.
 *
 * Usage:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… DRM_MASTER_KEY=… DATABASE_URL=… \
 *   npx ts-node scripts/media/register.ts <asset-dir> [--video <video-id>] [--title "…"]
 * The asset.json key is deleted from disk after it is sealed.
 */
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { KeyVault } from '../../src/modules/media/key-vault';

const CONTENT_TYPES: Record<string, string> = {
  mpd: 'application/dash+xml',
  m3u8: 'application/vnd.apple.mpegurl',
  m4s: 'video/iso.segment',
  mp4: 'video/mp4',
  ts: 'video/mp2t',
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const supabase = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const master = process.env.DRM_MASTER_KEY;
  if (!dir || !supabase || !serviceKey || !master) {
    throw new Error(
      'usage: register.ts <asset-dir> (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DRM_MASTER_KEY)',
    );
  }
  const meta = JSON.parse(readFileSync(join(dir, 'asset.json'), 'utf8')) as {
    name: string;
    kid: string;
    key?: string;
    dash: string;
    hls: string;
    duration_seconds: number;
  };
  const auth = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };

  // Public bucket (idempotent).
  await fetch(`${supabase}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'media', name: 'media', public: true }),
  });

  const uploads = files(dir).filter((path) => !path.endsWith('asset.json'));
  let done = 0;
  const queue = [...uploads];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let path = queue.shift(); path; path = queue.shift()) {
        const key = `${meta.name}/${relative(dir, path)}`;
        const ext = path.split('.').pop() ?? '';
        const response = await fetch(
          `${supabase}/storage/v1/object/media/${key}`,
          {
            method: 'POST',
            headers: {
              ...auth,
              'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
              'x-upsert': 'true',
              'cache-control':
                ext === 'm3u8' || ext === 'mpd'
                  ? 'max-age=60'
                  : 'max-age=31536000, immutable',
            },
            body: readFileSync(path),
          },
        );
        if (!response.ok)
          throw new Error(
            `upload ${key}: ${response.status} ${await response.text()}`,
          );
        done += 1;
      }
    }),
  );
  console.log(`uploaded ${done} files`);

  const base = `${supabase}/storage/v1/object/public/media/${meta.name}`;
  const prisma = new PrismaClient();
  const vault = new KeyVault(new ConfigService({ drmMasterKey: master }));
  if (meta.key) {
    const sealed = vault.seal(meta.key, meta.kid);
    await prisma.contentKey.upsert({
      where: { kid: meta.kid },
      create: { kid: meta.kid, ...sealed },
      update: sealed,
    });
  }
  const videoId = arg('video') ?? null;
  const data = {
    title: arg('title') ?? meta.name,
    protection: 'clearkey_aes' as const,
    dash_url: `${base}/${meta.dash}`,
    hls_url: `${base}/${meta.hls}`,
    kid: meta.kid,
    duration_seconds: meta.duration_seconds,
    video_id: videoId,
  };
  const existing = await prisma.mediaAsset.findFirst({
    where: { kid: meta.kid },
  });
  const asset = existing
    ? await prisma.mediaAsset.update({ where: { id: existing.id }, data })
    : await prisma.mediaAsset.create({ data });
  await prisma.$disconnect();

  if (meta.key) {
    // The key now lives only sealed in the database.
    writeFileSync(
      join(dir, 'asset.json'),
      JSON.stringify({ ...meta, key: undefined }, null, 2),
    );
  }
  console.log(
    `registered media asset ${asset.id}${videoId ? ` for video ${videoId}` : ''}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
