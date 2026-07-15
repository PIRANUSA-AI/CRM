CREATE TABLE IF NOT EXISTS "tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "app_id" UUID NOT NULL,
    "assignee_id" UUID,
    "team_id" UUID,
    "created_by" UUID,
    "conversation_id" UUID,
    "contact_id" UUID,
    "source_message_id" UUID,
    "action_kind" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "priority" VARCHAR(20) NOT NULL DEFAULT 'medium',
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "due_at" TIMESTAMPTZ(6),
    "snoozed_until" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "source" VARCHAR(50) NOT NULL DEFAULT 'ai_whatsapp',
    "ai_snapshot" JSONB DEFAULT '{}',
    "analysis_version" VARCHAR(32),
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tasks_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE,
    CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL,
    CONSTRAINT "tasks_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL,
    CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL,
    CONSTRAINT "tasks_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL,
    CONSTRAINT "tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL,
    CONSTRAINT "tasks_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "messages"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "tasks_app_source_message_key"
ON "tasks"("app_id", "source_message_id");

CREATE INDEX IF NOT EXISTS "idx_tasks_assignee_status_due"
ON "tasks"("app_id", "assignee_id", "status", "due_at");

CREATE INDEX IF NOT EXISTS "idx_tasks_status_due"
ON "tasks"("app_id", "status", "due_at");

CREATE INDEX IF NOT EXISTS "idx_tasks_conversation"
ON "tasks"("conversation_id");

CREATE INDEX IF NOT EXISTS "idx_tasks_contact"
ON "tasks"("contact_id");

CREATE TABLE IF NOT EXISTS "task_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "actor_id" UUID,
    "actor_type" VARCHAR(20) NOT NULL DEFAULT 'user',
    "metadata" JSONB DEFAULT '{}',
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
    CONSTRAINT "task_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "idx_task_events_task_created"
ON "task_events"("task_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_task_events_type"
ON "task_events"("event_type");
