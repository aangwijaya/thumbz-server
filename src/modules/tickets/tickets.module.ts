import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import {
  AdminTicketsController,
  MatchTicketsController,
  MeTicketsController,
} from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [PaymentsModule],
  controllers: [
    MatchTicketsController,
    MeTicketsController,
    AdminTicketsController,
  ],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
