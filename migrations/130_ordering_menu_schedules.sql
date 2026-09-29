-- 130_ordering_menu_schedules.sql
--
-- When each online-ordering menu is on, per venue: optional date range
-- (schedule a menu change) and time windows per day (lunch / dinner).
-- { "<menu_id>": { "from": "YYYY-MM-DD"|null, "until": "YYYY-MM-DD"|null,
--                  "times": [{ "days": [0-6], "start": "HH:MM", "end": "HH:MM" }] } }
-- A menu missing from the map is always on. Rules: shared/menuSchedule.js.

ALTER TABLE ordering_settings ADD COLUMN IF NOT EXISTS menu_schedules jsonb NOT NULL DEFAULT '{}'::jsonb;
