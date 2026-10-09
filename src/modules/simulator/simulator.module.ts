import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { LiveSimulatorService } from './live-simulator.service';

@Module({
  imports: [AdminModule],
  providers: [LiveSimulatorService],
  exports: [LiveSimulatorService],
})
export class SimulatorModule {}
