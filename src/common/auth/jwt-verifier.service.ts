import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';
import { CurrentUser } from '../decorators/current-user.decorator';

export const SUPABASE_AUDIENCE = 'authenticated';

/**
 * Resolves the verification key for a token. Production uses the Supabase
 * JWKS endpoint; tests swap in a local key set (`createLocalJWKSet`).
 */
export const JWT_KEY_RESOLVER = Symbol('JWT_KEY_RESOLVER');

function displayName(payload: JWTPayload): string | undefined {
  const metadata = payload.user_metadata;
  if (typeof metadata !== 'object' || metadata === null) {
    return undefined;
  }
  const record = metadata as Record<string, unknown>;
  for (const key of ['full_name', 'name', 'display_name', 'username']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim().slice(0, 80);
    }
  }
  return undefined;
}

/** Verifies Supabase access tokens (RS256 via JWKS). Shared by HTTP and WS auth. */
@Injectable()
export class JwtVerifierService {
  private readonly issuer: string;

  constructor(
    @Inject(JWT_KEY_RESOLVER) private readonly keys: JWTVerifyGetKey,
    config: ConfigService,
  ) {
    const jwksUrl = config.get<string>('supabaseJwksUrl') as string;
    this.issuer = `${new URL(jwksUrl).origin}/auth/v1`;
  }

  /** Throws when the token is invalid, expired, or has no subject. */
  async verify(token: string): Promise<CurrentUser> {
    const { payload } = await jwtVerify(token, this.keys, {
      issuer: this.issuer,
      audience: SUPABASE_AUDIENCE,
    });
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new Error('token has no subject');
    }
    return { sub: payload.sub, name: displayName(payload) };
  }
}

/** Extracts the token from an `Authorization: Bearer <token>` header value. */
export function bearerToken(header: unknown): string | null {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token === '' ? null : token;
}
