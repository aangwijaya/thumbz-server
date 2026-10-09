import { Module } from '@nestjs/common';
import { PaymentRouter } from './payment-router';
import {
  PaymentSimulationController,
  PaymentWebhooksController,
} from './payments.controller';
import { PaymentsProcessor } from './payments.processor';
import { PaymentsService } from './payments.service';
import { NowPaymentsProvider } from './providers/nowpayments.provider';
import { SandboxProvider } from './providers/sandbox.provider';
import { XenditProvider } from './providers/xendit.provider';
import { TicketSigner } from './ticket-signer';

@Module({
  controllers: [PaymentWebhooksController, PaymentSimulationController],
  providers: [
    NowPaymentsProvider,
    XenditProvider,
    SandboxProvider,
    PaymentRouter,
    PaymentsService,
    TicketSigner,
  ],
  exports: [PaymentsService, PaymentRouter, TicketSigner],
})
export class PaymentsModule {}

/** Worker: retries queued payment events. */
@Module({
  imports: [PaymentsModule],
  providers: [PaymentsProcessor],
})
export class PaymentsWorkerModule {}
