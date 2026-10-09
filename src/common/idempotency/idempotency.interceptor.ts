import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { from, Observable, of } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { REDIS } from '../../infra/redis/redis.constants';
import { BusinessRuleException } from '../errors/business-rule.exception';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const TTL_SECONDS = 24 * 60 * 60;
/** How long a crashed request may block its key. */
const IN_FLIGHT_SECONDS = 60;

interface Stored {
  state: 'pending' | 'done';
  fingerprint: string;
  status?: number;
  body?: unknown;
}

type IdemRequest = Request & { user?: { sub?: string } };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<IdemRequest>();
    const response = http.getResponse<Response>();
    const header = request.headers['idempotency-key'];
    if (
      header === undefined ||
      this.redis === null ||
      this.redis.status !== 'ready'
    ) {
      return next.handle();
    }
    if (typeof header !== 'string' || !KEY_PATTERN.test(header)) {
      throw new BusinessRuleException(
        'Idempotency-Key must be 8-128 characters of [A-Za-z0-9_-]',
      );
    }

    const owner = request.user?.sub ?? request.ip ?? 'anonymous';
    const key = `thumbz:idem:${owner}:${request.method}:${request.path}:${header}`;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(request.body ?? null))
      .digest('hex');
    const redis = this.redis;

    return from(
      redis.set(
        key,
        JSON.stringify({ state: 'pending', fingerprint } satisfies Stored),
        'EX',
        IN_FLIGHT_SECONDS,
        'NX',
      ),
    ).pipe(
      mergeMap((claimed) => {
        if (claimed === 'OK') {
          return next.handle().pipe(
            mergeMap((body: unknown) =>
              from(
                redis.set(
                  key,
                  JSON.stringify({
                    state: 'done',
                    fingerprint,
                    status: response.statusCode,
                    body,
                  } satisfies Stored),
                  'EX',
                  TTL_SECONDS,
                ),
              ).pipe(mergeMap(() => of(body))),
            ),
            // Failures are not cached: the client may retry with the same key.
            catchError((error: unknown) =>
              from(redis.del(key)).pipe(
                mergeMap(() => {
                  throw error;
                }),
              ),
            ),
          );
        }
        return from(redis.get(key)).pipe(
          mergeMap((raw) => {
            const stored = raw ? (JSON.parse(raw) as Stored) : null;
            if (!stored || stored.state === 'pending') {
              throw new ConflictException(
                'A request with this Idempotency-Key is in progress',
              );
            }
            if (stored.fingerprint !== fingerprint) {
              throw new BusinessRuleException(
                'Idempotency-Key was already used with a different request',
              );
            }
            response.status(stored.status ?? 200);
            response.setHeader('Idempotent-Replayed', 'true');
            return of(stored.body);
          }),
        );
      }),
    );
  }
}
