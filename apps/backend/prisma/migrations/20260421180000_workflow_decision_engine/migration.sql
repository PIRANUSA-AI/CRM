CREATE TABLE IF NOT EXISTS "flow_decision_policies" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "flow_id" uuid,
    "policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "flow_decision_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "flow_decision_policies_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "flow_decision_policies_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "automation_flows"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_flow_decision_policies_app" ON "flow_decision_policies"("app_id");
CREATE INDEX IF NOT EXISTS "idx_flow_decision_policies_flow" ON "flow_decision_policies"("flow_id");
CREATE INDEX IF NOT EXISTS "idx_flow_decision_policies_active" ON "flow_decision_policies"("app_id", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "ux_flow_decision_policies_scope" ON "flow_decision_policies"(
    "app_id",
    COALESCE("flow_id", '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE TABLE IF NOT EXISTS "conversation_ai_signals" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "conversation_id" uuid NOT NULL,
    "flow_id" uuid,
    "message_id" uuid,
    "channel_type" varchar(50),
    "source" varchar(40) DEFAULT 'inbound',
    "intent" varchar(80),
    "intent_confidence" decimal(6,5),
    "sentiment_state" varchar(20),
    "sentiment_transition" varchar(80),
    "buying_stage" varchar(40),
    "churn_risk_score" integer,
    "model_confidence" decimal(6,5),
    "retrieval_score" decimal(6,5),
    "product_match_score" decimal(6,5),
    "rule_modifier_score" decimal(6,5),
    "overall_confidence" decimal(6,5),
    "confidence_band" varchar(12),
    "recommended_action" varchar(80),
    "route_target" varchar(40),
    "requires_approval" boolean DEFAULT false,
    "approval_reason" text,
    "persona_id" uuid,
    "signal_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "conversation_ai_signals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_ai_signals_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "conversation_ai_signals_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "conversation_ai_signals_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "automation_flows"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "conversation_ai_signals_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "conversation_ai_signals_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "ai_playground_personas"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_conversation_ai_signals_app_created" ON "conversation_ai_signals"("app_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_conversation_ai_signals_conversation_created" ON "conversation_ai_signals"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_conversation_ai_signals_flow_created" ON "conversation_ai_signals"("flow_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_conversation_ai_signals_band" ON "conversation_ai_signals"("app_id", "confidence_band");
CREATE INDEX IF NOT EXISTS "idx_conversation_ai_signals_intent" ON "conversation_ai_signals"("app_id", "intent");

ALTER TABLE "handover_requests"
    ADD COLUMN IF NOT EXISTS "escalation_count" integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "approval_deadline_at" timestamptz,
    ADD COLUMN IF NOT EXISTS "escalated_to" uuid,
    ADD COLUMN IF NOT EXISTS "escalated_at" timestamptz,
    ADD COLUMN IF NOT EXISTS "triage_status" varchar(40) NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS "triage_note" text;

CREATE INDEX IF NOT EXISTS "idx_handover_requests_pending_deadline" ON "handover_requests"("app_id", "status", "approval_deadline_at");
CREATE INDEX IF NOT EXISTS "idx_handover_requests_triage_status" ON "handover_requests"("app_id", "triage_status", "status");
