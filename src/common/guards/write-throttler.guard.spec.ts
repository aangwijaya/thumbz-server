import { ExecutionContext } from '@nestjs/common';
import { WriteThrottlerGuard } from './write-throttler.guard';

function buildGuard(): WriteThrottlerGuard {
  return new WriteThrottlerGuard({} as never, {} as never, {} as never);
}

function buildContext(
  method: string,
  req: Record<string, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('WriteThrottlerGuard', () => {
  it('bypasses throttling for GET requests', async () => {
    const guard = buildGuard();
    await expect(
      guard.canActivate(buildContext('GET', { method: 'GET', ip: '1.2.3.4' })),
    ).resolves.toBe(true);
  });

  it('bypasses throttling for HEAD and OPTIONS', async () => {
    const guard = buildGuard();
    await expect(
      guard.canActivate(buildContext('HEAD', { method: 'HEAD' })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(buildContext('OPTIONS', { method: 'OPTIONS' })),
    ).resolves.toBe(true);
  });

  it('tracks authenticated requests by user id', async () => {
    const guard = buildGuard();
    await expect(
      guard.getTracker({ user: { sub: 'user-1' }, ip: '1.2.3.4' }),
    ).resolves.toBe('user:user-1');
  });

  it('tracks anonymous requests by ip', async () => {
    const guard = buildGuard();
    await expect(guard.getTracker({ ip: '9.9.9.9' })).resolves.toBe(
      'ip:9.9.9.9',
    );
  });
});
