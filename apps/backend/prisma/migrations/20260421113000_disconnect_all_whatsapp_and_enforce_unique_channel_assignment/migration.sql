UPDATE "whatsapp_channels"
SET
  "deleted_at" = NOW(),
  "is_active" = FALSE,
  "updated_at" = NOW()
WHERE "deleted_at" IS NULL;

UPDATE "inboxes"
SET
  "deleted_at" = NOW(),
  "updated_at" = NOW()
WHERE
  "channel_type" = 'whatsapp'
  AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ux_whatsapp_channels_active_phone_number_id"
ON "whatsapp_channels" ("phone_number_id")
WHERE
  "deleted_at" IS NULL
  AND "phone_number_id" IS NOT NULL;
