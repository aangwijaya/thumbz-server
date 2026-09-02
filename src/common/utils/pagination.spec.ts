import { buildPaginationMeta } from './pagination';

describe('buildPaginationMeta', () => {
  it('computes totalPages with rounding up', () => {
    expect(buildPaginationMeta(1, 20, 137)).toEqual({
      page: 1,
      pageSize: 20,
      total: 137,
      totalPages: 7,
    });
  });

  it('returns zero totalPages for an empty result set', () => {
    expect(buildPaginationMeta(1, 20, 0)).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it('returns one totalPages when total is an exact multiple', () => {
    expect(buildPaginationMeta(2, 10, 30).totalPages).toBe(3);
  });
});
