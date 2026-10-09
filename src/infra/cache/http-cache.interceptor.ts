import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, lastValueFrom, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CacheService } from './cache.service';
import { CACHED_KEY, CachedOptions } from './cached.decorator';

type CacheRequest = Request & { user?: CurrentUser };

/** Stable key: route path plus query params sorted by name. */
export function cacheKeyFor(
  path: string,
  query: Record<string, unknown>,
  userId?: string,
): string {
  const params = new URLSearchParams();
  for (const name of Object.keys(query).sort()) {
    const value = query[name];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null && typeof item !== 'object') {
        params.append(name, String(item as string | number | boolean));
      }
    }
  }
  const search = params.toString();
  const base = search ? `${path}?${search}` : path;
  return userId ? `${base}#u:${userId}` : base;
}

@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const http = context.switchToHttp();
    const request = http.getRequest<CacheRequest>();
    const response = http.getResponse<Response>();
    const options = this.reflector.get<CachedOptions | undefined>(
      CACHED_KEY,
      context.getHandler(),
    );

    if (!options || request.method !== 'GET') {
      response.setHeader('Cache-Control', 'no-store');
      return next.handle();
    }

    const user = request.user;
    if (user && !options.perUser) {
      // A shared response must not depend on who asked; nothing to do here
      // beyond never letting a CDN store an authenticated request.
      response.setHeader('Cache-Control', 'private, no-store');
      return next.handle();
    }

    const swr = options.staleWhileRevalidate ?? options.ttl * 2;
    response.setHeader(
      'Cache-Control',
      user
        ? 'private, no-store'
        : `public, max-age=0, s-maxage=${options.ttl}, stale-while-revalidate=${swr}`,
    );
    response.setHeader('Vary', 'Authorization');

    const key = cacheKeyFor(request.path, request.query, user?.sub);
    const tags = options.tags?.(request.params as Record<string, string>) ?? [];
    return from(
      this.cache.getOrSet(
        key,
        options.ttl,
        () => lastValueFrom(next.handle() as Observable<unknown>),
        tags,
      ),
    ).pipe(
      map(({ value, result }) => {
        response.setHeader('X-Cache', result.toUpperCase());
        return value;
      }),
    );
  }
}
