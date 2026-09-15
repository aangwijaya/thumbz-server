import { Module } from '@nestjs/common';
import { NowPaymentsClient } from './nowpayments.client';
import {
  AdminTicketsController,
  MatchTicketsController,
  MeTicketsController,
  PaymentWebhooksController,
} from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  controllers: [
    MatchTicketsController,
    MeTicketsController,
    AdminTicketsController,
    PaymentWebhooksController,
  ],
  providers: [TicketsService, NowPaymentsClient],
  exports: [TicketsService],
})
export class TicketsModule {}
