import { decide, DecisionInput } from './order-state';

const base: DecisionInput = {
  order: 'pending',
  payment: 'pending',
  event: 'succeeded',
  amountOk: true,
  quotaAvailable: true,
};

describe('order state machine', () => {
  it('pays a pending order and issues tickets', () => {
    expect(decide(base)).toMatchObject({
      payment: 'succeeded',
      order: 'paid',
      issueTickets: true,
      cancelOtherAttempts: true,
      outcome: 'paid',
    });
  });

  it('ignores a replayed success', () => {
    expect(decide({ ...base, payment: 'succeeded' })).toMatchObject({
      payment: null,
      order: null,
      issueTickets: false,
      outcome: 'duplicate',
    });
  });

  it('never issues tickets for an underpayment', () => {
    expect(decide({ ...base, amountOk: false })).toMatchObject({
      payment: 'failed',
      order: null,
      issueTickets: false,
      outcome: 'amount_mismatch',
    });
  });

  it.each(['expired', 'cancelled', 'failed'] as const)(
    'honors a late payment on a %s order while seats remain',
    (order) => {
      expect(decide({ ...base, order })).toMatchObject({
        order: 'paid',
        issueTickets: true,
        outcome: 'late_paid',
      });
    },
  );

  it('flags a late payment for refund instead of overselling', () => {
    expect(
      decide({ ...base, order: 'expired', quotaAvailable: false }),
    ).toMatchObject({
      payment: 'succeeded',
      order: 'refund_required',
      issueTickets: false,
      outcome: 'refund_required',
    });
  });

  it('flags a second payment on an already paid order', () => {
    expect(decide({ ...base, order: 'paid' })).toMatchObject({
      payment: 'succeeded',
      order: null,
      issueTickets: false,
      outcome: 'duplicate_payment',
    });
  });

  it('voids tickets when a paid payment is refunded', () => {
    expect(
      decide({
        ...base,
        event: 'refunded',
        order: 'paid',
        payment: 'succeeded',
      }),
    ).toMatchObject({
      order: 'failed',
      voidTickets: true,
      outcome: 'refunded',
    });
  });

  it.each([
    ['failed', 'failed', 'payment_failed'],
    ['expired', 'expired', 'payment_expired'],
  ] as const)(
    'marks a pending attempt %s but keeps the order hold',
    (event, payment, outcome) => {
      expect(decide({ ...base, event })).toMatchObject({
        payment,
        order: null,
        outcome,
      });
    },
  );

  it('does not let a late failure undo a success', () => {
    expect(
      decide({ ...base, event: 'failed', payment: 'succeeded', order: 'paid' }),
    ).toMatchObject({
      payment: null,
      order: null,
      outcome: 'ignored',
    });
  });

  it('waits on pending notifications', () => {
    expect(decide({ ...base, event: 'pending' }).outcome).toBe('pending');
  });
});
