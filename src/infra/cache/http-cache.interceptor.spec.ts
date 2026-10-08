import { cacheKeyFor } from './http-cache.interceptor';

describe('cacheKeyFor', () => {
  it('sorts query params so equivalent URLs share an entry', () => {
    expect(cacheKeyFor('/api/v1/matches', { status: 'live', page: '2' })).toBe(
      cacheKeyFor('/api/v1/matches', { page: '2', status: 'live' }),
    );
  });

  it('keeps repeated params and drops empty or nested values', () => {
    expect(
      cacheKeyFor('/x', { b: ['2', '1'], a: undefined, c: { nested: 1 } }),
    ).toBe('/x?b=2&b=1');
  });

  it('scopes per-user entries', () => {
    expect(cacheKeyFor('/api/v1/home', {}, 'user-1')).toBe(
      '/api/v1/home#u:user-1',
    );
    expect(cacheKeyFor('/api/v1/home', {})).toBe('/api/v1/home');
  });
});
