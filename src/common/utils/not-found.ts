import { NotFoundException } from '@nestjs/common';

/** Narrows a lookup result, mapping a missing row to `404 NOT_FOUND`. */
export function orNotFound<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new NotFoundException();
  }
  return value;
}
