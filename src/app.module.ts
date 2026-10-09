import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { Redis } from 'ioredis';
import { AuthModule } from './common/auth/auth.module';
import { WriteThrottlerGuard } from './common/guards/write-throttler.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AppConfigModule } from './config/config.module';
import { CacheModule } from './infra/cache/cache.module';
import { EventsModule } from './infra/events/events.module';
import { LoggingModule } from './infra/logging/logging.module';
import { MetricsModule } from './infra/metrics/metrics.module';
import { REDIS } from './infra/redis/redis.constants';
import { RedisModule } from './infra/redis/redis.module';
import { RevalidationModule } from './infra/revalidation/revalidation.module';
import { AdminModule } from './modules/admin/admin.module';
import { CommentsModule } from './modules/comments/comments.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { HealthModule } from './modules/health/health.module';
import { HistoryModule } from './modules/history/history.module';
import { HomeModule } from './modules/home/home.module';
import { MatchesModule } from './modules/matches/matches.module';
import { PushModule } from './modules/push/push.module';
import { MediaModule } from './modules/media/media.module';
import { PlayersModule } from './modules/players/players.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { JobsApiModule } from './modules/jobs/jobs.module';
import { QueueModule } from './infra/queue/queue.module';
import { SearchModule } from './modules/search/search.module';
import { TeamsModule } from './modules/teams/teams.module';
import { TournamentsModule } from './modules/tournaments/tournaments.module';
import { UsersModule } from './modules/users/users.module';
import { VideosModule } from './modules/videos/videos.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    MetricsModule,
    RedisModule,
    EventsModule,
    CacheModule,
    RevalidationModule,
    AuthModule,
    PrismaModule,
    HealthModule,
    UsersModule,
    FavoritesModule,
    HistoryModule,
    TournamentsModule,
    TeamsModule,
    PlayersModule,
    MatchesModule,
    VideosModule,
    SearchModule,
    HomeModule,
    AdminModule,
    CommentsModule,
    TicketsModule,
    RealtimeModule,
    MediaModule,
    PushModule,
    QueueModule.forRoot(),
    JobsApiModule,
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      // Shared counters across instances when Redis is available.
      useFactory: (redis: Redis | null) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        storage: redis ? new ThrottlerStorageRedisService(redis) : undefined,
      }),
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: WriteThrottlerGuard,
    },
  ],
})
export class AppModule {}
