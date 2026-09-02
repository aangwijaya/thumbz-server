import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { UsersService } from './users.service';

interface LazyProfileRequest {
  user?: { sub: string };
}

@Injectable()
export class ProfileSyncInterceptor implements NestInterceptor {
  constructor(private readonly usersService: UsersService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<LazyProfileRequest>();
    const sub = request?.user?.sub;
    if (sub) {
      await this.usersService.ensureProfile(sub);
    }
    return next.handle();
  }
}
