-- 157_deliveroo.sql
--
-- Deliveroo menu file (Menus > Deliveroo): read the bulk-management CSV a
-- venue downloads from the Deliveroo Hub, fill it from our menus, review,
-- edit and download it again for upload. The file itself is never stored;
-- what's kept is how to fill it.
--
--   deliveroo_settings     one per venue: which menus to match against
--                          (empty = every published menu of the venue and
--                          the company), the price rule (menu price + %,
--                          rounded up / to the nearest 1p, 5p, 10p, 50p or
--                          £1), which columns are filled, and how our tags
--                          become Deliveroo codes:
--                            allergen_map { "<menu_dietary_tags.code>": ["eggs", ...] }
--                            dietary_map  { "<menu_dietary_tags.code>": ["vegan", ...] }
--                          plus whether May contain / Can be removed
--                          allergens are listed.
--   deliveroo_item_links   one per venue per Deliveroo item_id: the dish it
--                          is filled from (menu_item_id, no foreign key:
--                          upsertMenuTree() re-inserts dishes on every
--                          menu save), or skip; columns where Deliveroo's
--                          value is kept (keep); and values typed in the
--                          review (overrides { "<column>": "<text>" }).

BEGIN;

CREATE TABLE deliveroo_settings (
  venue_id             uuid         PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id            uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  menu_ids             uuid[]       NOT NULL DEFAULT '{}',
  price_uplift_pct     numeric(6,2) NOT NULL DEFAULT 0 CHECK (price_uplift_pct BETWEEN -50 AND 200),
  price_round_pence    int          NOT NULL DEFAULT 1 CHECK (price_round_pence IN (1, 5, 10, 50, 100)),
  price_round_mode     text         NOT NULL DEFAULT 'up' CHECK (price_round_mode IN ('up', 'nearest')),
  fill                 jsonb        NOT NULL DEFAULT '{}'::jsonb,
  allergen_map         jsonb        NOT NULL DEFAULT '{}'::jsonb,
  dietary_map          jsonb        NOT NULL DEFAULT '{}'::jsonb,
  include_may_contain  boolean      NOT NULL DEFAULT true,
  include_removable    boolean      NOT NULL DEFAULT true,
  updated_by           text,
  updated_at           timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX deliveroo_settings_tenant ON deliveroo_settings (tenant_id);

CREATE TABLE deliveroo_item_links (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id           uuid         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  deliveroo_item_id  text         NOT NULL CHECK (length(deliveroo_item_id) BETWEEN 1 AND 200),
  deliveroo_name     text,
  menu_item_id       uuid,
  skip               boolean      NOT NULL DEFAULT false,
  keep               text[]       NOT NULL DEFAULT '{}',
  overrides          jsonb        NOT NULL DEFAULT '{}'::jsonb,
  updated_by         text,
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (venue_id, deliveroo_item_id)
);
CREATE INDEX deliveroo_item_links_tenant ON deliveroo_item_links (tenant_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['deliveroo_settings', 'deliveroo_item_links']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

-- Nav: "Deliveroo menu" under each tenant's /menus link, after its children.
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
SELECT m.tenant_id, m.id, 'link', 'Deliveroo menu', 'Bike', '/menus/deliveroo', 'menus',
       COALESCE((SELECT MAX(c.sort_order) + 1 FROM nav_items c WHERE c.parent_id = m.id), 0)
  FROM nav_items m
 WHERE m.route = '/menus'
   AND m.id = (SELECT n.id FROM nav_items n
                WHERE n.tenant_id = m.tenant_id AND n.route = '/menus'
                ORDER BY n.sort_order LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM nav_items x
                    WHERE x.tenant_id = m.tenant_id AND x.route = '/menus/deliveroo');

COMMIT;
