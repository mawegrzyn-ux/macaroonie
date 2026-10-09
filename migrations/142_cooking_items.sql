-- 142_cooking_items.sql
--
-- Cooking checks: where the dish buttons come from, per venue.
--
--   fs_cooking_settings  one row per venue: item_source
--                          'menus' = dishes on the venue's published menus
--                          'own'   = the venue's own list (fs_cooking_items)
--                          'both'  = menus first, then the own list
--                        No row = 'menus' (what the picker always did).
--   fs_cooking_items     the venue's own list: name + optional category
--                        (shown as its own tab), drag-ordered, soft delete.
--   fs_cooking_checks    gains cooking_item_id, the own-list item a reading
--                        was logged against (dish_name still holds the
--                        name at the time, like menu_item_id).
--
-- Checklists need no schema change: an instance now becomes 'completed'
-- when every active task is ticked (routes/checklists.js PUT /instance).

BEGIN;

CREATE TABLE IF NOT EXISTS fs_cooking_settings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  item_source  text        NOT NULL DEFAULT 'menus' CHECK (item_source IN ('menus', 'own', 'both')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id)
);

CREATE TABLE IF NOT EXISTS fs_cooking_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  name         text        NOT NULL,
  category     text,
  sort_order   int         NOT NULL DEFAULT 0,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fs_cooking_items_venue
  ON fs_cooking_items (tenant_id, venue_id, is_active, sort_order);

ALTER TABLE fs_cooking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fs_cooking_items    ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fs_cooking_settings' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON fs_cooking_settings
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fs_cooking_items' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON fs_cooking_items
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_fs_cooking_settings_updated_at ON fs_cooking_settings;
CREATE TRIGGER trg_fs_cooking_settings_updated_at
  BEFORE UPDATE ON fs_cooking_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_fs_cooking_items_updated_at ON fs_cooking_items;
CREATE TRIGGER trg_fs_cooking_items_updated_at
  BEFORE UPDATE ON fs_cooking_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE fs_cooking_checks
  ADD COLUMN IF NOT EXISTS cooking_item_id uuid REFERENCES fs_cooking_items(id) ON DELETE SET NULL;

COMMIT;
