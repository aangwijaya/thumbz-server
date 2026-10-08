import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PAYMENTS_QUEUE } from '../../infra/queue/queue.module';
import { APPLY_EVENT_JOB, PaymentsService } from './payments.service';

/** Retries payment events whose inline processing failed (worker process). */
@Processor(PAYMENTS_QUEUE, { concurrency: 4 })
export class PaymentsProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentsProcessor.name);

  constructor(private readonly payments: PaymentsService) {
    super();
  }

  async process(
    job: Job<{ eventId: string; reference: string }>,
  ): Promise<string> {
    if (job.name !== APPLY_EVENT_JOB)
      throw new Error(`unknown job ${job.name}`);
    return this.payments.apply(job.data.eventId, job.data.reference);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      `payment event ${job?.id} failed (attempt ${job?.attemptsMade}): ${error.message}`,
    );
  }
}
