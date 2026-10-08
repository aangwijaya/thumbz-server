import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { CacheModule } from './infra/cache/cache.module';
import { EventsModule } from './infra/events/events.module';
import { LoggingModule } from './infra/logging/logging.module';
import { MetricsModule } from './infra/metrics/metrics.module';
import { QueueModule } from './infra/queue/queue.module';
import { RedisModule } from './infra/redis/redis.module';
import { RevalidationModule } from './infra/revalidation/revalidation.module';
import { JobsWorkerModule } from './modules/jobs/jobs.module';
import { RealtimeEmitterModule } from './modules/realtime/realtime.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * The worker: no HTTP server. Runs scheduled jobs; domain events it emits
 * still invalidate caches, revalidate the frontend and reach browsers
 * (through Redis to the API instances' sockets).
 */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    MetricsModule,
    RedisModule,
    EventsModule,
    CacheModule,
    RevalidationModule,
    PrismaModule,
    QueueModule.forRoot(),
    RealtimeEmitterModule,
    JobsWorkerModule,
  ],
})
export class WorkerModule {}
