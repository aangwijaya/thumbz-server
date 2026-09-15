-- CreateEnum
CREATE TYPE "ticket_order_status" AS ENUM ('pending', 'paid', 'cancelled', 'expired', 'failed');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('valid', 'used', 'void');

-- CreateTable
CREATE TABLE "match_ticket_configs" (
    "match_id" UUID NOT NULL,
    "venue_name" TEXT NOT NULL,
    "venue_city" TEXT,
    "price_usd" DECIMAL(10,2) NOT NULL,
    "quota_total" INTEGER NOT NULL,
    "sales_open_at" TIMESTAMP(3),
    "sales_close_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_ticket_configs_pkey" PRIMARY KEY ("match_id")
);

-- CreateTable
CREATE TABLE "ticket_orders" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_usd" DECIMAL(10,2) NOT NULL,
    "total_usd" DECIMAL(10,2) NOT NULL,
    "status" "ticket_order_status" NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL DEFAULT 'nowpayments',
    "provider_payment_id" TEXT,
    "invoice_url" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "ticket_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ticket_status" NOT NULL DEFAULT 'valid',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_orders_match_id_status_idx" ON "ticket_orders"("match_id", "status");

-- CreateIndex
CREATE INDEX "ticket_orders_user_id_created_at_idx" ON "ticket_orders"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_orders_provider_payment_id_key" ON "ticket_orders"("provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_code_key" ON "tickets"("code");

-- CreateIndex
CREATE INDEX "tickets_user_id_issued_at_idx" ON "tickets"("user_id", "issued_at" DESC);

-- CreateIndex
CREATE INDEX "tickets_match_id_idx" ON "tickets"("match_id");

-- AddForeignKey
ALTER TABLE "match_ticket_configs" ADD CONSTRAINT "match_ticket_configs_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_orders" ADD CONSTRAINT "ticket_orders_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_orders" ADD CONSTRAINT "ticket_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ticket_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Thumbz additions (plan §6.1) ----------------------------------------------

ALTER TABLE "match_ticket_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "match_ticket_configs" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "ticket_orders" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "tickets" FROM anon, authenticated;

ALTER TABLE "match_ticket_configs" ADD CONSTRAINT "match_ticket_configs_price_positive_check" CHECK ("price_usd" > 0);
ALTER TABLE "match_ticket_configs" ADD CONSTRAINT "match_ticket_configs_quota_positive_check" CHECK ("quota_total" >= 1);
ALTER TABLE "match_ticket_configs" ADD CONSTRAINT "match_ticket_configs_sales_window_check" CHECK ("sales_close_at" IS NULL OR "sales_open_at" IS NULL OR "sales_close_at" >= "sales_open_at");
ALTER TABLE "ticket_orders" ADD CONSTRAINT "ticket_orders_quantity_range_check" CHECK ("quantity" BETWEEN 1 AND 4);
ALTER TABLE "ticket_orders" ADD CONSTRAINT "ticket_orders_total_positive_check" CHECK ("total_usd" > 0);
ALTER TABLE "ticket_orders" ADD CONSTRAINT "ticket_orders_price_positive_check" CHECK ("unit_price_usd" > 0);
