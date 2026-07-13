ALTER TABLE "baileys_sessions"
ADD COLUMN IF NOT EXISTS "owner_user_id" UUID,
ADD COLUMN IF NOT EXISTS "first_connected_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX IF NOT EXISTS "baileys_sessions_app_owner_key"
ON "baileys_sessions"("app_id", "owner_user_id")
WHERE "owner_user_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_baileys_sessions_owner_user_id"
ON "baileys_sessions"("owner_user_id");

ALTER TABLE "baileys_sessions"
ADD CONSTRAINT "baileys_sessions_owner_user_id_fkey"
FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;
