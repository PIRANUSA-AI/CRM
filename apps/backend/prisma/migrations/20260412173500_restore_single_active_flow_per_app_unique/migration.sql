CREATE UNIQUE INDEX IF NOT EXISTS ux_automation_flows_single_active_per_app
ON automation_flows (app_id)
WHERE active IS TRUE;
