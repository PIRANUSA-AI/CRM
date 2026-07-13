CREATE TABLE IF NOT EXISTS "handover_requests" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "app_id" uuid NOT NULL,
    "conversation_id" uuid NOT NULL,
    "request_type" varchar(20) NOT NULL DEFAULT 'take',
    "requested_by" uuid,
    "target_agent_id" uuid,
    "status" varchar(20) NOT NULL DEFAULT 'pending',
    "request_note" text,
    "approval_note" text,
    "approved_by" uuid,
    "approved_at" timestamptz,
    "rejected_by" uuid,
    "rejected_at" timestamptz,
    "source_rule_id" uuid,
    "ai_reason" text,
    "ai_intent" varchar(255),
    "sla_due_at" timestamptz,
    "created_at" timestamptz DEFAULT NOW(),
    "updated_at" timestamptz DEFAULT NOW(),
    CONSTRAINT "handover_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "handover_requests_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "handover_requests_source_rule_id_fkey" FOREIGN KEY ("source_rule_id") REFERENCES "auto_assign_rules"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_handover_requests_app_created"
    ON "handover_requests"("app_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_handover_requests_app_status"
    ON "handover_requests"("app_id", "status");

CREATE INDEX IF NOT EXISTS "idx_handover_requests_conversation"
    ON "handover_requests"("conversation_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_handover_requests_rule_created"
    ON "handover_requests"("source_rule_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_handover_requests_target_agent"
    ON "handover_requests"("target_agent_id", "created_at");
