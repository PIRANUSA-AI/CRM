ALTER TABLE "agent_settings"
ADD COLUMN IF NOT EXISTS "default_ticket_board_id" UUID;
