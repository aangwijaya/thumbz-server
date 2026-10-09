import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { KeyVault } from './../src/modules/media/key-vault';
import { PrismaService } from './../src/prisma/prisma.service';
import { bearer, signTestToken, withTestAuth } from './utils/auth';

interface SessionBody {
  data: {
    session_id: string;
    token: string;
    heartbeat_seconds: number;
    sources: {
      dash: {
        manifest_url: string;
        key_systems: Record<string, { license_url: string }>;
      } | null;
      hls: { manifest_url: string } | null;
    };
  };
}

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720',
  '720/index.m3u8',
  '',
].join('\n');

const VARIANT = [
  '#EXTM3U',
  '#EXT-X-TARGETDURATION:4',
  '#EXT-X-KEY:METHOD=AES-128,URI="thumbz-key://placeholder",IV=0x01',
  '#EXTINF:4.0,',
  '000.ts',
  '#EXT-X-ENDLIST',
  '',
].join('\n');

/** Protected playback: sessions, stream limit, ClearKey + HLS AES-128 key delivery. */
describe('Playback & DRM (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cdn: Server;
  let cdnBase: string;
  let assetId: string;
  const kid = randomBytes(16).toString('hex');
  const key = randomBytes(16);
  const kidB64 = Buffer.from(kid, 'hex').toString('base64url');
  const viewerId = randomUUID();
  let viewer: string;

  const http = () => request(app.getHttpServer());
  const open = async (): Promise<SessionBody['data']> =>
    (
      (
        await http()
          .post('/api/v1/playback/sessions')
          .set(bearer(viewer))
          .send({ asset_id: assetId })
          .expect(201)
      ).body as SessionBody
    ).data;
  /** Absolute API URL → path relative to the test server. */
  const local = (url: string) => url.slice(url.indexOf('/api/v1/'));

  beforeAll(async () => {
    // Stand-in for the storage CDN serving the (encrypted) HLS playlists.
    cdn = createServer((req, res) => {
      const body = req.url?.endsWith('/hls/master.m3u8')
        ? MASTER
        : req.url?.endsWith('/hls/720/index.m3u8')
          ? VARIANT
          : null;
      res.writeHead(body ? 200 : 404).end(body ?? '');
    });
    await new Promise<void>((resolve) => cdn.listen(0, '127.0.0.1', resolve));
    cdnBase = `http://127.0.0.1:${(cdn.address() as AddressInfo).port}`;

    const builder = await withTestAuth(
      Test.createTestingModule({ imports: [AppModule] }),
    );
    app = (await builder.compile()).createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.contentKey.create({
      data: { kid, ...app.get(KeyVault).seal(key.toString('hex'), kid) },
    });
    const asset = await prisma.mediaAsset.create({
      data: {
        title: 'E2E protected replay',
        protection: 'clearkey_aes',
        kid,
        dash_url: `${cdnBase}/dash/manifest.mpd`,
        hls_url: `${cdnBase}/hls/master.m3u8`,
      },
    });
    assetId = asset.id;
    viewer = await signTestToken(viewerId, { name: 'E2E Viewer' });
  });

  afterAll(async () => {
    await prisma.mediaAsset.deleteMany({ where: { id: assetId } });
    await prisma.contentKey.deleteMany({ where: { kid } });
    await prisma.profile.deleteMany({ where: { id: viewerId } });
    await app.close();
    await new Promise((resolve) => cdn.close(resolve));
  });

  it('requires sign-in to open a session', async () => {
    await http()
      .post('/api/v1/playback/sessions')
      .send({ asset_id: assetId })
      .expect(401);
  });

  it('issues a ClearKey license only for the session asset key', async () => {
    const session = await open();
    expect(session.heartbeat_seconds).toBeGreaterThan(0);
    const clearKey = session.sources.dash!.key_systems['org.w3.clearkey'];
    expect(clearKey.license_url).toMatch(/\/drm\/clearkey\/license$/);

    const license = await http()
      .post(local(clearKey.license_url))
      .set(bearer(session.token))
      .send({ kids: [kidB64], type: 'temporary' })
      .expect(200);
    expect(license.headers['cache-control']).toBe('no-store');
    expect(license.body).toEqual({
      keys: [{ kty: 'oct', kid: kidB64, k: key.toString('base64url') }],
      type: 'temporary',
    });

    await http()
      .post('/api/v1/drm/clearkey/license')
      .set(bearer(session.token))
      .send({ kids: [randomBytes(16).toString('base64url')] })
      .expect(403);
    await http()
      .post('/api/v1/drm/clearkey/license')
      .send({ kids: [kidB64] })
      .expect(401);
    await http()
      .post('/api/v1/drm/clearkey/license')
      .set(bearer(`${session.token}x`))
      .send({ kids: [kidB64] })
      .expect(401);

    await http()
      .delete(`/api/v1/playback/sessions/${session.session_id}`)
      .set(bearer(viewer))
      .expect(204);
    // An ended session's token is dead even before it expires.
    await http()
      .post('/api/v1/drm/clearkey/license')
      .set(bearer(session.token))
      .send({ kids: [kidB64] })
      .expect(401);
  });

  it('proxies HLS manifests with session-scoped AES-128 key URLs', async () => {
    const session = await open();
    const master = await http()
      .get(local(session.sources.hls!.manifest_url))
      .expect(200);
    expect(master.headers['content-type']).toContain(
      'application/vnd.apple.mpegurl',
    );
    const variantUrl = master.text
      .split('\n')
      .find((line) => line.includes('/hls/variant?'))!;
    expect(variantUrl).toContain(`/playback/${session.session_id}/`);

    const variant = await http().get(local(variantUrl)).expect(200);
    const keyUri = /URI="([^"]+)"/.exec(variant.text)![1];
    expect(keyUri).toContain('/drm/hls/key?token=');
    expect(variant.text).toContain(',IV=0x01');
    expect(variant.text).toContain(`${cdnBase}/hls/720/000.ts`);

    const served = await http()
      .get(local(keyUri))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(Buffer.compare(served.body as Buffer, key)).toBe(0);

    await http().get(`/api/v1/drm/hls/key?token=${session.token}x`).expect(401);
    await http()
      .get(`/api/v1/playback/${session.session_id}/hls/variant`)
      .query({ path: '../secret.m3u8', token: session.token })
      .expect(400);
    // A token cannot be replayed against another session's manifest.
    await http()
      .get(`/api/v1/playback/${randomUUID()}/hls/master.m3u8`)
      .query({ token: session.token })
      .expect(403);

    await http()
      .delete(`/api/v1/playback/sessions/${session.session_id}`)
      .set(bearer(viewer))
      .expect(204);
  });

  it('enforces the concurrent-stream limit and keeps sessions to their owner', async () => {
    const first = await open();
    const second = await open();
    const rejected = await http()
      .post('/api/v1/playback/sessions')
      .set(bearer(viewer))
      .send({ asset_id: assetId })
      .expect(409);
    expect(
      (rejected.body as { error: { message: string } }).error.message,
    ).toMatch(/Too many devices/);

    const stranger = await signTestToken(randomUUID());
    await http()
      .post(`/api/v1/playback/sessions/${first.session_id}/heartbeat`)
      .set(bearer(stranger))
      .expect(403);
    await http()
      .delete(`/api/v1/playback/sessions/${first.session_id}`)
      .set(bearer(stranger))
      .expect(403);

    const beat = await http()
      .post(`/api/v1/playback/sessions/${first.session_id}/heartbeat`)
      .set(bearer(viewer))
      .expect(200);
    expect((beat.body as { data: { token: string } }).data.token).toEqual(
      expect.any(String),
    );

    // Ending one stream frees a slot.
    await http()
      .delete(`/api/v1/playback/sessions/${second.session_id}`)
      .set(bearer(viewer))
      .expect(204);
    const third = await open();
    for (const sid of [first.session_id, third.session_id]) {
      await http()
        .delete(`/api/v1/playback/sessions/${sid}`)
        .set(bearer(viewer))
        .expect(204);
    }
  });

  it('exposes the protected media on the video payload', async () => {
    const video = await prisma.video.create({
      data: {
        title: 'E2E Protected Replay',
        type: 'replay',
        url: `${cdnBase}/hls/master.m3u8`,
        published_at: new Date(),
      },
    });
    try {
      await prisma.mediaAsset.update({
        where: { id: assetId },
        data: { video_id: video.id },
      });
      const res = await http().get(`/api/v1/videos/${video.id}`).expect(200);
      expect((res.body as { data: { media: unknown } }).data.media).toEqual({
        id: assetId,
        protection: 'clearkey_aes',
      });
    } finally {
      await prisma.video.delete({ where: { id: video.id } });
    }
  });
});
