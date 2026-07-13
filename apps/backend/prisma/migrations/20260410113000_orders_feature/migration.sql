CREATE TABLE IF NOT EXISTS "orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text,
  "app_id" uuid,
  "contact_id" uuid,
  "conversation_id" uuid,
  "order_number" bigserial NOT NULL,
  "order_status" varchar(50) DEFAULT 'pending',
  "payment_type" varchar(50) DEFAULT 'one_time_payment',
  "payment_method" varchar(50) DEFAULT 'custom',
  "notes" text,
  "address" text,
  "subtotal" numeric(18,2) DEFAULT 0,
  "discount" numeric(18,2) DEFAULT 0,
  "shipping_fee" numeric(18,2) DEFAULT 0,
  "grand_total" numeric(18,2) DEFAULT 0,
  "business_bank_account" jsonb,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "fk_orders_org" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL,
  CONSTRAINT "fk_orders_app" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "idx_orders_app_id" ON "orders" ("app_id");
CREATE INDEX IF NOT EXISTS "idx_orders_organization_id" ON "orders" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_orders_contact_id" ON "orders" ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_orders_conversation_id" ON "orders" ("conversation_id");
CREATE INDEX IF NOT EXISTS "idx_orders_created_at" ON "orders" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_orders_order_status" ON "orders" ("order_status");
CREATE INDEX IF NOT EXISTS "idx_orders_payment_type" ON "orders" ("payment_type");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_orders_order_number" ON "orders" ("order_number");

CREATE TABLE IF NOT EXISTS "order_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL,
  "amount" numeric(18,2) DEFAULT 0,
  "status" varchar(50) DEFAULT 'PENDING',
  "paid_at" timestamptz,
  "expiry_date" timestamptz,
  "payment_link" text,
  "pdf_link" text,
  "xendit_invoice_id" varchar(255),
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "fk_order_invoices_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_order_invoices_order_id" ON "order_invoices" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_order_invoices_status" ON "order_invoices" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_order_invoices_xendit" ON "order_invoices" ("xendit_invoice_id") WHERE "xendit_invoice_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL,
  "product_id" uuid,
  "product_name" text,
  "quantity" integer DEFAULT 1,
  "price" numeric(18,2) DEFAULT 0,
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "fk_order_items_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_order_items_order_id" ON "order_items" ("order_id");

CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text,
  "app_id" uuid,
  "contact_id" uuid,
  "subscription_number" bigserial NOT NULL,
  "status" varchar(50) DEFAULT 'active',
  "subscription_type" varchar(50) DEFAULT 'monthly',
  "item_name" text,
  "billing_amount" numeric(18,2) DEFAULT 0,
  "cycles" integer DEFAULT 0,
  "start_date" timestamptz,
  "next_billing" timestamptz,
  "end_date" timestamptz,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "fk_subscriptions_org" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL,
  CONSTRAINT "fk_subscriptions_app" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_subscriptions_number" ON "subscriptions" ("subscription_number");
CREATE INDEX IF NOT EXISTS "idx_subscriptions_app_id" ON "subscriptions" ("app_id");
CREATE INDEX IF NOT EXISTS "idx_subscriptions_organization_id" ON "subscriptions" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_subscriptions_contact_id" ON "subscriptions" ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_subscriptions_created_at" ON "subscriptions" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_subscriptions_status" ON "subscriptions" ("status");
