CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "baileys_sessions"
    ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
