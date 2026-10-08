import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MAINTENANCE_QUEUE } from '../../infra/queue/queue.module';
import { LiveSimulatorService } from '../simulator/live-simulator.service';
import { TicketsService } from '../tickets/tickets.service';
import { Jobs } from './jobs.constants';

/** Runs scheduled maintenance in the worker process (never in the API). */
@Processor(MAINTENANCE_QUEUE, { concurrency: 2 })
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly tickets: TicketsService,
    private readonly simulator: LiveSimulatorService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case Jobs.expireHolds: {
        const expired = await this.tickets.expireStaleHolds();
        if (expired > 0) this.logger.log(`expired ${expired} ticket holds`);
        return { expired };
      }
      case Jobs.liveSimulator:
        await this.simulator.step();
        return null;
      default:
        throw new Error(`unknown job ${job.name}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      `job ${job?.name} (${job?.id}) failed after ${job?.attemptsMade} attempts: ${error.message}`,
    );
  }
}
