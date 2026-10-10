-- 147_allergen_notice.sql
--
-- The allergen notice, built on Menus > Allergens & dietary. One per tenant:
--
--   menu_allergen_notice  title, body           the notice's own words
--                         removable_note        explains the "*" on a dish
--                                               whose allergen can be removed
--                         ordering_text         extra line on the online
--                                               ordering page only (blank =
--                                               none)
--                         used_only             the key lists only the ticked
--                                               tags the menu's dishes use
--                                               (true) or every ticked tag
--   menu_dietary_tags.in_key  whether a tag is in the notice's key (ticked).
--                             New tags are in it. A tag hidden on menus
--                             (show_on_menu off) is never in it.
--
-- The notice shows on printed menus (an "Allergies & Diet" footer note and
-- the designer's key / footer notes blocks), the dietary list, the website
-- Menu (inline) block and the online ordering page. A footer note of kind
-- 'allergens' no longer uses its own title and text: it shows this notice.
-- Each tenant's notice starts from its first such footer note, if any.

BEGIN;

ALTER TABLE menu_dietary_tags
  ADD COLUMN IF NOT EXISTS in_key boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS menu_allergen_notice (
  tenant_id       uuid        PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  title           text        NOT NULL DEFAULT 'Allergies & Diet',
  body            text        NOT NULL DEFAULT 'Please tell us about any allergies or dietary needs before you order.',
  removable_note  text        NOT NULL DEFAULT 'Can be removed on request',
  ordering_text   text        NOT NULL DEFAULT 'Use the allergy note at checkout to tell us what we need to know.',
  used_only       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE menu_allergen_notice ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'menu_allergen_notice' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON menu_allergen_notice
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_menu_allergen_notice_updated_at ON menu_allergen_notice;
CREATE TRIGGER trg_menu_allergen_notice_updated_at
  BEFORE UPDATE ON menu_allergen_notice
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Start from the words of each tenant's first "Allergies & Diet" footer note.
INSERT INTO menu_allergen_notice (tenant_id, title, body)
SELECT DISTINCT ON (c.tenant_id) c.tenant_id, c.title, COALESCE(c.body, '')
  FROM menu_callouts c
  JOIN menus m ON m.id = c.menu_id
 WHERE c.kind = 'allergens'
 ORDER BY c.tenant_id, m.created_at, c.sort_order
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;
