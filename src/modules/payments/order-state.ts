import type { payment_status, ticket_order_status } from '@prisma/client';
import type { NormalizedStatus } from './providers/payment-provider';

export interface DecisionInput {
  order: ticket_order_status;
  payment: payment_status;
  event: NormalizedStatus;
  /** The provider reported at least the expected amount, in the expected currency. */
  amountOk: boolean;
  /** Enough quota left to honor this order's quantity now (late payments). */
  quotaAvailable: boolean;
}

export interface Decision {
  payment: payment_status | null;
  order: ticket_order_status | null;
  issueTickets: boolean;
  voidTickets: boolean;
  /** Other pending attempts of the order stop being payable. */
  cancelOtherAttempts: boolean;
  /** Recorded on the inbox event for audit/support. */
  outcome: string;
  failureReason?: string;
}

const NOOP = (outcome: string): Decision => ({
  payment: null,
  order: null,
  issueTickets: false,
  voidTickets: false,
  cancelOtherAttempts: false,
  outcome,
});

/**
 * The single place deciding what a payment notification does to an order.
 * Pure: unit-tested exhaustively; the service applies the decision inside a
 * transaction holding row locks on the payment and the order.
 */
export function decide(input: DecisionInput): Decision {
  const { order, payment, event } = input;

  if (event === 'pending') return NOOP('pending');

  if (event === 'succeeded') {
    if (payment === 'succeeded') return NOOP('duplicate');
    if (!input.amountOk) {
      // Underpaid / wrong currency: never issue tickets; support follows up.
      return {
        ...NOOP('amount_mismatch'),
        payment: 'failed',
        failureReason: 'amount_mismatch',
      };
    }
    if (order === 'paid') {
      // Another attempt already paid this order: money in twice.
      return {
        ...NOOP('duplicate_payment'),
        payment: 'succeeded',
        failureReason: 'duplicate_payment_refund_required',
      };
    }
    if (order === 'pending') {
      return {
        payment: 'succeeded',
        order: 'paid',
        issueTickets: true,
        voidTickets: false,
        cancelOtherAttempts: true,
        outcome: 'paid',
      };
    }
    if (order === 'refund_required') {
      return { ...NOOP('refund_required'), payment: 'succeeded' };
    }
    // expired / cancelled / failed: the hold is gone. Honor the payment only
    // if the seats are still there; otherwise never oversell.
    if (input.quotaAvailable) {
      return {
        payment: 'succeeded',
        order: 'paid',
        issueTickets: true,
        voidTickets: false,
        cancelOtherAttempts: true,
        outcome: 'late_paid',
      };
    }
    return {
      ...NOOP('refund_required'),
      payment: 'succeeded',
      order: 'refund_required',
    };
  }

  if (event === 'refunded') {
    if (payment === 'succeeded' && order === 'paid') {
      return {
        payment: 'failed',
        order: 'failed',
        issueTickets: false,
        voidTickets: true,
        cancelOtherAttempts: false,
        outcome: 'refunded',
        failureReason: 'refunded',
      };
    }
    return NOOP('ignored');
  }

  // failed / expired: only a still-pending attempt changes; the order keeps
  // its hold so the buyer can retry with another method.
  if (payment !== 'pending') return NOOP('ignored');
  return {
    ...NOOP(event === 'failed' ? 'payment_failed' : 'payment_expired'),
    payment: event === 'failed' ? 'failed' : 'expired',
  };
}
