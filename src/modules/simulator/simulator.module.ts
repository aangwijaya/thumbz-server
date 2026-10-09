import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { TicketsModule } from '../tickets/tickets.module';
import { LiveSimulatorService } from './live-simulator.service';

@Module({
  imports: [AdminModule, TicketsModule],
  providers: [LiveSimulatorService],
  exports: [LiveSimulatorService],
})
export class SimulatorModule {}
