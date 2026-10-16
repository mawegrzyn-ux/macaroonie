-- 166_screens.sql
-- Menu screens (digital menu boards).
--
--   screen_designs         a board: its size in pixels and a layout of
--                          positioned blocks (shared/screenLayout.js)
--   screen_playlists       boards taking turns on a screen ...
--   screen_playlist_items  ... each for some seconds, at the times of day
--                          it is set for (shared/menuSchedule.js shape)
--   screens                one physical screen (an Android box or TV): its
--                          venue, size, rotation, what it shows, and the
--                          hash of the secret it signs in with
--   screen_pairings        a code a new screen shows until someone types
--                          it into Screens; global (no tenant yet), never
--                          holds a secret, only its hash
--
-- Screens read the live menus (menu_releases, migration 165), so prices
-- change on them when a menu is published. Sold out comes from
-- ordering_item_availability, which the till can now set too
-- (pos_roles.permissions.sold_out).

BEGIN;

CREATE TABLE IF NOT EXISTS screen_designs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  width       int         NOT NULL DEFAULT 1920 CHECK (width BETWEEN 240 AND 8192),
  height      int         NOT NULL DEFAULT 1080 CHECK (height BETWEEN 240 AND 8192),
  layout      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by  text,
  updated_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS screen_designs_tenant ON screen_designs (tenant_id);
ALTER TABLE screen_designs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS screen_designs_tenant ON screen_designs;
CREATE POLICY screen_designs_tenant ON screen_designs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP TRIGGER IF EXISTS trg_screen_designs_updated_at ON screen_designs;
CREATE TRIGGER trg_screen_designs_updated_at BEFORE UPDATE ON screen_designs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS screen_playlists (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS screen_playlists_tenant ON screen_playlists (tenant_id);
ALTER TABLE screen_playlists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS screen_playlists_tenant ON screen_playlists;
CREATE POLICY screen_playlists_tenant ON screen_playlists
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP TRIGGER IF EXISTS trg_screen_playlists_updated_at ON screen_playlists;
CREATE TRIGGER trg_screen_playlists_updated_at BEFORE UPDATE ON screen_playlists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS screen_playlist_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  playlist_id   uuid        NOT NULL REFERENCES screen_playlists(id) ON DELETE CASCADE,
  design_id     uuid        NOT NULL REFERENCES screen_designs(id) ON DELETE CASCADE,
  duration_secs int         NOT NULL DEFAULT 15 CHECK (duration_secs BETWEEN 3 AND 3600),
  schedule      jsonb,      -- null = always; else { from, until, times: [{ days, start, end }] }
  sort_order    int         NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS screen_playlist_items_playlist ON screen_playlist_items (playlist_id, sort_order);
ALTER TABLE screen_playlist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS screen_playlist_items_tenant ON screen_playlist_items;
CREATE POLICY screen_playlist_items_tenant ON screen_playlist_items
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS screens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id      uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name          text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  short_code    text        NOT NULL,     -- S1, S2 ... shown on the screen when identified
  width         int         NOT NULL DEFAULT 1920 CHECK (width BETWEEN 240 AND 8192),
  height        int         NOT NULL DEFAULT 1080 CHECK (height BETWEEN 240 AND 8192),
  rotation      int         NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270)),
  fit           text        NOT NULL DEFAULT 'contain' CHECK (fit IN ('contain', 'cover', 'stretch')),
  playlist_id   uuid        REFERENCES screen_playlists(id) ON DELETE SET NULL,
  design_id     uuid        REFERENCES screen_designs(id) ON DELETE SET NULL,
  secret_hash   text,
  paired_at     timestamptz,
  last_seen_at  timestamptz,
  app_version   text,
  device_info   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sort_order    int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, short_code),
  CHECK (playlist_id IS NULL OR design_id IS NULL)
);
CREATE INDEX IF NOT EXISTS screens_tenant ON screens (tenant_id, sort_order);
CREATE INDEX IF NOT EXISTS screens_venue ON screens (venue_id);
ALTER TABLE screens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS screens_tenant ON screens;
CREATE POLICY screens_tenant ON screens
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP TRIGGER IF EXISTS trg_screens_updated_at ON screens;
CREATE TRIGGER trg_screens_updated_at BEFORE UPDATE ON screens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Global, no RLS: a screen asks for a code before it belongs to a tenant.
-- The screen keeps the secret; once someone types the code in Screens the
-- secret's hash becomes the screen's own (screens.secret_hash).
CREATE TABLE IF NOT EXISTS screen_pairings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash    text        NOT NULL UNIQUE,
  secret_hash  text        NOT NULL,
  device_info  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  claimed_at   timestamptz,
  screen_id    uuid        REFERENCES screens(id) ON DELETE CASCADE,
  tenant_id    uuid        REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS screen_pairings_expires ON screen_pairings (expires_at);

-- ── Module ───────────────────────────────────────────────────
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'screens', true FROM tenants t
ON CONFLICT DO NOTHING;

UPDATE tenant_roles
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || jsonb_build_object('screens',
                          CASE WHEN is_builtin AND key IN ('owner', 'admin') THEN 'manage'
                               WHEN is_builtin AND key = 'operator' THEN 'view'
                               WHEN is_builtin THEN 'none'
                               ELSE COALESCE(permissions ->> 'menus', 'none') END)
 WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'screens');

-- ── Till: marking dishes sold out ────────────────────────────
UPDATE pos_roles SET permissions = permissions || '{"sold_out": true}'::jsonb
 WHERE name IN ('Supervisor', 'Manager') AND NOT (permissions ? 'sold_out');

-- ── Nav: "Screens" after each tenant's Menus link ────────────
DO $$
DECLARE m record;
BEGIN
  FOR m IN
    SELECT DISTINCT ON (n.tenant_id) n.id, n.tenant_id, n.parent_id, n.sort_order
      FROM nav_items n
     WHERE n.route = '/menus'
       AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = n.tenant_id AND x.route = '/screens')
     ORDER BY n.tenant_id, n.sort_order
  LOOP
    UPDATE nav_items SET sort_order = sort_order + 1
     WHERE tenant_id = m.tenant_id AND parent_id IS NOT DISTINCT FROM m.parent_id AND sort_order > m.sort_order;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (m.tenant_id, m.parent_id, 'link', 'Screens', 'Monitor', '/screens', 'screens', m.sort_order + 1);
  END LOOP;
END $$;

COMMIT;
