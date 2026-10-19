-- 188_kiosk_share_menu.sql
--
-- Which version of the menu a kiosk design's shared preview link shows
-- (migration 187): 'live' = the published menu, what the kiosks show now;
-- 'draft' = the menu with changes saved on the Menus page and not published
-- yet (new photos, prices, dishes). The editor's own preview picks the same
-- per link it makes (signed into the link, nothing stored).

BEGIN;

ALTER TABLE kiosk_designs
  ADD COLUMN IF NOT EXISTS share_menu text NOT NULL DEFAULT 'live';

DO $$ BEGIN
  ALTER TABLE kiosk_designs ADD CONSTRAINT kiosk_designs_share_menu_check CHECK (share_menu IN ('live', 'draft'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
