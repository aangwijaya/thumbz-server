import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor, SortSpec } from './cursor';
import { findPage } from './find-page';

interface Row {
  id: string;
  at: Date;
}

const sort: SortSpec = { field: 'at', order: 'desc', type: 'date' };

/** In-memory stand-in for Prisma honoring the where/orderBy findPage builds. */
function table(rows: Row[]) {
  const sorted = [...rows].sort(
    (a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id),
  );
  const findMany = jest.fn(
    ({
      where,
      skip = 0,
      take,
    }: {
      where: Record<string, unknown>;
      skip?: number;
      take: number;
    }) => {
      const keyset = (
        where.AND as Array<Record<string, unknown>> | undefined
      )?.[1] as
        | { OR: [{ at: { lt: Date } }, { at: Date; id: { lt: string } }] }
        | undefined;
      const after = keyset
        ? sorted.filter(
            (row) =>
              row.at < keyset.OR[0].at.lt ||
              (row.at.getTime() === keyset.OR[1].at.getTime() &&
                row.id < keyset.OR[1].id.lt),
          )
        : sorted;
      return Promise.resolve(after.slice(skip, skip + take));
    },
  );
  const count = jest.fn(() => Promise.resolve(rows.length));
  return { findMany, count };
}

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

describe('findPage', () => {
  // Two rows share a timestamp: the id tie-breaker must keep them apart.
  const rows: Row[] = [
    { id: 'a', at: day(1) },
    { id: 'b', at: day(2) },
    { id: 'c', at: day(2) },
    { id: 'd', at: day(3) },
    { id: 'e', at: day(4) },
  ];

  it('returns offset meta plus a cursor to continue from', async () => {
    const db = table(rows);
    const { rows: page, meta } = await findPage({
      query: { page: 1, pageSize: 2 },
      sort,
      where: {},
      ...db,
      sortValue: (row) => row.at,
    });

    expect(page.map((row) => row.id)).toEqual(['e', 'd']);
    expect(meta).toMatchObject({
      page: 1,
      total: 5,
      totalPages: 3,
      has_more: true,
    });
    expect(meta.next_cursor).toEqual(expect.any(String));
  });

  it('walks every row exactly once, counting only on the first page', async () => {
    const db = table(rows);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await findPage({
        query: { pageSize: 2, cursor },
        sort,
        where: {},
        ...db,
        sortValue: (row) => row.at,
      });
      seen.push(...result.rows.map((row) => row.id));
      // The first request is a normal page; later ones are keyset pages.
      expect(result.meta.total).toBe(cursor === undefined ? 5 : null);
      cursor = result.meta.next_cursor ?? undefined;
    } while (cursor !== undefined);

    expect(seen).toEqual(['e', 'd', 'c', 'b', 'a']);
    // Only the first (offset) page counts; keyset pages never do.
    expect(db.count).toHaveBeenCalledTimes(1);
  });

  it('reports the last page', async () => {
    const db = table(rows);
    const { meta } = await findPage({
      query: { page: 3, pageSize: 2 },
      sort,
      where: {},
      ...db,
      sortValue: (row) => row.at,
    });
    expect(meta).toMatchObject({ has_more: false, next_cursor: null });
  });
});

describe('cursor encoding', () => {
  it('round-trips the sort value and id', () => {
    const raw = encodeCursor(sort, day(2), 'c');
    expect(decodeCursor(raw, sort)).toEqual({ value: day(2), id: 'c' });
  });

  it.each([
    'not-base64-json',
    Buffer.from('{"f":"at"}').toString('base64url'),
    encodeCursor({ ...sort, order: 'asc' }, day(1), 'a'),
    encodeCursor({ ...sort, field: 'other' }, day(1), 'a'),
  ])('rejects %p for this sort', (raw) => {
    expect(() => decodeCursor(raw, sort)).toThrow(BadRequestException);
  });
});
