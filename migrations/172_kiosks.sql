-- 172_kiosks.sql
-- Self-order kiosks (docs/POS.md section 10): guests build their own order on
-- a big touch screen and pay by card or at the counter. A kiosk is a paired
-- till device of kind 'kiosk' that puts orders in as counter checks, through
-- the same sequencer as the tills (shared/pos/checks.js: kiosk rules).
--
--   pos_devices.kind           'kiosk' (settings: revenue_stream_id, design_id,
--                              card_reader 'none' | 'test', receipt_printer_id)
--   kiosk_designs              how a tenant's kiosks look and behave (settings
--                              jsonb, shared/kiosk.js normaliseDesign()):
--                              brand, start screen, languages, menu home
--                              (banners, featured tiles), option displays,
--                              checkout, timeouts
--   menu_variant_groups        kiosk_display (grid | list | slider | wheel,
--                              NULL = the design's default), scale_low /
--                              scale_high (the ends of a heat scale: "No spice",
--                              "Very spicy")
--   menu_variant_options       image_url, description, level (0-5 on that
--                              scale): kiosk option cards. Like the groups,
--                              they change straight away (not per publish)
--   menu_translations          the menu's words in other languages for the
--                              kiosk (key 'item:<id>:name' ..., shared/kiosk.js
--                              TK), tenant-wide; edited on Menus > Translations
--                              (nav link added below)

BEGIN;

ALTER TABLE pos_devices DROP CONSTRAINT IF EXISTS pos_devices_kind_check;
ALTER TABLE pos_devices ADD CONSTRAINT pos_devices_kind_check CHECK (kind IN ('terminal', 'hub', 'kds', 'kiosk'));

CREATE TABLE kiosk_designs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  settings    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kiosk_designs_tenant ON kiosk_designs (tenant_id);
ALTER TABLE kiosk_designs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kiosk_designs USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE menu_variant_groups
  ADD COLUMN IF NOT EXISTS kiosk_display text CHECK (kiosk_display IN ('grid', 'list', 'slider', 'wheel')),
  ADD COLUMN IF NOT EXISTS scale_low     text CHECK (length(scale_low) <= 40),
  ADD COLUMN IF NOT EXISTS scale_high    text CHECK (length(scale_high) <= 40);

ALTER TABLE menu_variant_options
  ADD COLUMN IF NOT EXISTS image_url   text,
  ADD COLUMN IF NOT EXISTS description text CHECK (length(description) <= 300),
  ADD COLUMN IF NOT EXISTS level       smallint CHECK (level BETWEEN 0 AND 5);

CREATE TABLE menu_translations (
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lang        text        NOT NULL CHECK (lang ~ '^[a-z]{2}$'),
  key         text        NOT NULL CHECK (length(key) <= 200),
  text        text        NOT NULL CHECK (length(text) <= 2000),
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, lang, key)
);
ALTER TABLE menu_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_translations USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Nav: "Translations" under each tenant's /menus link, after its children.
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
SELECT m.tenant_id, m.id, 'link', 'Translations', 'Languages', '/menus/translations', 'menus',
       COALESCE((SELECT MAX(c.sort_order) + 1 FROM nav_items c WHERE c.parent_id = m.id), 0)
  FROM nav_items m
 WHERE m.route = '/menus'
   AND m.id = (SELECT n.id FROM nav_items n
                WHERE n.tenant_id = m.tenant_id AND n.route = '/menus'
                ORDER BY n.sort_order LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM nav_items x
                    WHERE x.tenant_id = m.tenant_id AND x.route = '/menus/translations');

COMMIT;
