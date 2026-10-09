import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { jwtVerify, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { orNotFound } from '../../common/utils/not-found';
import { REDIS } from '../../infra/redis/redis.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { KeyVault } from './key-vault';

const TOKEN_TTL_SECONDS = 10 * 60;
const HEARTBEAT_SECONDS = 30;
/** A session missing three heartbeats no longer counts against the limit. */
const SESSION_STALE_MS = HEARTBEAT_SECONDS * 3 * 1000;
const AUDIENCE = 'thumbz-playback';
const MANIFEST_CACHE_MS = 5 * 60_000;

export interface PlaybackClaims {
  sub: string;
  sid: string;
  aid: string;
  kid: string | null;
}

export interface KeySystemConfig {
  license_url: string;
  /** Extra request headers (the playback token for commercial license proxies). */
  headers?: Record<string, string>;
  certificate_url?: string;
}

export interface PlaybackSession {
  session_id: string;
  token: string;
  expires_at: string;
  heartbeat_seconds: number;
  asset: {
    id: string;
    title: string;
    protection: string;
    duration_seconds: number | null;
  };
  sources: {
    /** MSE/EME browsers: CENC DASH with per key-system license endpoints. */
    dash: {
      manifest_url: string;
      key_systems: Record<string, KeySystemConfig>;
    } | null;
    /** Safari/iOS: AES-128 HLS through the session-scoped manifest proxy. */
    hls: { manifest_url: string } | null;
  };
}

const b64url = (buffer: Buffer) => buffer.toString('base64url');

/**
 * Protected playback: short-lived sessions bound to user + asset, a
 * concurrent-stream limit, a ClearKey license server, and an HLS manifest
 * proxy that injects session-scoped AES-128 key URLs for Safari/iOS.
 */
@Injectable()
export class PlaybackService {
  private readonly logger = new Logger(PlaybackService.name);
  private readonly secret: Uint8Array;
  private readonly apiBase: string;
  private readonly maxStreams: number;
  private readonly licenseUrls: {
    widevine: string | null;
    playready: string | null;
    fairplay: string | null;
    fairplayCertificate: string | null;
  };
  private readonly manifestCache = new Map<
    string,
    { at: number; body: string }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: KeyVault,
    config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis | null,
  ) {
    this.secret = new TextEncoder().encode(
      config.get<string>('playbackTokenSecret') ?? '',
    );
    this.apiBase = `${config.get<string>('publicApiUrl') ?? 'http://localhost:3001'}/api/v1`;
    this.maxStreams = config.get<number>('maxStreamsPerUser') ?? 2;
    this.licenseUrls = config.get('drmLicenseUrls') ?? {
      widevine: null,
      playready: null,
      fairplay: null,
      fairplayCertificate: null,
    };
  }

  private get redisReady(): boolean {
    return this.redis !== null && this.redis.status === 'ready';
  }

  private streamsKey(userId: string): string {
    return `thumbz:streams:${userId}`;
  }

  async createSession(
    userId: string,
    assetId: string,
  ): Promise<PlaybackSession> {
    const asset = orNotFound(
      await this.prisma.mediaAsset.findUnique({ where: { id: assetId } }),
    );
    const sid = randomUUID();
    await this.claimStream(userId, sid);
    const token = await this.sign({
      sub: userId,
      sid,
      aid: asset.id,
      kid: asset.kid,
    });
    return this.describe(asset, sid, token);
  }

  /** Keeps a session alive and rotates its token. */
  async heartbeat(
    userId: string,
    sid: string,
  ): Promise<{ token: string; expires_at: string }> {
    const record = await this.sessionRecord(sid);
    if (record && record.user !== userId) throw new ForbiddenException();
    if (this.redisReady) {
      const alive = await this.redis!.zscore(this.streamsKey(userId), sid);
      if (alive === null) throw new NotFoundException(); // evicted or ended
      await this.redis!.multi()
        .zadd(this.streamsKey(userId), Date.now(), sid)
        .pexpire(this.streamsKey(userId), SESSION_STALE_MS * 2)
        .exec();
    }
    const asset = record
      ? await this.prisma.mediaAsset.findUnique({ where: { id: record.asset } })
      : null;
    if (!asset) throw new NotFoundException();
    const token = await this.sign({
      sub: userId,
      sid,
      aid: asset.id,
      kid: asset.kid,
    });
    return { token, expires_at: this.expiry() };
  }

  async end(userId: string, sid: string): Promise<void> {
    if (!this.redisReady) return;
    const record = await this.sessionRecord(sid);
    if (record && record.user !== userId) throw new ForbiddenException();
    await this.redis!.multi()
      .zrem(this.streamsKey(userId), sid)
      .del(`thumbz:stream:${sid}`)
      .exec();
  }

  /** Verifies a playback token and that its session is still open. */
  async verify(token: string | undefined): Promise<PlaybackClaims> {
    if (!token) throw new UnauthorizedException();
    let claims: PlaybackClaims;
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        audience: AUDIENCE,
      });
      claims = {
        sub: String(payload.sub),
        sid: String(payload.sid),
        aid: String(payload.aid),
        kid: typeof payload.kid === 'string' ? payload.kid : null,
      };
    } catch {
      throw new UnauthorizedException();
    }
    if (this.redisReady) {
      const alive = await this.redis!.zscore(
        this.streamsKey(claims.sub),
        claims.sid,
      );
      if (alive === null) throw new UnauthorizedException();
    }
    return claims;
  }

  /**
   * W3C ClearKey license (EME JSON format): `{ kids: [b64url] }` in,
   * `{ keys: [{ kty: "oct", kid, k }] }` out — only for the session's asset key.
   */
  async clearKeyLicense(
    token: string | undefined,
    body: { kids?: unknown },
  ): Promise<{
    keys: Array<{ kty: 'oct'; kid: string; k: string }>;
    type: 'temporary';
  }> {
    const claims = await this.verify(token);
    if (!claims.kid) throw new ForbiddenException();
    const requested = Array.isArray(body?.kids) ? body.kids : [];
    const kidB64 = b64url(Buffer.from(claims.kid, 'hex'));
    if (!requested.includes(kidB64)) throw new ForbiddenException();
    const key = await this.contentKey(claims.kid);
    return {
      keys: [{ kty: 'oct', kid: kidB64, k: b64url(key) }],
      type: 'temporary',
    };
  }

  /** Raw 16-byte AES-128 key for HLS (Safari/iOS native player). */
  async hlsKey(token: string | undefined): Promise<Buffer> {
    const claims = await this.verify(token);
    if (!claims.kid) throw new ForbiddenException();
    return this.contentKey(claims.kid);
  }

  /** Master playlist: variants routed through this proxy with the session token. */
  async hlsMaster(sid: string, token: string | undefined): Promise<string> {
    const claims = await this.verify(token);
    if (claims.sid !== sid) throw new ForbiddenException();
    const asset = await this.assetOf(claims);
    const master = await this.fetchPlaylist(asset.hls_url!);
    const query = `token=${encodeURIComponent(token!)}`;
    return master
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#')) return line;
        return `${this.apiBase}/playback/${sid}/hls/variant?path=${encodeURIComponent(trimmed)}&${query}`;
      })
      .join('\n');
  }

  /** Variant playlist: key URI → this API (session-scoped), segments → CDN. */
  async hlsVariant(
    sid: string,
    path: string,
    token: string | undefined,
  ): Promise<string> {
    const claims = await this.verify(token);
    if (claims.sid !== sid) throw new ForbiddenException();
    if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.m3u8$/.test(path)) {
      throw new BadRequestException();
    }
    const asset = await this.assetOf(claims);
    const base = asset.hls_url!.slice(0, asset.hls_url!.lastIndexOf('/') + 1);
    const variantUrl = new URL(path, base).toString();
    const variantDir = variantUrl.slice(0, variantUrl.lastIndexOf('/') + 1);
    const playlist = await this.fetchPlaylist(variantUrl);
    const keyUrl = `${this.apiBase}/drm/hls/key?token=${encodeURIComponent(token!)}`;
    return playlist
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#EXT-X-KEY')) {
          return trimmed.replace(/URI="[^"]*"/, `URI="${keyUrl}"`);
        }
        if (trimmed === '' || trimmed.startsWith('#')) return line;
        return new URL(trimmed, variantDir).toString();
      })
      .join('\n');
  }

  /** For commercial DRM services that call back to authorize a license request. */
  async authorize(token: string | undefined): Promise<{
    allowed: true;
    user_id: string;
    asset_id: string;
    kid: string | null;
  }> {
    const claims = await this.verify(token);
    return {
      allowed: true,
      user_id: claims.sub,
      asset_id: claims.aid,
      kid: claims.kid,
    };
  }

  private async claimStream(userId: string, sid: string): Promise<void> {
    if (!this.redisReady) {
      this.logger.warn(
        'Redis unavailable: concurrent-stream limit not enforced',
      );
      return;
    }
    const key = this.streamsKey(userId);
    await this.redis!.zremrangebyscore(key, 0, Date.now() - SESSION_STALE_MS);
    const active = await this.redis!.zcard(key);
    if (active >= this.maxStreams) {
      throw new ConflictException(
        `Too many devices are streaming on this account (max ${this.maxStreams})`,
      );
    }
    await this.redis!.multi()
      .zadd(key, Date.now(), sid)
      .pexpire(key, SESSION_STALE_MS * 2)
      .exec();
  }

  private async sessionRecord(
    sid: string,
  ): Promise<{ user: string; asset: string } | null> {
    if (!this.redisReady) return null;
    const raw = await this.redis!.get(`thumbz:stream:${sid}`);
    return raw ? (JSON.parse(raw) as { user: string; asset: string }) : null;
  }

  private async sign(claims: PlaybackClaims): Promise<string> {
    if (this.redisReady) {
      await this.redis!.set(
        `thumbz:stream:${claims.sid}`,
        JSON.stringify({ user: claims.sub, asset: claims.aid }),
        'EX',
        TOKEN_TTL_SECONDS,
      );
    }
    return new SignJWT({ sid: claims.sid, aid: claims.aid, kid: claims.kid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
      .sign(this.secret);
  }

  private expiry(): string {
    return new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();
  }

  private describe(
    asset: Awaited<ReturnType<PrismaService['mediaAsset']['findUnique']>> &
      object,
    sid: string,
    token: string,
  ): PlaybackSession {
    const keySystems: Record<string, KeySystemConfig> = {};
    if (asset.kid) {
      keySystems['org.w3.clearkey'] = {
        license_url: `${this.apiBase}/drm/clearkey/license`,
      };
    }
    if (asset.protection === 'multidrm') {
      // Commercial license services validate the token via POST /drm/authorize.
      const headers = { 'x-thumbz-playback': token };
      if (this.licenseUrls.widevine) {
        keySystems['com.widevine.alpha'] = {
          license_url: this.licenseUrls.widevine,
          headers,
        };
      }
      if (this.licenseUrls.playready) {
        keySystems['com.microsoft.playready'] = {
          license_url: this.licenseUrls.playready,
          headers,
        };
      }
      if (this.licenseUrls.fairplay && this.licenseUrls.fairplayCertificate) {
        keySystems['com.apple.fps'] = {
          license_url: this.licenseUrls.fairplay,
          certificate_url: this.licenseUrls.fairplayCertificate,
          headers,
        };
      }
    }
    return {
      session_id: sid,
      token,
      expires_at: this.expiry(),
      heartbeat_seconds: HEARTBEAT_SECONDS,
      asset: {
        id: asset.id,
        title: asset.title,
        protection: asset.protection,
        duration_seconds: asset.duration_seconds,
      },
      sources: {
        dash: asset.dash_url
          ? { manifest_url: asset.dash_url, key_systems: keySystems }
          : null,
        hls: asset.hls_url
          ? {
              manifest_url: `${this.apiBase}/playback/${sid}/hls/master.m3u8?token=${encodeURIComponent(token)}`,
            }
          : null,
      },
    };
  }

  private async assetOf(claims: PlaybackClaims) {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: claims.aid },
    });
    if (!asset?.hls_url) throw new NotFoundException();
    return asset;
  }

  private async contentKey(kid: string): Promise<Buffer> {
    const sealed = await this.prisma.contentKey.findUnique({ where: { kid } });
    if (!sealed) throw new NotFoundException();
    return this.vault.open(sealed, kid);
  }

  private async fetchPlaylist(url: string): Promise<string> {
    const cached = this.manifestCache.get(url);
    if (cached && Date.now() - cached.at < MANIFEST_CACHE_MS)
      return cached.body;
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new NotFoundException();
    const body = await response.text();
    this.manifestCache.set(url, { at: Date.now(), body });
    return body;
  }
}
