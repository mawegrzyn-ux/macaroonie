-- ============================================================
-- 040_media_library.sql
--
-- Per-tenant media library — images only for now.
--
-- Two new tables:
--
--   1. media_categories — user-created flat tags ("Hero shots",
--      "Menu", "Team photos", etc.). Tenant-scoped, RLS-enforced.
--      Deleting a category nulls out media_items.category_id
--      (items remain, just become uncategorized).
--
--   2. media_items — every uploaded image lives here. Has a
--      `scope` field that's either 'shared' (global library)
--      or a form key like 'website:hero', 'brand:logo'. The
--      modal's "form filter" derives its dropdown options from
--      DISTINCT scope values found in the table for the tenant.
--
-- Storage URL/key follow the same pattern as the existing
-- website upload flow (storageSvc.put returns { url, key }):
-- url is what's served to the browser; storage_key is the
-- backend-specific identifier used to delete.
--
-- `hash` is a SHA-256 of the file contents — used by the
-- duplicate-check endpoint to warn an editor before re-uploading
-- an identical file.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS media_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE media_categories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'media_categories' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON media_categories
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE TRIGGER trg_media_categories_updated_at
  BEFORE UPDATE ON media_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE IF NOT EXISTS media_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id  uuid        REFERENCES media_categories(id) ON DELETE SET NULL,
  scope        text        NOT NULL DEFAULT 'shared',
  filename     text        NOT NULL,
  url          text        NOT NULL,
  storage_key  text        NOT NULL,
  mimetype     text        NOT NULL,
  bytes        bigint      NOT NULL,
  width        int,
  height       int,
  hash         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE media_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'media_items' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON media_items
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE TRIGGER trg_media_items_updated_at
  BEFORE UPDATE ON media_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS media_items_tenant_scope_idx     ON media_items (tenant_id, scope);
CREATE INDEX IF NOT EXISTS media_items_tenant_category_idx  ON media_items (tenant_id, category_id);
CREATE INDEX IF NOT EXISTS media_items_tenant_hash_idx      ON media_items (tenant_id, hash) WHERE hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_items_tenant_filename_idx  ON media_items (tenant_id, lower(filename));

COMMIT;
