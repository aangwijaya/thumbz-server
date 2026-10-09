/**
 * E2E auth: signs Supabase-shaped RS256 access tokens with a throwaway key and
 * makes the API trust that key instead of the remote JWKS, so authenticated
 * flows (/me/*, comments, orders, admin) can be exercised over HTTP.
 */
import { TestingModuleBuilder } from '@nestjs/testing';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  JWK,
  KeyLike,
  SignJWT,
} from 'jose';
import {
  JWT_KEY_RESOLVER,
  SUPABASE_AUDIENCE,
} from '../../src/common/auth/jwt-verifier.service';

/** Seeded fallback admin profile (see README "Admin flows"). */
export const TEST_ADMIN_ID = '00000000-0000-4000-8000-000000000001';

const KID = 'e2e-test-key';

let keyPair: Promise<{ privateKey: KeyLike; publicJwk: JWK }> | null = null;

function testKeys() {
  keyPair ??= generateKeyPair('RS256', { extractable: true }).then(
    async ({ privateKey, publicKey }) => ({
      privateKey,
      publicJwk: { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256' },
    }),
  );
  return keyPair;
}

function issuer(): string {
  const jwksUrl = process.env.SUPABASE_JWKS_URL;
  if (!jwksUrl) {
    throw new Error('SUPABASE_JWKS_URL is not set (see .env.test)');
  }
  return `${new URL(jwksUrl).origin}/auth/v1`;
}

export async function withTestAuth(
  builder: TestingModuleBuilder,
): Promise<TestingModuleBuilder> {
  const { publicJwk } = await testKeys();
  return builder
    .overrideProvider(JWT_KEY_RESOLVER)
    .useValue(createLocalJWKSet({ keys: [publicJwk] }));
}

export async function signTestToken(
  sub: string,
  /** `expiresIn`: a jose period ('15m') or an absolute epoch-seconds number. */
  options: { name?: string; expiresIn?: string | number } = {},
): Promise<string> {
  const { privateKey } = await testKeys();
  return new SignJWT({
    role: 'authenticated',
    user_metadata: options.name ? { full_name: options.name } : {},
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setSubject(sub)
    .setIssuer(issuer())
    .setAudience(SUPABASE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '15m')
    .sign(privateKey);
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
