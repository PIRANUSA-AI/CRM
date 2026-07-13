ALTER TABLE "webhooks"
  ADD COLUMN IF NOT EXISTS "app_id" UUID,
  ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT 'Webhook',
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS "secret" TEXT,
  ADD COLUMN IF NOT EXISTS "headers" JSONB,
  ADD COLUMN IF NOT EXISTS "is_hidden" BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS "board_id" UUID,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(6) DEFAULT now();

UPDATE "webhooks"
SET "name" = 'Webhook'
WHERE "name" IS NULL OR BTRIM("name") = '';

UPDATE "webhooks"
SET "subscriptions" = '[]'::jsonb
WHERE "subscriptions" IS NULL;

UPDATE "webhooks"
SET "is_active" = true
WHERE "is_active" IS NULL;

UPDATE "webhooks"
SET "is_hidden" = false
WHERE "is_hidden" IS NULL;

UPDATE "webhooks" "w"
SET "app_id" = "w"."account_id"
WHERE "w"."app_id" IS NULL
  AND "w"."account_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "apps" "a" WHERE "a"."id" = "w"."account_id"
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'webhooks_app_id_fkey'
  ) THEN
    ALTER TABLE "webhooks"
      ADD CONSTRAINT "webhooks_app_id_fkey"
      FOREIGN KEY ("app_id")
      REFERENCES "apps"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "idx_webhooks_app_id"
  ON "webhooks"("app_id");

CREATE INDEX IF NOT EXISTS "idx_webhooks_inbox_id"
  ON "webhooks"("inbox_id");
