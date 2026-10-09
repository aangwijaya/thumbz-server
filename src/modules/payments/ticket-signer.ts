import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'THMZ1';

/**
 * Ticket QR payloads are `THMZ1.<code>.<mac>`: venue scanners verify the
 * HMAC offline-safe, so a guessed or edited code is rejected before any
 * database lookup.
 */
@Injectable()
export class TicketSigner {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('ticketSigningSecret') ?? '';
  }

  private mac(code: string): string {
    return createHmac('sha256', this.secret)
      .update(code)
      .digest('base64url')
      .slice(0, 22);
  }

  sign(code: string): string {
    return `${PREFIX}.${code}.${this.mac(code)}`;
  }

  /** The ticket code when the payload is genuine, else null. */
  verify(payload: string): string | null {
    const [prefix, code, mac] = payload.trim().split('.');
    if (prefix !== PREFIX || !code || !mac) return null;
    const expected = Buffer.from(this.mac(code));
    const received = Buffer.from(mac);
    return expected.length === received.length &&
      timingSafeEqual(expected, received)
      ? code
      : null;
  }
}
