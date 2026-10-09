# 0003 — Payments behind one provider interface, webhooks through an inbox

**Status:** accepted (2026-10)

## Context
Ticket checkout must take crypto (NOWPayments) and Indonesian rails (QRIS and
bank virtual accounts via Xendit). The first version could issue tickets twice
on concurrent webhooks, accept underpayments and oversell on late payments.

## Decision
- `PaymentProvider` interface (`createPayment`, `verifyWebhook`,
  `parseWebhook`, `fetchStatus`); `PaymentRouter` picks the provider per
  method and only offers configured, priced methods. A sandbox provider
  stands in for demos and tests.
- Webhook → verify signature → insert into `payment_events` (**inbox**, unique
  event key = dedupe and audit) → apply. Applying locks the payment and order
  rows (`SELECT … FOR UPDATE`), checks amount and currency, and asks a **pure
  state machine** (`order-state.ts`) what to do; tickets are issued in the same
  transaction, keyed `(order_id, seq)`.
- Failed applies retry from a queue with backoff; a reconciliation job polls
  providers for missed webhooks.
- `Idempotency-Key` on order creation: the response is stored in Redis for
  24 h; a retry replays it, an in-flight duplicate gets `409`.

## Consequences
- Adding a provider is one class plus routing; order logic never changes.
- A late payment without quota becomes `refund_required` instead of an
  oversold ticket.
