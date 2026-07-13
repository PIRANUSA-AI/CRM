CREATE TABLE IF NOT EXISTS "whatsapp_lead_registrations" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "app_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "phone_number" VARCHAR(32) NOT NULL,
    "contact_id" UUID,
    "conversation_id" UUID,
    "display_name" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "source" VARCHAR(40) NOT NULL DEFAULT 'inbound',
    "confirmed_at" TIMESTAMPTZ(6),
    "blocked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "whatsapp_lead_registrations_status_check"
        CHECK ("status" IN ('pending', 'confirmed', 'blocked')),
    CONSTRAINT "whatsapp_lead_registrations_app_id_fkey"
        FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "whatsapp_lead_registrations_owner_user_id_fkey"
        FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "whatsapp_lead_registrations_contact_id_fkey"
        FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "whatsapp_lead_registrations_conversation_id_fkey"
        FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_lead_registrations_owner_phone_key"
ON "whatsapp_lead_registrations"("app_id", "owner_user_id", "phone_number");

CREATE INDEX IF NOT EXISTS "idx_whatsapp_lead_registrations_owner_status"
ON "whatsapp_lead_registrations"("app_id", "owner_user_id", "status", "updated_at" DESC);

