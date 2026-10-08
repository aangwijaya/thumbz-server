import { NotFoundException } from '@nestjs/common';
import { orNotFound } from './not-found';

describe('orNotFound', () => {
  it('returns present values unchanged, including falsy ones', () => {
    const row = { id: 'a' };
    expect(orNotFound(row)).toBe(row);
    expect(orNotFound(0)).toBe(0);
    expect(orNotFound('')).toBe('');
  });

  it.each([null, undefined])('throws NotFoundException for %p', (value) => {
    expect(() => orNotFound(value)).toThrow(NotFoundException);
  });
});
