CREATE TABLE "ai_response_logs" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "chatbot_id" uuid NOT NULL,
    "conversation_id" uuid,
    "entrypoint" varchar(60) NOT NULL,
    "provider" varchar(80),
    "model_name" varchar(200),
    "prompt_tokens" integer DEFAULT 0,
    "completion_tokens" integer DEFAULT 0,
    "total_tokens" integer DEFAULT 0,
    "usage_credits" decimal(18,6) DEFAULT 0,
    "usage_usd" decimal(18,6) DEFAULT 0,
    "usage_idr" decimal(18,6) DEFAULT 0,
    "billed_credits" decimal(18,6) DEFAULT 0,
    "knowledge_references" jsonb DEFAULT '[]'::jsonb,
    "rtk_summary" jsonb DEFAULT '{}'::jsonb,
    "message_ids" text[] DEFAULT ARRAY[]::text[],
    "status" varchar(50) DEFAULT 'generated',
    "retry_count" integer DEFAULT 0,
    "knowledge_snapshot_at" timestamptz,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "ai_response_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_ai_response_logs_app" ON "ai_response_logs"("app_id");
CREATE INDEX "idx_ai_response_logs_chatbot" ON "ai_response_logs"("chatbot_id");
CREATE INDEX "idx_ai_response_logs_conversation" ON "ai_response_logs"("conversation_id");
CREATE INDEX "idx_ai_response_logs_entrypoint" ON "ai_response_logs"("entrypoint");
CREATE INDEX "idx_ai_response_logs_created" ON "ai_response_logs"("created_at");

ALTER TABLE "embeddings"
    ADD COLUMN IF NOT EXISTS "faq_id" uuid,
    ADD COLUMN IF NOT EXISTS "chunk_index" integer DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'embeddings_faq_id_fkey'
    ) THEN
        ALTER TABLE "embeddings"
            ADD CONSTRAINT "embeddings_faq_id_fkey"
            FOREIGN KEY ("faq_id") REFERENCES "knowledge_faqs"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_embeddings_source" ON "embeddings"("source_id");
CREATE INDEX IF NOT EXISTS "idx_embeddings_faq" ON "embeddings"("faq_id");
