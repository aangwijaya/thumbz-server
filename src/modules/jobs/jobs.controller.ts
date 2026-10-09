import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, OnModuleInit, Optional } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Queue } from 'bullmq';
import { Gauge } from 'prom-client';
import { Roles } from '../../common/decorators/roles.decorator';
import { MAINTENANCE_QUEUE } from '../../infra/queue/queue.module';
import { MetricsService } from '../../infra/metrics/metrics.service';

const STATES = ['waiting', 'active', 'delayed', 'completed', 'failed'] as const;

export interface JobsOverview {
  enabled: boolean;
  counts: Partial<Record<(typeof STATES)[number], number>>;
  schedulers: Array<{ id: string; every: number | null; next: number | null }>;
  recent_failures: Array<{
    id: string | undefined;
    name: string;
    reason: string;
    attempts: number;
    failed_at: number | null;
  }>;
}

/** Admin view of background jobs (JSON instead of an extra dashboard UI). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/jobs')
export class JobsController implements OnModuleInit {
  constructor(
    private readonly metrics: MetricsService,
    @Optional() @InjectQueue(MAINTENANCE_QUEUE) private readonly queue?: Queue,
  ) {}

  onModuleInit(): void {
    const queue = this.queue;
    const registry = this.metrics.registry;
    if (!queue || registry.getSingleMetric('thumbz_queue_jobs')) return;
    // Queue depth, read from Redis on every Prometheus scrape.
    new Gauge({
      name: 'thumbz_queue_jobs',
      help: 'Maintenance queue jobs per state',
      labelNames: ['state'],
      registers: [registry],
      async collect() {
        const counts = await queue.getJobCounts(...STATES).catch(() => null);
        for (const state of STATES) this.set({ state }, counts?.[state] ?? 0);
      },
    });
  }

  @Roles('admin')
  @Get()
  async overview(): Promise<{ data: JobsOverview }> {
    if (!this.queue) {
      return {
        data: {
          enabled: false,
          counts: {},
          schedulers: [],
          recent_failures: [],
        },
      };
    }
    const [counts, schedulers, failed] = await Promise.all([
      this.queue.getJobCounts(...STATES),
      this.queue.getJobSchedulers(),
      this.queue.getFailed(0, 9),
    ]);
    return {
      data: {
        enabled: true,
        counts,
        schedulers: schedulers.map((scheduler) => ({
          id: scheduler.key,
          every: scheduler.every ? Number(scheduler.every) : null,
          next: scheduler.next ?? null,
        })),
        recent_failures: failed.map((job) => ({
          id: job.id,
          name: job.name,
          reason: job.failedReason,
          attempts: job.attemptsMade,
          failed_at: job.finishedOn ?? null,
        })),
      },
    };
  }
}
