CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "baileys_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "provider_channel_key" VARCHAR(191) NOT NULL,
    "phone_number" VARCHAR(50),
    "status" VARCHAR(50) DEFAULT 'pending',
    "auth_state" JSONB,
    "pairing_code" VARCHAR(64),
    "qr_code" TEXT,
    "last_error" TEXT,
    "last_connected_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6),
    "metadata" JSONB DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "baileys_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "baileys_sessions_channel_id_key" ON "baileys_sessions"("channel_id");
CREATE UNIQUE INDEX "baileys_sessions_provider_channel_key_key" ON "baileys_sessions"("provider_channel_key");
CREATE INDEX "idx_baileys_sessions_app_id" ON "baileys_sessions"("app_id");
CREATE INDEX "idx_baileys_sessions_status" ON "baileys_sessions"("status");
