ALTER TABLE "ai_playground_routing_strategies"
ADD COLUMN IF NOT EXISTS "routing_rules" jsonb NOT NULL DEFAULT '[]'::jsonb;
