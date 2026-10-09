import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PushModule } from '../push/push.module';
import { SimulatorModule } from '../simulator/simulator.module';
import { TicketsModule } from '../tickets/tickets.module';
import { JobsController } from './jobs.controller';
import { JobsScheduler } from './jobs.scheduler';
import { MaintenanceProcessor } from './maintenance.processor';

/** API side: inspect jobs; producers enqueue through the global queue. */
@Module({ controllers: [JobsController] })
export class JobsApiModule {}

/** Worker side: schedules and processes the maintenance jobs. */
@Module({
  imports: [TicketsModule, SimulatorModule, PaymentsModule, PushModule],
  providers: [MaintenanceProcessor, JobsScheduler],
})
export class JobsWorkerModule {}
