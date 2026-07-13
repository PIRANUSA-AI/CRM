CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "knowledge_sources"
    ADD COLUMN IF NOT EXISTS "format" varchar(50) DEFAULT 'text',
    ADD COLUMN IF NOT EXISTS "embedding_model" varchar(100) DEFAULT 'text-embedding-3-small',
    ADD COLUMN IF NOT EXISTS "embedding_dimension" integer DEFAULT 1536,
    ADD COLUMN IF NOT EXISTS "index_size_bytes" bigint DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "hit_count" integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "last_hit_at" timestamptz,
    ADD COLUMN IF NOT EXISTS "active_version" integer DEFAULT 1;

CREATE INDEX IF NOT EXISTS "idx_knowledge_sources_app" ON "knowledge_sources"("app_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_sources_status" ON "knowledge_sources"("status");

UPDATE "knowledge_sources"
SET
    "format" = COALESCE(
        NULLIF("format", ''),
        CASE
            WHEN LOWER(COALESCE("type", '')) IN ('markdown', 'md') THEN 'markdown'
            WHEN LOWER(COALESCE("type", '')) = 'img' THEN 'image'
            WHEN LOWER(COALESCE("type", '')) IN ('site', 'website', 'url') THEN 'website'
            WHEN LOWER(COALESCE("type", '')) IN ('pdf', 'docx', 'image', 'audio', 'text')
                THEN LOWER("type")
            WHEN LOWER(COALESCE("file_type", '')) IN ('application/pdf') THEN 'pdf'
            WHEN LOWER(COALESCE("file_type", '')) IN ('text/markdown', 'text/x-markdown') THEN 'markdown'
            WHEN LOWER(COALESCE("file_type", '')) IN ('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword') THEN 'docx'
            WHEN LOWER(COALESCE("file_type", '')) LIKE 'image/%' THEN 'image'
            WHEN LOWER(COALESCE("file_type", '')) LIKE 'audio/%' THEN 'audio'
            ELSE 'text'
        END
    ),
    "embedding_model" = COALESCE(NULLIF("embedding_model", ''), 'text-embedding-3-small'),
    "embedding_dimension" = COALESCE("embedding_dimension", 1536),
    "index_size_bytes" = COALESCE("index_size_bytes", 0),
    "hit_count" = COALESCE("hit_count", 0),
    "active_version" = COALESCE("active_version", 1),
    "status" = CASE
        WHEN LOWER(COALESCE("status", '')) IN ('error', 'failed') THEN 'failed'
        WHEN LOWER(COALESCE("status", '')) = 'processing' THEN 'embedding'
        WHEN LOWER(COALESCE("status", '')) IN ('extracting', 'chunking', 'embedding') THEN LOWER("status")
        WHEN LOWER(COALESCE("status", '')) IN ('ready', 'pending', 'archived') THEN LOWER("status")
        ELSE 'pending'
    END;

CREATE TABLE IF NOT EXISTS "knowledge_source_files" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "chatbot_id" uuid,
    "source_id" uuid NOT NULL,
    "file_name" varchar(255) NOT NULL,
    "mime_type" varchar(120),
    "file_size_bytes" bigint DEFAULT 0,
    "checksum_sha256" varchar(128),
    "storage_key" varchar(500),
    "storage_url" text,
    "extraction_metadata" jsonb DEFAULT '{}'::jsonb,
    "page_count" integer,
    "duration_ms" integer,
    "language" varchar(24),
    "status" varchar(50) DEFAULT 'pending',
    "error_message" text,
    "extracted_at" timestamptz,
    "is_active" boolean DEFAULT true,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "knowledge_source_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_source_files_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_source_files_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_source_files_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_knowledge_source_files_app" ON "knowledge_source_files"("app_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_source_files_chatbot" ON "knowledge_source_files"("chatbot_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_source_files_source" ON "knowledge_source_files"("source_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_source_files_status" ON "knowledge_source_files"("status");

CREATE TABLE IF NOT EXISTS "knowledge_ingestion_jobs" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "chatbot_id" uuid,
    "source_id" uuid NOT NULL,
    "source_file_id" uuid,
    "trigger" varchar(50) DEFAULT 'manual',
    "stage" varchar(50) DEFAULT 'ingest',
    "status" varchar(50) DEFAULT 'pending',
    "attempts" integer DEFAULT 0,
    "started_at" timestamptz,
    "finished_at" timestamptz,
    "error_message" text,
    "payload" jsonb DEFAULT '{}'::jsonb,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "knowledge_ingestion_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_ingestion_jobs_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_ingestion_jobs_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_ingestion_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_ingestion_jobs_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "knowledge_source_files"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_knowledge_ingestion_jobs_app" ON "knowledge_ingestion_jobs"("app_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_ingestion_jobs_chatbot" ON "knowledge_ingestion_jobs"("chatbot_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_ingestion_jobs_source" ON "knowledge_ingestion_jobs"("source_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_ingestion_jobs_stage" ON "knowledge_ingestion_jobs"("stage");
CREATE INDEX IF NOT EXISTS "idx_knowledge_ingestion_jobs_status" ON "knowledge_ingestion_jobs"("status");
CREATE INDEX IF NOT EXISTS "idx_knowledge_ingestion_jobs_created" ON "knowledge_ingestion_jobs"("created_at");

CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "chatbot_id" uuid,
    "source_id" uuid NOT NULL,
    "file_id" uuid,
    "source_version" integer DEFAULT 1,
    "chunk_index" integer NOT NULL,
    "chunk_text" text NOT NULL,
    "chunk_hash" varchar(128),
    "char_count" integer DEFAULT 0,
    "token_count" integer DEFAULT 0,
    "locator_label" varchar(255),
    "locator_json" jsonb DEFAULT '{}'::jsonb,
    "embedding_model" varchar(100) DEFAULT 'text-embedding-3-small',
    "embedding_dimension" integer DEFAULT 1536,
    "embedding" vector(1536),
    "chunk_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', COALESCE("chunk_text", ''))) STORED,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_chunks_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_chunks_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_chunks_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_chunks_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "knowledge_source_files"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_knowledge_chunks_scope" ON "knowledge_chunks"("app_id", "chatbot_id", "source_id", "source_version", "chunk_index");
CREATE INDEX IF NOT EXISTS "idx_knowledge_chunks_source_version" ON "knowledge_chunks"("source_id", "source_version");
CREATE INDEX IF NOT EXISTS "idx_knowledge_chunks_file" ON "knowledge_chunks"("file_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_chunks_tsv" ON "knowledge_chunks" USING gin("chunk_tsv");
CREATE INDEX IF NOT EXISTS "idx_knowledge_chunks_embedding_ivfflat" ON "knowledge_chunks" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS "knowledge_query_logs" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "chatbot_id" uuid,
    "channel" varchar(20) DEFAULT 'live',
    "query_text" text NOT NULL,
    "selected_source_ids" jsonb DEFAULT '[]'::jsonb,
    "top_k" integer DEFAULT 5,
    "retrieval_ms" integer DEFAULT 0,
    "rag_hit" boolean DEFAULT false,
    "hit_chunk_count" integer DEFAULT 0,
    "avg_topk_score" decimal(12,6) DEFAULT 0,
    "threshold_used" decimal(8,6) DEFAULT 0.3,
    "prompt_tokens" integer DEFAULT 0,
    "completion_tokens" integer DEFAULT 0,
    "total_tokens" integer DEFAULT 0,
    "usage_credits" decimal(18,6) DEFAULT 0,
    "usage_usd" decimal(18,6) DEFAULT 0,
    "usage_idr" decimal(18,6) DEFAULT 0,
    "answer_text" text,
    "metadata" jsonb DEFAULT '{}'::jsonb,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "knowledge_query_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_query_logs_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_query_logs_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_knowledge_query_logs_scope_created" ON "knowledge_query_logs"("app_id", "chatbot_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_knowledge_query_logs_channel" ON "knowledge_query_logs"("channel");
CREATE INDEX IF NOT EXISTS "idx_knowledge_query_logs_rag_hit" ON "knowledge_query_logs"("rag_hit");

CREATE TABLE IF NOT EXISTS "knowledge_query_chunks" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "chatbot_id" uuid,
    "query_log_id" uuid NOT NULL,
    "chunk_id" uuid,
    "source_id" uuid,
    "rank" integer NOT NULL,
    "score" decimal(12,6) DEFAULT 0,
    "locator_label" varchar(255),
    "snippet" text,
    "created_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "knowledge_query_chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_query_chunks_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_query_chunks_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_query_chunks_query_log_id_fkey" FOREIGN KEY ("query_log_id") REFERENCES "knowledge_query_logs"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_query_chunks_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "knowledge_chunks"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_query_chunks_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_knowledge_query_chunks_log_rank" ON "knowledge_query_chunks"("query_log_id", "rank");
CREATE INDEX IF NOT EXISTS "idx_knowledge_query_chunks_source" ON "knowledge_query_chunks"("source_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_query_chunks_chunk" ON "knowledge_query_chunks"("chunk_id");

-- Backfill synthetic file lineage for existing knowledge sources
INSERT INTO "knowledge_source_files" (
    "id",
    "app_id",
    "chatbot_id",
    "source_id",
    "file_name",
    "mime_type",
    "file_size_bytes",
    "checksum_sha256",
    "storage_key",
    "storage_url",
    "extraction_metadata",
    "status",
    "is_active",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    ks."app_id",
    ks."chatbot_id",
    ks."id",
    COALESCE(NULLIF(ks."file_name", ''), ks."title", 'knowledge-source'),
    COALESCE(NULLIF(ks."file_type", ''), CASE
        WHEN LOWER(COALESCE(ks."format", '')) = 'pdf' THEN 'application/pdf'
        WHEN LOWER(COALESCE(ks."format", '')) IN ('markdown', 'md') THEN 'text/markdown'
        WHEN LOWER(COALESCE(ks."format", '')) = 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        WHEN LOWER(COALESCE(ks."format", '')) IN ('image', 'img') THEN 'image/*'
        WHEN LOWER(COALESCE(ks."format", '')) = 'audio' THEN 'audio/*'
        ELSE 'text/plain'
    END),
    COALESCE(ks."file_size", 0),
    NULL,
    NULL,
    ks."source_url",
    jsonb_build_object('backfilled', true, 'source_type', ks."source_type"),
    CASE
        WHEN LOWER(COALESCE(ks."status", '')) IN ('ready', 'failed') THEN LOWER(ks."status")
        ELSE 'ready'
    END,
    COALESCE(ks."is_active", true),
    COALESCE(ks."created_at", NOW()),
    COALESCE(ks."updated_at", NOW())
FROM "knowledge_sources" ks
LEFT JOIN "knowledge_source_files" ksf
    ON ksf."source_id" = ks."id"
WHERE ks."app_id" IS NOT NULL
  AND ksf."id" IS NULL;
