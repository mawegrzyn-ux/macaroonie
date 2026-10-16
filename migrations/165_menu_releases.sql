-- 165_menu_releases.sql
--
-- Menu publishing (every channel). The menu tables (menus, menu_sections,
-- menu_items and their children) become the DRAFT: the Menus page, the
-- allergen matrix, the menu designer and the AI menu tools edit them as
-- before. What guests and tills see is the LIVE version: the newest release
-- of each menu whose goes_live_at has passed.
--
--   menu_releases        one row per publish. snapshot = the menu as
--                        loadMenuFull() returned it at publish time (sections,
--                        dishes, prices, option prices, allergens, footer
--                        notes, menu settings), minus what stays live:
--                        tenant tags, the allergen notice and the print
--                        design choice. goes_live_at in the future = a
--                        scheduled publish; cancelled_at = withdrawn before
--                        it went live. announced_at = tills (and screens)
--                        were told it went live (set by the minute sweep).
--                        Rows never change after insert (cached by id).
--
--   menu_preview_links   short-lived links (1 hour) the admin's Print button
--                        opens to print the draft or a scheduled release on
--                        the public print page, which has no login.
--
--   menus.needs_first_release
--                        set for every menu that exists now; the API makes
--                        their first release from the current draft when it
--                        starts (services/menuReleases.js
--                        backfillFirstReleases()), so nothing goes missing.
--                        New menus start without one: not live anywhere
--                        until published.
--
-- Readers of the live version: website (menu block, public menu JSON,
-- print), online ordering, the till config, Deliveroo, cooking checks,
-- the allergen lookup, screens. Staging websites show the draft.

BEGIN;

CREATE TABLE IF NOT EXISTS menu_releases (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  menu_id       uuid        NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  snapshot      jsonb       NOT NULL,
  content_hash  text        NOT NULL,
  goes_live_at  timestamptz NOT NULL DEFAULT now(),
  note          text,
  published_by  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz,
  cancelled_by  text,
  announced_at  timestamptz
);
CREATE INDEX IF NOT EXISTS menu_releases_live
  ON menu_releases (tenant_id, menu_id, goes_live_at DESC, created_at DESC)
  WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS menu_releases_due
  ON menu_releases (goes_live_at)
  WHERE announced_at IS NULL AND cancelled_at IS NULL;
ALTER TABLE menu_releases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS menu_releases_tenant ON menu_releases;
CREATE POLICY menu_releases_tenant ON menu_releases
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS menu_preview_links (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  menu_id     uuid        NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  release_id  uuid        REFERENCES menu_releases(id) ON DELETE CASCADE,   -- null = the draft
  expires_at  timestamptz NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE menu_preview_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS menu_preview_links_tenant ON menu_preview_links;
CREATE POLICY menu_preview_links_tenant ON menu_preview_links
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE menus ADD COLUMN IF NOT EXISTS needs_first_release boolean NOT NULL DEFAULT false;
UPDATE menus SET needs_first_release = true
 WHERE NOT EXISTS (SELECT 1 FROM menu_releases r WHERE r.menu_id = menus.id);

COMMIT;
