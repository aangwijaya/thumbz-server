import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { user_role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

class AdminController {
  @Roles('admin')
  adminHandler(this: void): void {
    /* noop */
  }
}

class OpenController {
  openHandler(this: void): void {
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

function buildGuard(profileRole: user_role | null): RolesGuard {
  const prisma = {
    profile: {
      findUnique: jest
        .fn()
        .mockResolvedValue(profileRole === null ? null : { role: profileRole }),
    },
  } as unknown as PrismaService;
  return new RolesGuard(new Reflector(), prisma);
}

describe('RolesGuard', () => {
  it('allows routes without @Roles metadata without touching the database', async () => {
    const findUnique = jest.fn();
    const prisma = {
      profile: { findUnique },
    } as unknown as PrismaService;
    const guard = new RolesGuard(new Reflector(), prisma);

    const result = await guard.canActivate(
      contextFor(OpenController.prototype.openHandler, OpenController, {
        user: { sub: 'u1' },
      }),
    );

    expect(result).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('allows an admin profile on an @Roles("admin") route', async () => {
    const guard = buildGuard('admin');
    const result = await guard.canActivate(
      contextFor(AdminController.prototype.adminHandler, AdminController, {
        user: { sub: 'u1' },
      }),
    );
    expect(result).toBe(true);
  });

  it('rejects a user profile on an @Roles("admin") route', async () => {
    const guard = buildGuard('user');
    await expect(
      guard.canActivate(
        contextFor(AdminController.prototype.adminHandler, AdminController, {
          user: { sub: 'u1' },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when the profile does not exist', async () => {
    const guard = buildGuard(null);
    await expect(
      guard.canActivate(
        contextFor(AdminController.prototype.adminHandler, AdminController, {
          user: { sub: 'u1' },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when no user is attached to the request', async () => {
    const guard = buildGuard('admin');
    await expect(
      guard.canActivate(
        contextFor(AdminController.prototype.adminHandler, AdminController, {}),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
