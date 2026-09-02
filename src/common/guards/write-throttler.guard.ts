import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

interface ThrottleRequest {
  method?: string;
  ip?: string;
  user?: { sub?: string } | undefined;
}

@Injectable()
export class WriteThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ThrottleRequest>();
    if (SAFE_METHODS.includes(request.method ?? '')) {
      return true;
    }
    return super.canActivate(context);
  }

  protected getTracker(req: ThrottleRequest): Promise<string> {
    const userId = req.user?.sub;
    return Promise.resolve(
      userId ? `user:${userId}` : `ip:${req.ip ?? 'unknown'}`,
    );
  }
}
