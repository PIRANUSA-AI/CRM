CREATE TABLE IF NOT EXISTS "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "app_id" uuid NOT NULL,
  "organization_id" text,
  "name" varchar(255) NOT NULL,
  "sku" varchar(100),
  "description" text,
  "base_price" numeric(18,2) DEFAULT 0,
  "is_active" boolean DEFAULT true,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_products_app_id" ON "products" ("app_id");
CREATE INDEX IF NOT EXISTS "idx_products_organization_id" ON "products" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_products_is_active" ON "products" ("is_active");

CREATE TABLE IF NOT EXISTS "product_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id" uuid NOT NULL,
  "app_id" uuid NOT NULL,
  "organization_id" text,
  "name" varchar(255) NOT NULL,
  "sku" varchar(100),
  "attributes" jsonb DEFAULT '{}'::jsonb,
  "price" numeric(18,2) DEFAULT 0,
  "stock_on_hand" integer DEFAULT 0,
  "stock_reserved" integer DEFAULT 0,
  "is_active" boolean DEFAULT true,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_product_variants_app_id" ON "product_variants" ("app_id");
CREATE INDEX IF NOT EXISTS "idx_product_variants_product_id" ON "product_variants" ("product_id");
CREATE INDEX IF NOT EXISTS "idx_product_variants_organization_id" ON "product_variants" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_product_variants_is_active" ON "product_variants" ("is_active");

CREATE TABLE IF NOT EXISTS "stock_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "app_id" uuid NOT NULL,
  "organization_id" text,
  "order_id" uuid NOT NULL,
  "order_item_id" uuid,
  "variant_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "status" varchar(30) DEFAULT 'active',
  "reason" varchar(50) DEFAULT 'checkout',
  "expires_at" timestamptz,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_stock_reservations_app_id" ON "stock_reservations" ("app_id");
CREATE INDEX IF NOT EXISTS "idx_stock_reservations_organization_id" ON "stock_reservations" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_stock_reservations_order_id" ON "stock_reservations" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_stock_reservations_variant_id" ON "stock_reservations" ("variant_id");
CREATE INDEX IF NOT EXISTS "idx_stock_reservations_status" ON "stock_reservations" ("status");

CREATE TABLE IF NOT EXISTS "stock_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "app_id" uuid NOT NULL,
  "organization_id" text,
  "variant_id" uuid NOT NULL,
  "reservation_id" uuid,
  "order_id" uuid,
  "movement_type" varchar(30) NOT NULL,
  "quantity" integer NOT NULL,
  "stock_before" integer DEFAULT 0,
  "stock_after" integer DEFAULT 0,
  "note" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_stock_movements_app_id" ON "stock_movements" ("app_id");
CREATE INDEX IF NOT EXISTS "idx_stock_movements_organization_id" ON "stock_movements" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_stock_movements_variant_id" ON "stock_movements" ("variant_id");
CREATE INDEX IF NOT EXISTS "idx_stock_movements_order_id" ON "stock_movements" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_stock_movements_type" ON "stock_movements" ("movement_type");

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "payment_provider" varchar(50),
  ADD COLUMN IF NOT EXISTS "journey_phase" varchar(50) DEFAULT 'cart',
  ADD COLUMN IF NOT EXISTS "currency" varchar(10) DEFAULT 'IDR',
  ADD COLUMN IF NOT EXISTS "external_order_id" varchar(255),
  ADD COLUMN IF NOT EXISTS "checkout_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "paid_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "expired_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS "idx_orders_journey_phase" ON "orders" ("journey_phase");
CREATE INDEX IF NOT EXISTS "idx_orders_external_order_id" ON "orders" ("external_order_id");

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "variant_id" uuid,
  ADD COLUMN IF NOT EXISTS "variant_name" text,
  ADD COLUMN IF NOT EXISTS "unit_price" numeric(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "line_total" numeric(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS "idx_order_items_variant_id" ON "order_items" ("variant_id");

ALTER TABLE "order_invoices"
  ADD COLUMN IF NOT EXISTS "provider" varchar(50) DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS "provider_invoice_id" varchar(255),
  ADD COLUMN IF NOT EXISTS "payment_method" varchar(50),
  ADD COLUMN IF NOT EXISTS "payment_number" text,
  ADD COLUMN IF NOT EXISTS "checkout_url" text,
  ADD COLUMN IF NOT EXISTS "public_token" varchar(120),
  ADD COLUMN IF NOT EXISTS "public_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "verified_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "provider_payload" jsonb;

ALTER TABLE "order_invoices"
  ALTER COLUMN "status" SET DEFAULT 'NOT_PAID';

CREATE INDEX IF NOT EXISTS "idx_order_invoices_provider" ON "order_invoices" ("provider");
CREATE INDEX IF NOT EXISTS "idx_order_invoices_public_token" ON "order_invoices" ("public_token");
CREATE INDEX IF NOT EXISTS "idx_order_invoices_provider_invoice_id" ON "order_invoices" ("provider_invoice_id");
