import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { exportJWK, generateKeyPair, KeyLike, SignJWT } from 'jose';
import { createServer, Server } from 'node:http';
import { OptionalAuth } from '../decorators/optional-auth.decorator';
import { Public } from '../decorators/public.decorator';
import { JwtAuthGuard, SUPABASE_AUDIENCE } from './jwt-auth.guard';

class PublicController {
  @Public()
  publicHandler(this: void): void {
    /* noop */
  }
}

class ProtectedController {
  protectedHandler(this: void): void {
    /* noop */
  }
}

class OptionalAuthController {
  @OptionalAuth()
  optionalHandler(this: void): void {
    /* noop */
  }
}

function contextFor(
  handler: () => unknown,
  controller: unknown,
  req: Record<string, unknown>,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let server: Server;
  let issuer: string;
  let jwksUrl: string;
  let privateKey: KeyLike;
  let otherPrivateKey: KeyLike;

  beforeAll(async () => {
    const { publicKey, privateKey: pk } = await generateKeyPair('RS256', {
      extractable: true,
    });
    const { privateKey: otherPk } = await generateKeyPair('RS256');
    privateKey = pk;
    otherPrivateKey = otherPk;

    const publicJwk = await exportJWK(publicKey);
    const jwks = {
      keys: [{ ...publicJwk, kid: 'test-kid', alg: 'RS256', use: 'sig' }],
    };

    server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(jwks));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('test server has no port');
    }
    issuer = `http://127.0.0.1:${address.port}/auth/v1`;
    jwksUrl = `${issuer}/.well-known/jwks.json`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  function buildGuard(): JwtAuthGuard {
    const config = {
      get: (key: string) => (key === 'supabaseJwksUrl' ? jwksUrl : undefined),
    } as unknown as ConfigService;
    return new JwtAuthGuard(new Reflector(), config);
  }

  async function signToken(
    key: KeyLike,
    options: {
      issuer?: string;
      audience?: string;
      expirationTime?: string | number;
      sub?: string;
    } = {},
  ): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
      .setSubject(options.sub ?? 'user-1')
      .setIssuer(options.issuer ?? issuer)
      .setAudience(options.audience ?? SUPABASE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(options.expirationTime ?? '1h')
      .sign(key);
  }

  it('skips verification for @Public routes', async () => {
    const request = { headers: {} };
    const result = await buildGuard().canActivate(
      contextFor(
        PublicController.prototype.publicHandler,
        PublicController,
        request,
      ),
    );
    expect(result).toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('rejects requests without an Authorization header', async () => {
    await expect(
      buildGuard().canActivate(
        contextFor(
          ProtectedController.prototype.protectedHandler,
          ProtectedController,
          { headers: {} },
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects malformed Authorization headers', async () => {
    await expect(
      buildGuard().canActivate(
        contextFor(
          ProtectedController.prototype.protectedHandler,
          ProtectedController,
          { headers: { authorization: 'Token abc' } },
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a valid token and attaches the user', async () => {
    const token = await signToken(privateKey);
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
    };

    const result = await buildGuard().canActivate(
      contextFor(
        ProtectedController.prototype.protectedHandler,
        ProtectedController,
        request,
      ),
    );

    expect(result).toBe(true);
    expect(request.user).toEqual({ sub: 'user-1' });
  });

  it('rejects an expired token', async () => {
    const token = await signToken(privateKey, {
      expirationTime: Math.floor(Date.now() / 1000) - 60,
    });
    await expect(
      buildGuard().canActivate(
        contextFor(
          ProtectedController.prototype.protectedHandler,
          ProtectedController,
          { headers: { authorization: `Bearer ${token}` } },
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed by a different key', async () => {
    const token = await signToken(otherPrivateKey);
    await expect(
      buildGuard().canActivate(
        contextFor(
          ProtectedController.prototype.protectedHandler,
          ProtectedController,
          { headers: { authorization: `Bearer ${token}` } },
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token with the wrong issuer', async () => {
    const token = await signToken(privateKey, {
      issuer: 'https://evil.example/auth/v1',
    });
    await expect(
      buildGuard().canActivate(
        contextFor(
          ProtectedController.prototype.protectedHandler,
          ProtectedController,
          { headers: { authorization: `Bearer ${token}` } },
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await signToken(privateKey, { audience: 'service_role' });
    await expect(
      buildGuard().canActivate(
        contextFor(
          ProtectedController.prototype.protectedHandler,
          ProtectedController,
          { headers: { authorization: `Bearer ${token}` } },
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('JwtAuthGuard optional auth', () => {
  let server: Server;
  let issuer: string;
  let jwksUrl: string;
  let privateKey: KeyLike;

  beforeAll(async () => {
    const { publicKey, privateKey: pk } = await generateKeyPair('RS256', {
      extractable: true,
    });
    privateKey = pk;
    const publicJwk = await exportJWK(publicKey);
    const jwks = {
      keys: [{ ...publicJwk, kid: 'test-kid', alg: 'RS256', use: 'sig' }],
    };
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(jwks));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('test server has no port');
    }
    issuer = `http://127.0.0.1:${address.port}/auth/v1`;
    jwksUrl = `${issuer}/.well-known/jwks.json`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  function buildGuard(): JwtAuthGuard {
    const config = {
      get: (key: string) => (key === 'supabaseJwksUrl' ? jwksUrl : undefined),
    } as unknown as ConfigService;
    return new JwtAuthGuard(new Reflector(), config);
  }

  async function signToken(): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
      .setSubject('user-1')
      .setIssuer(issuer)
      .setAudience(SUPABASE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  function optionalContext(req: Record<string, unknown>): ExecutionContext {
    return contextFor(
      OptionalAuthController.prototype.optionalHandler,
      OptionalAuthController,
      req,
    );
  }

  it('allows anonymous access without a token', async () => {
    const request: Record<string, unknown> = { headers: {} };
    const result = await buildGuard().canActivate(optionalContext(request));
    expect(result).toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('stays anonymous when the token is invalid', async () => {
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer not.a.jwt' },
    };
    const result = await buildGuard().canActivate(optionalContext(request));
    expect(result).toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('attaches the user when the token is valid', async () => {
    const token = await signToken();
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
    };
    const result = await buildGuard().canActivate(optionalContext(request));
    expect(result).toBe(true);
    expect(request.user).toEqual({ sub: 'user-1' });
  });
});
