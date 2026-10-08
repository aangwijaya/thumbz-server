/**
 * Prisma known-request error codes we translate into API errors.
 * https://www.prisma.io/docs/orm/reference/error-reference
 */
export const PRISMA_UNIQUE_VIOLATION = 'P2002';
export const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003';
export const PRISMA_RECORD_NOT_FOUND = 'P2025';
export const PRISMA_SERIALIZATION_FAILURE = 'P2034';

export function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null;
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return prismaErrorCode(error) === PRISMA_UNIQUE_VIOLATION;
}
