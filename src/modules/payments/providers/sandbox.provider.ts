import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { METHODS } from '../payment-methods';
import {
  CreatedPayment,
  CreatePaymentInput,
  NormalizedEvent,
  PaymentProvider,
} from './payment-provider';

/** EMV-style CRC16-CCITT used by QRIS payloads (so the demo QR is well-formed). */
function crc16(payload: string): string {
  let crc = 0xffff;
  for (const char of payload) {
    crc ^= char.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(tag: string, value: string): string {
  return `${tag}${String(value.length).padStart(2, '0')}${value}`;
}

/**
 * Demo/test gateway (PAYMENTS_SANDBOX=true): returns realistic-looking QRIS
 * strings, VA numbers and a crypto checkout link without any external
 * account, and "pays" through the same webhook pipeline via simulate().
 * Never enabled in real production.
 */
@Injectable()
export class SandboxProvider implements PaymentProvider {
  readonly id = 'sandbox' as const;
  private readonly enabled: boolean;
  private readonly frontendUrl: string;

  constructor(config: ConfigService) {
    this.enabled = config.get<boolean>('paymentsSandbox') ?? false;
    this.frontendUrl =
      config.get<string>('frontendUrl') ?? 'http://localhost:3000';
  }

  isConfigured(): boolean {
    return this.enabled;
  }

  /** Stands in for every method (only when no real gateway serves it). */
  supports(): boolean {
    return true;
  }

  create(input: CreatePaymentInput): Promise<CreatedPayment> {
    const info = METHODS[input.method];
    const digits = BigInt(`0x${input.paymentId.replace(/-/g, '').slice(0, 15)}`)
      .toString()
      .padStart(14, '0')
      .slice(-14);
    if (input.method === 'qris') {
      const body =
        tlv('00', '01') +
        tlv('01', '12') +
        tlv('26', tlv('00', 'ID.THUMBZ.SANDBOX') + tlv('01', input.paymentId)) +
        tlv('52', '7922') +
        tlv('53', '360') +
        tlv('54', String(Math.round(input.amount))) +
        tlv('58', 'ID') +
        tlv('59', 'THUMBZ SANDBOX') +
        tlv('60', 'JAKARTA') +
        '6304';
      return Promise.resolve({
        providerReference: `sbx-${input.paymentId}`,
        action: { kind: 'qr', qr_string: body + crc16(body) },
      });
    }
    if (info.bank) {
      return Promise.resolve({
        providerReference: `sbx-${input.paymentId}`,
        action: { kind: 'va', va_number: `8808${digits}`, bank: info.bank },
      });
    }
    return Promise.resolve({
      providerReference: `sbx-${input.paymentId}`,
      action: {
        kind: 'redirect',
        url: `${this.frontendUrl}/me/orders/${input.orderId}?sandbox=1`,
      },
    });
  }

  parseWebhook(): NormalizedEvent | null {
    throw new BadRequestException('the sandbox has no webhooks');
  }

  /** Builds the event a real gateway would send after a successful payment. */
  paidEvent(payment: {
    id: string;
    amount: number;
    currency: string;
  }): NormalizedEvent {
    return {
      eventKey: `sandbox:${payment.id}:paid`,
      reference: payment.id,
      providerReference: `sbx-${payment.id}`,
      status: 'succeeded',
      amount: payment.amount,
      currency: payment.currency,
      payload: { simulated: true },
    };
  }
}
