ALTER TABLE "ai_settings"
ALTER COLUMN "model_name" SET DEFAULT 'gpt-4o-mini';

ALTER TABLE "chatbots"
ALTER COLUMN "model" SET DEFAULT 'gpt-4o-mini';

UPDATE "ai_settings"
SET "model_name" = 'gpt-4o-mini'
WHERE "model_name" = 'glm-5.1';

UPDATE "chatbots"
SET "model" = 'gpt-4o-mini'
WHERE "model" = 'glm-5.1';
