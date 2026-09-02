import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { user_role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

interface RolesRequest {
  user?: { sub: string };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<user_role[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const sub = context.switchToHttp().getRequest<RolesRequest>()?.user?.sub;
    if (!sub) {
      throw new ForbiddenException();
    }

    const profile = await this.prisma.profile.findUnique({
      where: { id: sub },
      select: { role: true },
    });
    if (profile === null || !requiredRoles.includes(profile.role)) {
      throw new ForbiddenException();
    }
    return true;
  }
}
