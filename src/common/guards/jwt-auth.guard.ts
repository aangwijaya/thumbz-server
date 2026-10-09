import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { bearerToken, JwtVerifierService } from '../auth/jwt-verifier.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export { SUPABASE_AUDIENCE } from '../auth/jwt-verifier.service';

interface JwtRequest {
  headers?: Record<string, string | string[] | undefined>;
  user?: CurrentUser;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifierService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<JwtRequest>();
    const token = bearerToken(request?.headers?.authorization);

    if (this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, targets)) {
      if (token !== null) {
        try {
          request.user = await this.verifier.verify(token);
        } catch (error) {
          this.logger.warn(
            `Optional JWT verification failed: ${reason(error)}`,
          );
        }
      }
      return true;
    }

    if (token === null) {
      throw new UnauthorizedException();
    }
    try {
      request.user = await this.verifier.verify(token);
    } catch (error) {
      this.logger.warn(`JWT verification failed: ${reason(error)}`);
      throw new UnauthorizedException();
    }
    return true;
  }
}
