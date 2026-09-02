import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export const SUPABASE_AUDIENCE = 'authenticated';

interface JwtRequest {
  headers?: Record<string, string | string[] | undefined>;
  user?: { sub: string };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    const jwksUrl = config.get<string>('supabaseJwksUrl') as string;
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
    this.issuer = `${new URL(jwksUrl).origin}/auth/v1`;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      handler,
      controller,
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<JwtRequest>();
    const token = this.extractToken(request);

    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(
      OPTIONAL_AUTH_KEY,
      [handler, controller],
    );
    if (isOptionalAuth) {
      if (token === null) {
        return true;
      }
      try {
        const { payload } = await this.verify(token);
        if (typeof payload.sub === 'string') {
          request.user = { sub: payload.sub };
        }
      } catch (error) {
        this.logger.warn(
          `Optional JWT verification failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return true;
    }

    if (token === null) {
      throw new UnauthorizedException();
    }

    try {
      const { payload } = await this.verify(token);
      if (typeof payload.sub !== 'string') {
        throw new UnauthorizedException();
      }
      request.user = { sub: payload.sub };
    } catch (error) {
      this.logger.warn(
        `JWT verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new UnauthorizedException();
    }
    return true;
  }

  private verify(token: string) {
    return jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: SUPABASE_AUDIENCE,
    });
  }

  private extractToken(request: JwtRequest): string | null {
    const authorization = request?.headers?.authorization;
    if (
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ')
    ) {
      return null;
    }
    return authorization.slice('Bearer '.length).trim();
  }
}
