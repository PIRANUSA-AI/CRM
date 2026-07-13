CREATE TABLE IF NOT EXISTS "customer_level_settings" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "vip_chatbot_id" uuid,
    "premium_chatbot_id" uuid,
    "basic_chatbot_id" uuid,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "customer_level_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_level_settings_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_level_settings_app_id_key" ON "customer_level_settings"("app_id");
CREATE INDEX IF NOT EXISTS "idx_customer_level_settings_app_id" ON "customer_level_settings"("app_id");
