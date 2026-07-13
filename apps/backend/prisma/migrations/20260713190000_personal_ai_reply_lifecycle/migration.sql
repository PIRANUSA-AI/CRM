CREATE TABLE IF NOT EXISTS "personal_ai_settings" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "app_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "auto_reply_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "review_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "reply_delay_seconds" INTEGER NOT NULL DEFAULT 15,
    "min_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.65,
    "persona_prompt" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "personal_ai_settings_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE,
    CONSTRAINT "personal_ai_settings_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "personal_ai_settings_owner_key"
ON "personal_ai_settings"("app_id", "owner_user_id");

CREATE TABLE IF NOT EXISTS "personal_ai_reply_tasks" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "app_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "inbound_message_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'scheduled_review',
    "review_result" JSONB,
    "review_reason" TEXT,
    "review_confidence" DOUBLE PRECISION,
    "draft_text" TEXT,
    "rag_context" JSONB,
    "scheduled_for" TIMESTAMPTZ(6),
    "sent_message_id" UUID,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "personal_ai_reply_tasks_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE,
    CONSTRAINT "personal_ai_reply_tasks_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "personal_ai_reply_tasks_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE,
    CONSTRAINT "personal_ai_reply_tasks_inbound_message_id_fkey" FOREIGN KEY ("inbound_message_id") REFERENCES "messages"("id") ON DELETE CASCADE,
    CONSTRAINT "personal_ai_reply_tasks_sent_message_id_fkey" FOREIGN KEY ("sent_message_id") REFERENCES "messages"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "personal_ai_reply_tasks_inbound_key"
ON "personal_ai_reply_tasks"("inbound_message_id");

CREATE INDEX IF NOT EXISTS "idx_personal_ai_reply_tasks_owner_status"
ON "personal_ai_reply_tasks"("app_id", "owner_user_id", "status", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_personal_ai_reply_tasks_conversation"
ON "personal_ai_reply_tasks"("conversation_id", "created_at" DESC);

