import { ConfigService } from '@nestjs/config';
import { FrontendRevalidationListener } from './frontend-revalidation.listener';

function listener(secret: string | null) {
  return new FrontendRevalidationListener(
    new ConfigService({
      frontendUrl: 'https://thumbz.example',
      revalidateSecret: secret,
    }),
  );
}

describe('FrontendRevalidationListener', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    jest.useRealTimers();
    fetchMock.mockRestore();
  });

  it('coalesces a burst of events into one authenticated call', async () => {
    const target = listener('s'.repeat(32));
    target.onDomainEvent({ type: 'catalog.changed', entity: 'team', id: 'a' });
    target.onDomainEvent({ type: 'match.changed', matchId: 'm1' });
    target.onDomainEvent({
      type: 'catalog.changed',
      entity: 'player',
      id: 'b',
    });

    await jest.advanceTimersByTimeAsync(500);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://thumbz.example/api/revalidate');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${'s'.repeat(32)}`,
    });
    const body = JSON.parse(init.body as string) as { tags: string[] };
    expect(body.tags).toEqual(
      expect.arrayContaining(['catalog', 'match:m1', 'matches', 'home']),
    );
    expect(new Set(body.tags).size).toBe(body.tags.length);
  });

  it('does nothing without a configured secret', async () => {
    const target = listener(null);
    target.onDomainEvent({ type: 'catalog.changed', entity: 'team', id: 'a' });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows frontend failures (best effort)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const target = listener('s'.repeat(32));
    target.onDomainEvent({ type: 'catalog.changed', entity: 'team', id: 'a' });
    await expect(jest.advanceTimersByTimeAsync(500)).resolves.not.toThrow();
  });
});
