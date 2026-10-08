import {
  decodeCursor,
  encodeCursor,
  keysetOrderBy,
  keysetWhere,
  SortSpec,
  SortValue,
} from './cursor';

/** Offset fields are null in cursor mode (no COUNT is run). */
export interface ListMeta {
  page: number | null;
  pageSize: number;
  total: number | null;
  totalPages: number | null;
  next_cursor: string | null;
  has_more: boolean;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
  cursor?: string;
}

interface FindArgs {
  where: Record<string, unknown>;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
  skip?: number;
  take: number;
}

/**
 * Runs a list query in one of two modes:
 * - offset (`page`): numbered pages with totals; also returns `next_cursor`
 *   so a client can switch to keyset paging after the first page;
 * - keyset (`cursor`): stable under concurrent inserts and O(pageSize)
 *   regardless of depth; skips the COUNT.
 * Fetches pageSize + 1 rows to learn `has_more` without a count.
 */
export async function findPage<Row extends { id: string }>(options: {
  query: PageQuery;
  sort: SortSpec;
  where: Record<string, unknown>;
  findMany: (args: FindArgs) => Promise<Row[]>;
  count: (where: Record<string, unknown>) => Promise<number>;
  sortValue: (row: Row) => SortValue;
}): Promise<{ rows: Row[]; meta: ListMeta }> {
  const { query, sort, where } = options;
  const pageSize = query.pageSize ?? 20;
  const orderBy = keysetOrderBy(sort);

  const nextCursor = (rows: Row[], hasMore: boolean): string | null => {
    const last = rows[rows.length - 1];
    return hasMore && last
      ? encodeCursor(sort, options.sortValue(last), last.id)
      : null;
  };

  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor, sort);
    const fetched = await options.findMany({
      where: { AND: [where, keysetWhere(sort, cursor)] },
      orderBy,
      take: pageSize + 1,
    });
    const hasMore = fetched.length > pageSize;
    const rows = fetched.slice(0, pageSize);
    return {
      rows,
      meta: {
        page: null,
        pageSize,
        total: null,
        totalPages: null,
        next_cursor: nextCursor(rows, hasMore),
        has_more: hasMore,
      },
    };
  }

  const page = query.page ?? 1;
  const [fetched, total] = await Promise.all([
    options.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
    }),
    options.count(where),
  ]);
  const hasMore = fetched.length > pageSize;
  const rows = fetched.slice(0, pageSize);
  return {
    rows,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      next_cursor: nextCursor(rows, hasMore),
      has_more: hasMore,
    },
  };
}
