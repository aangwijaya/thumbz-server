import { BadRequestException } from '@nestjs/common';

export type SortOrder = 'asc' | 'desc';
export type SortType = 'date' | 'number' | 'string';
export type SortValue = Date | number | string;

export interface SortSpec {
  field: string;
  order: SortOrder;
  type: SortType;
}

interface CursorPayload {
  /** Sort field and order the cursor was issued for. */
  f: string;
  o: SortOrder;
  /** Sort value of the last row (dates as ISO strings). */
  v: string | number;
  id: string;
}

/**
 * Opaque keyset cursor: base64url JSON of the last row's sort value and id,
 * bound to the sort it was issued for so it cannot be replayed against a
 * different ordering.
 */
export function encodeCursor(
  sort: SortSpec,
  value: SortValue,
  id: string,
): string {
  const payload: CursorPayload = {
    f: sort.field,
    o: sort.order,
    v: value instanceof Date ? value.toISOString() : value,
    id,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function invalidCursor(): BadRequestException {
  return new BadRequestException({
    details: [{ field: 'cursor', message: 'cursor is invalid or expired' }],
  });
}

export function decodeCursor(
  raw: string,
  sort: SortSpec,
): { value: SortValue; id: string } {
  let payload: Partial<CursorPayload>;
  try {
    payload = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<CursorPayload>;
  } catch {
    throw invalidCursor();
  }
  if (
    payload?.f !== sort.field ||
    payload.o !== sort.order ||
    typeof payload.id !== 'string' ||
    payload.v === undefined
  ) {
    throw invalidCursor();
  }
  switch (sort.type) {
    case 'date': {
      const date = new Date(payload.v);
      if (typeof payload.v !== 'string' || Number.isNaN(date.getTime())) {
        throw invalidCursor();
      }
      return { value: date, id: payload.id };
    }
    case 'number':
      if (typeof payload.v !== 'number' || !Number.isFinite(payload.v)) {
        throw invalidCursor();
      }
      return { value: payload.v, id: payload.id };
    case 'string':
      if (typeof payload.v !== 'string') {
        throw invalidCursor();
      }
      return { value: payload.v, id: payload.id };
  }
}

/**
 * Rows strictly after the cursor in (sort field, id) order:
 * `field < v OR (field = v AND id < cursorId)` for descending sorts.
 */
export function keysetWhere(
  sort: SortSpec,
  cursor: { value: SortValue; id: string },
): Record<string, unknown> {
  const op = sort.order === 'desc' ? 'lt' : 'gt';
  return {
    OR: [
      { [sort.field]: { [op]: cursor.value } },
      { [sort.field]: cursor.value, id: { [op]: cursor.id } },
    ],
  };
}

/** Deterministic ordering: the sort field, then id as a tie-breaker. */
export function keysetOrderBy(
  sort: SortSpec,
): Array<Record<string, SortOrder>> {
  return [{ [sort.field]: sort.order }, { id: sort.order }];
}
