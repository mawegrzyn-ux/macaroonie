-- ============================================================
-- 048_menus.sql
--
-- Structured menu management — menus broken into sections, sections
-- into items, items with multiple price variants (Chicken £12.50 /
-- Pork £12.50 / Prawns £13.40 / Beef £13.00) + dietary / allergen tags
-- (vegan-able, gluten-free, nuts, spicy) + callouts for footer notes
-- (allergy info, "Go Large", "Make It Thai Hot", "Order & Book").
--
-- Data model:
--
--   menus
--     ├─ menu_sections (Starters, Soups, Curries, …)
--     │     └─ menu_items (Pad Thai, Massaman, …)
--     │           └─ menu_item_variants (Chicken / Pork / Prawns / Beef)
--     │           └─ menu_item_dietary  (M:N to menu_dietary_tags)
--     └─ menu_callouts (footer notes — allergy notice, Go Large, …)
--
-- A menu belongs to either a tenant (venue_id IS NULL → tenant-wide,
-- usable on every venue site) or a single venue (venue_id set →
-- location-specific). The website CMS picks one to render via the new
-- menu_inline block; the same menu can also be opened as a printable
-- HTML page at /menus/:menu_id/print and saved as PDF via the browser
-- print dialog (no server-side PDF dependency).
-- ============================================================

BEGIN;

-- ── menus ───────────────────────────────────────────────────

CREATE TABLE menus (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id        uuid        REFERENCES venues(id) ON DELETE CASCADE,
  -- Display
  name            text        NOT NULL,                              -- e.g. "Dinner Menu"
  slug            text        NOT NULL CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  tagline         text,                                              -- "classics, curries & everything in between"
  service_times   text,                                              -- "TUE–SAT · 6:00 PM – 10:30 PM"
  -- Top-of-menu intro line (e.g. "Looking for starters? Our dinner menu
  -- is available all day — just ask. All curry & rice…").
  intro_line      text,
  -- Settings
  is_published    boolean     NOT NULL DEFAULT true,
  sort_order      int         NOT NULL DEFAULT 0,
  -- Print layout
  print_columns   int         NOT NULL DEFAULT 4 CHECK (print_columns BETWEEN 1 AND 6),
  -- Audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Slug unique within (tenant_id, venue_id) — partial indexes below
  -- because Postgres treats NULL as distinct in unique constraints.
  CONSTRAINT menus_name_check CHECK (length(name) > 0)
);

CREATE UNIQUE INDEX menus_tenant_slug_uq
  ON menus (tenant_id, slug)
  WHERE venue_id IS NULL;

CREATE UNIQUE INDEX menus_venue_slug_uq
  ON menus (venue_id, slug)
  WHERE venue_id IS NOT NULL;

CREATE INDEX menus_tenant_venue_idx ON menus (tenant_id, venue_id, sort_order);

ALTER TABLE menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY menus_tenant ON menus
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TRIGGER trg_menus_updated_at
  BEFORE UPDATE ON menus
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── menu_sections ──────────────────────────────────────────

CREATE TABLE menu_sections (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id         uuid        NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title           text        NOT NULL,                              -- "Starters", "Soups", …
  subtitle        text,                                              -- "to begin", "bright & fragrant", …
  highlight       boolean     NOT NULL DEFAULT false,                -- featured/cream-bg section (Thai Specials)
  sort_order      int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX menu_sections_menu_idx ON menu_sections (menu_id, sort_order);

ALTER TABLE menu_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_sections_tenant ON menu_sections
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── menu_items ─────────────────────────────────────────────

CREATE TABLE menu_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id      uuid        NOT NULL REFERENCES menu_sections(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text        NOT NULL,                              -- "Pad Thai"
  native_name     text,                                              -- "ผัดไทย"
  description     text,                                              -- "Wok-tossed rice noodles, …"
  -- A single inline price for items without variants (e.g. Sides £7.50).
  -- When NULL, prices come from menu_item_variants. When both are set,
  -- variants take precedence (the inline price acts as a quick-edit
  -- shortcut for single-price items).
  price_pence     int         CHECK (price_pence IS NULL OR price_pence >= 0),
  notes           text,                                              -- "Min 2", "share or solo", "house favourites"
  is_featured     boolean     NOT NULL DEFAULT false,                -- highlight bg (Thai Specials items)
  sort_order      int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX menu_items_section_idx ON menu_items (section_id, sort_order);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_items_tenant ON menu_items
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TRIGGER trg_menu_items_updated_at
  BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── menu_item_variants ─────────────────────────────────────
-- Per-item price variants (e.g. Chicken £12.50, Pork £12.50, Prawns £13.40)

CREATE TABLE menu_item_variants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         uuid        NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label           text        NOT NULL,                              -- "Chicken", "Pork", "Veg & Tofu"
  price_pence     int         NOT NULL CHECK (price_pence >= 0),
  sort_order      int         NOT NULL DEFAULT 0
);

CREATE INDEX menu_item_variants_item_idx ON menu_item_variants (item_id, sort_order);

ALTER TABLE menu_item_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_item_variants_tenant ON menu_item_variants
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── menu_dietary_tags ──────────────────────────────────────
-- Per-tenant set of dietary / allergen icons (vegan-able, gluten-free,
-- nuts, spicy). Tenant can add custom ones.

CREATE TABLE menu_dietary_tags (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            text        NOT NULL CHECK (code ~ '^[a-z0-9_-]{1,16}$'),  -- 'gf', 'v', 'n', 'spicy'
  label           text        NOT NULL,                                       -- "Gluten-free"
  -- Single-letter / short-text glyph rendered in the badge. e.g. "GF", "V", "N", "🌶".
  glyph           text        NOT NULL,
  -- Hex colour for the badge background.
  colour          text        NOT NULL DEFAULT '#7a1a26'
                              CHECK (colour ~ '^#(?:[0-9a-fA-F]{3}){1,2}$'),
  sort_order      int         NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, code)
);

CREATE INDEX menu_dietary_tags_tenant_idx ON menu_dietary_tags (tenant_id, sort_order);

ALTER TABLE menu_dietary_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_dietary_tags_tenant ON menu_dietary_tags
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── menu_item_dietary ──────────────────────────────────────
-- Many-to-many between items and dietary tags.

CREATE TABLE menu_item_dietary (
  item_id         uuid        NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  tag_id          uuid        NOT NULL REFERENCES menu_dietary_tags(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX menu_item_dietary_tag_idx ON menu_item_dietary (tag_id);

ALTER TABLE menu_item_dietary ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_item_dietary_tenant ON menu_item_dietary
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── menu_callouts ──────────────────────────────────────────
-- Footer notes / call-out blocks. Per-menu, ordered. Predefined kinds:
--   'allergens'  — "Allergies & Diet" notice
--   'go_large'   — "Go Large" upgrade option
--   'thai_hot'   — "Make It Thai Hot" notice
--   'order_book' — "Order & Book" contact details
--   'custom'     — anything else
-- 'kind' is informational; rendering is driven by `title` + `body`.

CREATE TABLE menu_callouts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id         uuid        NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind            text        NOT NULL DEFAULT 'custom'
                              CHECK (kind IN ('allergens','go_large','thai_hot','order_book','custom')),
  title           text        NOT NULL,
  body            text,
  sort_order      int         NOT NULL DEFAULT 0
);

CREATE INDEX menu_callouts_menu_idx ON menu_callouts (menu_id, sort_order);

ALTER TABLE menu_callouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_callouts_tenant ON menu_callouts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;
