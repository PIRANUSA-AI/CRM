ALTER TABLE "chatbots"
ADD COLUMN IF NOT EXISTS "watcher_enabled" BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS "session_only_memory" BOOLEAN DEFAULT false;
