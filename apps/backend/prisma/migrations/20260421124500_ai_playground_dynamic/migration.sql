CREATE TABLE IF NOT EXISTS "ai_playground_models" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "model_key" varchar(80) NOT NULL,
    "name" varchar(160) NOT NULL,
    "vendor" varchar(120) NOT NULL,
    "context_window" varchar(32) NOT NULL,
    "price_in" decimal(12,6) NOT NULL,
    "price_out" decimal(12,6) NOT NULL,
    "speed" varchar(20) NOT NULL,
    "tier" varchar(20) NOT NULL,
    "connected" boolean DEFAULT false,
    "latency_ms" integer,
    "usage_percent" integer DEFAULT 0,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "ai_playground_models_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_playground_models_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_playground_models_app_key" ON "ai_playground_models"("app_id", "model_key");
CREATE INDEX IF NOT EXISTS "idx_ai_playground_models_app_sort" ON "ai_playground_models"("app_id", "sort_order");
CREATE INDEX IF NOT EXISTS "idx_ai_playground_models_app_connected" ON "ai_playground_models"("app_id", "connected");

CREATE TABLE IF NOT EXISTS "ai_playground_routing_strategies" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "strategy_key" varchar(80) NOT NULL,
    "label" varchar(120) NOT NULL,
    "description" text NOT NULL,
    "is_active" boolean DEFAULT false,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "ai_playground_routing_strategies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_playground_routing_strategies_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_playground_routing_app_key" ON "ai_playground_routing_strategies"("app_id", "strategy_key");
CREATE INDEX IF NOT EXISTS "idx_ai_playground_routing_app_sort" ON "ai_playground_routing_strategies"("app_id", "sort_order");
CREATE INDEX IF NOT EXISTS "idx_ai_playground_routing_app_active" ON "ai_playground_routing_strategies"("app_id", "is_active");

CREATE TABLE IF NOT EXISTS "ai_playground_personas" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "persona_key" varchar(80) NOT NULL,
    "label" varchar(160) NOT NULL,
    "system_instruction" text NOT NULL,
    "is_default" boolean DEFAULT false,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "ai_playground_personas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_playground_personas_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_playground_personas_app_key" ON "ai_playground_personas"("app_id", "persona_key");
CREATE INDEX IF NOT EXISTS "idx_ai_playground_personas_app_sort" ON "ai_playground_personas"("app_id", "sort_order");
CREATE INDEX IF NOT EXISTS "idx_ai_playground_personas_app_default" ON "ai_playground_personas"("app_id", "is_default");

CREATE TABLE IF NOT EXISTS "ai_playground_guardrails" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "guardrail_key" varchar(80) NOT NULL,
    "label" varchar(180) NOT NULL,
    "enabled" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "ai_playground_guardrails_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_playground_guardrails_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_playground_guardrails_app_key" ON "ai_playground_guardrails"("app_id", "guardrail_key");
CREATE INDEX IF NOT EXISTS "idx_ai_playground_guardrails_app_sort" ON "ai_playground_guardrails"("app_id", "sort_order");

CREATE TABLE IF NOT EXISTS "ai_playground_metric_items" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "metric_key" varchar(80) NOT NULL,
    "label" varchar(120) NOT NULL,
    "value" varchar(120) NOT NULL,
    "delta" varchar(120) NOT NULL,
    "trend" varchar(20) NOT NULL,
    "positive_when" varchar(20) NOT NULL,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "ai_playground_metric_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_playground_metric_items_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_playground_metrics_app_key" ON "ai_playground_metric_items"("app_id", "metric_key");
CREATE INDEX IF NOT EXISTS "idx_ai_playground_metrics_app_sort" ON "ai_playground_metric_items"("app_id", "sort_order");

CREATE TABLE IF NOT EXISTS "ai_playground_sessions" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "selected_model_id" uuid,
    "selected_strategy_id" uuid,
    "selected_persona_id" uuid,
    "status" varchar(20) DEFAULT 'active',
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "ai_playground_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_playground_sessions_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ai_playground_sessions_selected_model_id_fkey" FOREIGN KEY ("selected_model_id") REFERENCES "ai_playground_models"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "ai_playground_sessions_selected_strategy_id_fkey" FOREIGN KEY ("selected_strategy_id") REFERENCES "ai_playground_routing_strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "ai_playground_sessions_selected_persona_id_fkey" FOREIGN KEY ("selected_persona_id") REFERENCES "ai_playground_personas"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_ai_playground_sessions_app_updated" ON "ai_playground_sessions"("app_id", "updated_at");
CREATE INDEX IF NOT EXISTS "idx_ai_playground_sessions_app_status" ON "ai_playground_sessions"("app_id", "status");

CREATE TABLE IF NOT EXISTS "ai_playground_turns" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "session_id" uuid NOT NULL,
    "role" varchar(20) NOT NULL,
    "content" text NOT NULL,
    "model_name" varchar(160),
    "tokens_in" integer,
    "tokens_out" integer,
    "latency_ms" integer,
    "cost_usd" decimal(12,6),
    "sort_order" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "ai_playground_turns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_playground_turns_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ai_playground_turns_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_playground_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_ai_playground_turns_session_sort" ON "ai_playground_turns"("session_id", "sort_order");
CREATE INDEX IF NOT EXISTS "idx_ai_playground_turns_app_created" ON "ai_playground_turns"("app_id", "created_at");
