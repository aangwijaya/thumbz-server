import { Injectable } from '@nestjs/common';
import type { payment_method, payment_provider } from '@prisma/client';
import { METHOD_ORDER, METHODS, PaymentFamily } from './payment-methods';
import { NowPaymentsProvider } from './providers/nowpayments.provider';
import { PaymentProvider } from './providers/payment-provider';
import { SandboxProvider } from './providers/sandbox.provider';
import { XenditProvider } from './providers/xendit.provider';

export interface MethodOption {
  method: payment_method;
  label: string;
  family: PaymentFamily;
  currency: 'USD' | 'IDR';
  /** Price of one ticket in `currency`. */
  unit_amount: number;
  bank: string | null;
  provider: payment_provider;
}

/** Picks the gateway for each method; the sandbox stands in when enabled. */
@Injectable()
export class PaymentRouter {
  private readonly providers: PaymentProvider[];

  constructor(
    private readonly nowpayments: NowPaymentsProvider,
    private readonly xendit: XenditProvider,
    private readonly sandbox: SandboxProvider,
  ) {
    this.providers = [nowpayments, xendit, sandbox];
  }

  providerFor(method: payment_method): PaymentProvider | null {
    return (
      [this.nowpayments, this.xendit].find(
        (provider) => provider.isConfigured() && provider.supports(method),
      ) ?? (this.sandbox.isConfigured() ? this.sandbox : null)
    );
  }

  byId(id: payment_provider): PaymentProvider {
    return this.providers.find((provider) => provider.id === id)!;
  }

  /** Methods a buyer can use for a ticket priced `priceUsd` / `priceIdr`. */
  methodsFor(price: { usd: number; idr: number | null }): MethodOption[] {
    const options: MethodOption[] = [];
    for (const method of METHOD_ORDER) {
      const info = METHODS[method];
      const provider = this.providerFor(method);
      if (!provider) continue;
      const unit = info.family === 'crypto' ? price.usd : price.idr;
      if (unit === null || unit < info.minAmount) continue;
      options.push({
        method,
        label: info.label,
        family: info.family,
        currency: info.currency,
        unit_amount: unit,
        bank: info.bank ?? null,
        provider: provider.id,
      });
    }
    return options;
  }
}
