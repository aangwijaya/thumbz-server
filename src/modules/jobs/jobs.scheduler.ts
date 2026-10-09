import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { MAINTENANCE_QUEUE } from '../../infra/queue/queue.module';
import {
  EXPIRE_HOLDS_EVERY_MS,
  Jobs,
  MATCH_REMINDERS_EVERY_MS,
  RECONCILE_PAYMENTS_EVERY_MS,
} from './jobs.constants';

/**
 * Declares the recurring jobs. Job schedulers are idempotent upserts stored
 * in Redis, so any number of workers can start: each job still runs once per
 * interval (BullMQ hands every occurrence to exactly one worker).
 */
@Injectable()
export class JobsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobsScheduler.name);

  constructor(
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      Jobs.expireHolds,
      { every: EXPIRE_HOLDS_EVERY_MS },
      { name: Jobs.expireHolds },
    );

    await this.queue.upsertJobScheduler(
      Jobs.reconcilePayments,
      { every: RECONCILE_PAYMENTS_EVERY_MS },
      { name: Jobs.reconcilePayments },
    );

    if (this.config.get('vapid')) {
      await this.queue.upsertJobScheduler(
        Jobs.matchReminders,
        { every: MATCH_REMINDERS_EVERY_MS },
        // The next sweep catches anything missed; never retry into duplicates.
        {
          name: Jobs.matchReminders,
          opts: { attempts: 1, removeOnComplete: true, removeOnFail: 50 },
        },
      );
    } else {
      await this.queue.removeJobScheduler(Jobs.matchReminders);
    }

    if (this.config.get<boolean>('liveSimulator')) {
      const every = this.config.get<number>('liveSimulatorIntervalMs') ?? 5_000;
      await this.queue.upsertJobScheduler(
        Jobs.liveSimulator,
        { every },
        // A missed tick is worthless later: no retries, no history.
        {
          name: Jobs.liveSimulator,
          opts: { attempts: 1, removeOnComplete: true, removeOnFail: 50 },
        },
      );
      this.logger.log(`live simulator scheduled every ${every} ms`);
    } else {
      await this.queue.removeJobScheduler(Jobs.liveSimulator);
    }
  }
}
