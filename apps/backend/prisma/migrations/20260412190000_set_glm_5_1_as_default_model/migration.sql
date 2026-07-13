ALTER TABLE "ai_settings"
ALTER COLUMN "model_name" SET DEFAULT 'glm-5.1';

ALTER TABLE "chatbots"
ALTER COLUMN "model" SET DEFAULT 'glm-5.1';

UPDATE "ai_settings"
SET "model_name" = 'glm-5.1'
WHERE "model_name" = 'gpt-4o-mini';

UPDATE "chatbots"
SET "model" = 'glm-5.1'
WHERE "model" = 'gpt-4o-mini';
