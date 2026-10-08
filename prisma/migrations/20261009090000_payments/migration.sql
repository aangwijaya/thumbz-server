-- Multi-provider payments: payment attempts per order, a webhook inbox,
-- IDR pricing, and per-order ticket sequence numbers.

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('nowpayments', 'xendit', 'sandbox');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('crypto', 'qris', 'va_bca', 'va_bni', 'va_bri', 'va_mandiri', 'va_permata');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'succeeded', 'failed', 'expired', 'cancelled');

-- AlterEnum
ALTER TYPE "ticket_order_status" ADD VALUE 'refund_required';

-- DropIndex
DROP INDEX "tickets_order_id_idx";

-- AlterTable
ALTER TABLE "match_ticket_configs" ADD COLUMN     "price_idr" INTEGER;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "seq" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "method" "payment_method" NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "provider_reference" TEXT,
    "action" JSONB,
    "failure_reason" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "event_key" TEXT NOT NULL,
    "payment_id" UUID,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(14,2),
    "currency" TEXT,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_order_id_created_at_idx" ON "payments"("order_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "payment_events_processed_at_idx" ON "payment_events"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_event_key_key" ON "payment_events"("provider", "event_key");


-- Backfill ticket sequence numbers per order before making them unique.
UPDATE "tickets" t
SET "seq" = numbered.rn
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "order_id" ORDER BY "issued_at", "id") AS rn
  FROM "tickets"
) AS numbered
WHERE t."id" = numbered."id";

-- (order_id, seq) unique: issuing the same order twice can never create
-- duplicate tickets, whatever the concurrency.
CREATE UNIQUE INDEX "tickets_order_id_seq_key" ON "tickets"("order_id", "seq");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ticket_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Existing NOWPayments orders become payment rows. The payment id equals the
-- order id because that is the order_id NOWPayments echoes in its IPNs, so
-- invoices already in flight still resolve.
INSERT INTO "payments" (
  "id", "order_id", "provider", "method", "currency", "amount", "status",
  "provider_reference", "action", "expires_at", "paid_at", "created_at", "updated_at"
)
SELECT
  o."id", o."id", 'nowpayments', 'crypto', 'USD', o."total_usd",
  (CASE o."status"::text
    WHEN 'paid' THEN 'succeeded'
    WHEN 'pending' THEN 'pending'
    WHEN 'expired' THEN 'expired'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'failed'
  END)::"payment_status",
  o."provider_payment_id",
  jsonb_build_object('kind', 'redirect', 'url', o."invoice_url"),
  o."expires_at", o."paid_at", o."created_at", CURRENT_TIMESTAMP
FROM "ticket_orders" o
WHERE o."invoice_url" IS NOT NULL;

-- Same posture as every business table: RLS on, no direct grants; the API
-- (service role) enforces access.
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "payments" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "payment_events" FROM anon, authenticated;
