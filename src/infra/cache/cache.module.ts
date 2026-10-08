import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CacheInvalidationListener } from './cache-invalidation.listener';
import { CacheService } from './cache.service';
import { HttpCacheInterceptor } from './http-cache.interceptor';

@Global()
@Module({
  providers: [
    CacheService,
    CacheInvalidationListener,
    { provide: APP_INTERCEPTOR, useClass: HttpCacheInterceptor },
  ],
  exports: [CacheService],
})
export class CacheModule {}
