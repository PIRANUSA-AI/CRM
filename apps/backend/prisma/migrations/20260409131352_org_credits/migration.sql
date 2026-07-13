ALTER TABLE "organization"
ADD COLUMN IF NOT EXISTS "ai_credits" numeric(10,2) DEFAULT 0.0;

ALTER TABLE "organization"
ADD COLUMN IF NOT EXISTS "ai_credit_warning_threshold" numeric(10,2) DEFAULT 5.0;

ALTER TABLE "organization"
ADD COLUMN IF NOT EXISTS "ai_low_credit_alert_sent" boolean DEFAULT false;

CREATE TABLE IF NOT EXISTS "payment_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" text NOT NULL,
  "external_id" varchar(255),
  "xendit_invoice_id" varchar(255),
  "amount" numeric(10,2) NOT NULL,
  "credits" numeric(10,2) NOT NULL,
  "status" varchar(50) NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "fk_payment_requests_org" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_payment_requests_org" ON "payment_requests" ("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_requests_external" ON "payment_requests" ("external_id") WHERE "external_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_requests_invoice" ON "payment_requests" ("xendit_invoice_id") WHERE "xendit_invoice_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_payment_requests_status" ON "payment_requests" ("status");

UPDATE "organization" org
SET
  "ai_credits" = COALESCE(app."ai_credits", org."ai_credits", 0),
  "ai_credit_warning_threshold" = COALESCE(app."ai_credit_warning_threshold", org."ai_credit_warning_threshold", 5.0),
  "ai_low_credit_alert_sent" = COALESCE(app."ai_low_credit_alert_sent", org."ai_low_credit_alert_sent", false)
FROM "apps" app
WHERE org."appId" = app."id";
