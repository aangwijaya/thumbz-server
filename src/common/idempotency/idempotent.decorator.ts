import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { IdempotencyInterceptor } from './idempotency.interceptor';

export const IDEMPOTENT_KEY = 'thumbz:idempotent';

/**
 * Makes a POST safe to retry: with an `Idempotency-Key` header, the first
 * response is stored for 24 h and replayed for the same key and body.
 */
export const Idempotent = () =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, true),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: 'Idempotency-Key',
      required: false,
      description:
        '8–128 chars [A-Za-z0-9_-]; retries with the same key replay the first response',
    }),
  );
