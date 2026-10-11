-- 153_purchasing.sql
--
-- Purchasing replaces order sheets (start fresh: the old order sheet tables
-- and their data are dropped). Same idea as the COGS tool's inventory:
--
--   inv_items        the product list. No price column: what a product costs
--                    comes from supplier quotes.
--   suppliers        who sells, how orders reach them (email / print / Excel
--                    / PDF), cutoff, lead days, delivery days, min order.
--   inv_quotes       a product as one supplier sells it: a pack (name, count
--                    x size + unit -> pack_base_qty in the item's base unit),
--                    price per pack ex VAT, VAT rate. A supplier may have
--                    several quotes for the same product (different packs).
--   inv_quote_venue_prices  a venue's own price for a quote (else the
--                    company price on the quote).
--   inv_preferred    which quote a product is ordered on: company default
--                    (venue_id NULL) and per-venue choices. No choice =
--                    cheapest per base unit (shared/procurement.js).
--   order_lists      what a venue orders from (any mix of suppliers), with
--                    a par per venue in BASE units (shown in packs).
--   supply_orders    a venue filling in an order list (draft), split into
--                    one purchase order per supplier when submitted.
--   purchase_orders  what goes to a supplier, with copies of pack, price and
--                    VAT on each line; received quantities on the lines.
--
-- Every table carries tenant_id and every route filters it explicitly.

BEGIN;

-- ── Old order sheets out ────────────────────────────────────────
ALTER TABLE fs_delivery_checks DROP COLUMN IF EXISTS order_sheet_id;
DROP TABLE IF EXISTS order_sheet_order_items, order_sheets, order_sheet_suggested_qty,
                     order_sheet_items, order_sheet_template_venues,
                     order_sheet_templates, order_sheet_categories CASCADE;

-- ── Catalogue ───────────────────────────────────────────────────
CREATE TABLE inv_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inv_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  category_id uuid        REFERENCES inv_categories(id) ON DELETE SET NULL,
  base_unit   text        NOT NULL DEFAULT 'each' CHECK (base_unit IN ('g', 'ml', 'each')),
  storage     text        NOT NULL DEFAULT 'ambient' CHECK (storage IN ('ambient', 'chilled', 'frozen')),
  code        text,
  notes       text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inv_items_tenant_name ON inv_items (tenant_id, lower(name));

CREATE TABLE suppliers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  contact_name     text,
  phone            text,
  email            text,
  cc_emails        text,
  website          text,
  account_ref      text,
  send_method      text        NOT NULL DEFAULT 'email' CHECK (send_method IN ('email', 'print', 'excel', 'pdf')),
  email_attachment text        NOT NULL DEFAULT 'pdf'   CHECK (email_attachment IN ('none', 'pdf', 'excel')),
  cutoff_time      time,
  lead_days        int         NOT NULL DEFAULT 1 CHECK (lead_days BETWEEN 0 AND 30),
  delivery_days    int[]       NOT NULL DEFAULT '{}',
  min_order        numeric(10,2),
  delivery_charge  numeric(10,2),
  notes            text,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Per-venue differences only; no row = the supplier's own settings.
CREATE TABLE supplier_venues (
  supplier_id   uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  venue_id      uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_ref   text,
  delivery_days int[],
  cutoff_time   time,
  PRIMARY KEY (supplier_id, venue_id)
);

CREATE TABLE inv_quotes (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id        uuid          NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  supplier_id    uuid          NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_code  text,
  pack_name      text          NOT NULL DEFAULT 'pack',
  pack_count     numeric(10,3) NOT NULL DEFAULT 1 CHECK (pack_count > 0),
  pack_qty       numeric(12,3) NOT NULL CHECK (pack_qty > 0),
  pack_unit      text          NOT NULL,
  pack_base_qty  numeric(16,4) NOT NULL CHECK (pack_base_qty > 0),
  price          numeric(12,4) NOT NULL CHECK (price >= 0),
  vat_rate       numeric(5,2)  NOT NULL DEFAULT 0 CHECK (vat_rate >= 0 AND vat_rate <= 100),
  min_qty        numeric(10,3) CHECK (min_qty IS NULL OR min_qty > 0),
  order_multiple numeric(10,3) CHECK (order_multiple IS NULL OR order_multiple > 0),
  is_active      boolean       NOT NULL DEFAULT true,
  notes          text,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX inv_quotes_item ON inv_quotes (tenant_id, item_id);
CREATE INDEX inv_quotes_supplier ON inv_quotes (tenant_id, supplier_id);

CREATE TABLE inv_quote_venue_prices (
  quote_id  uuid          NOT NULL REFERENCES inv_quotes(id) ON DELETE CASCADE,
  venue_id  uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  price     numeric(12,4) NOT NULL CHECK (price >= 0),
  PRIMARY KEY (quote_id, venue_id)
);

-- Every price a quote has had, company-wide (venue_id NULL) or for a venue.
CREATE TABLE inv_price_history (
  id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id   uuid          NOT NULL REFERENCES inv_quotes(id) ON DELETE CASCADE,
  venue_id   uuid          REFERENCES venues(id) ON DELETE CASCADE,
  price      numeric(12,4),
  changed_at timestamptz   NOT NULL DEFAULT now(),
  changed_by text,
  source     text          NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import'))
);
CREATE INDEX inv_price_history_quote ON inv_price_history (quote_id, changed_at DESC);

CREATE TABLE inv_preferred (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id    uuid        NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  venue_id   uuid        REFERENCES venues(id) ON DELETE CASCADE,
  quote_id   uuid        NOT NULL REFERENCES inv_quotes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inv_preferred_default ON inv_preferred (item_id) WHERE venue_id IS NULL;
CREATE UNIQUE INDEX inv_preferred_venue   ON inv_preferred (item_id, venue_id) WHERE venue_id IS NOT NULL;

-- ── Order lists ─────────────────────────────────────────────────
CREATE TABLE order_lists (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  notes       text,
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_list_venues (
  list_id   uuid NOT NULL REFERENCES order_lists(id) ON DELETE CASCADE,
  venue_id  uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, venue_id)
);

CREATE TABLE order_list_items (
  id         uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  list_id    uuid NOT NULL REFERENCES order_lists(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  sort_order int  NOT NULL DEFAULT 0,
  UNIQUE (list_id, item_id)
);

-- Par per venue, in the item's base unit so a pack change doesn't break it.
CREATE TABLE order_list_pars (
  list_item_id uuid          NOT NULL REFERENCES order_list_items(id) ON DELETE CASCADE,
  venue_id     uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id    uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  par_base     numeric(16,4) NOT NULL CHECK (par_base >= 0),
  PRIMARY KEY (list_item_id, venue_id)
);

-- ── Orders ──────────────────────────────────────────────────────
CREATE TABLE supply_orders (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  list_id      uuid        REFERENCES order_lists(id) ON DELETE SET NULL,
  status       text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  notes        text,
  created_by   text,
  submitted_by text,
  submitted_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supply_orders_venue ON supply_orders (tenant_id, venue_id, status);

-- qty in packs of quote_id (the quote the line was filled in on).
CREATE TABLE supply_order_lines (
  order_id  uuid          NOT NULL REFERENCES supply_orders(id) ON DELETE CASCADE,
  item_id   uuid          NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  tenant_id uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id  uuid          REFERENCES inv_quotes(id) ON DELETE SET NULL,
  qty       numeric(10,3) NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (order_id, item_id)
);

CREATE TABLE purchase_orders (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number           int           NOT NULL,
  supply_order_id  uuid          REFERENCES supply_orders(id) ON DELETE SET NULL,
  venue_id         uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  supplier_id      uuid          NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status           text          NOT NULL DEFAULT 'to_send'
                                 CHECK (status IN ('to_send', 'sent', 'received', 'cancelled')),
  delivery_date    date          NOT NULL,
  notes            text,
  subtotal         numeric(12,2) NOT NULL DEFAULT 0,
  vat              numeric(12,2) NOT NULL DEFAULT 0,
  delivery_charge  numeric(12,2) NOT NULL DEFAULT 0,
  total            numeric(12,2) NOT NULL DEFAULT 0,
  created_by       text,
  sent_at          timestamptz,
  sent_by          text,
  sent_via         text          CHECK (sent_via IS NULL OR sent_via IN ('email', 'print', 'excel', 'pdf', 'phone', 'other')),
  sent_to          text,
  send_error       text,
  received_at      timestamptz,
  received_by      text,
  receive_notes    text,
  cancelled_at     timestamptz,
  cancelled_by     text,
  is_generated     boolean       NOT NULL DEFAULT false,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);
CREATE INDEX purchase_orders_venue ON purchase_orders (tenant_id, venue_id, status, delivery_date);

CREATE TABLE purchase_order_lines (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_id          uuid          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id        uuid          REFERENCES inv_items(id) ON DELETE SET NULL,
  quote_id       uuid          REFERENCES inv_quotes(id) ON DELETE SET NULL,
  item_name      text          NOT NULL,
  category_name  text,
  storage        text          NOT NULL DEFAULT 'ambient',
  base_unit      text          NOT NULL,
  supplier_code  text,
  pack_label     text          NOT NULL,
  pack_base_qty  numeric(16,4) NOT NULL,
  price          numeric(12,4) NOT NULL,
  vat_rate       numeric(5,2)  NOT NULL DEFAULT 0,
  qty            numeric(10,3) NOT NULL CHECK (qty > 0),
  received_qty   numeric(10,3),
  receive_status text          CHECK (receive_status IS NULL OR receive_status IN ('ok', 'short', 'damaged', 'substituted', 'missing')),
  receive_note   text,
  sort_order     int           NOT NULL DEFAULT 0
);
CREATE INDEX purchase_order_lines_po ON purchase_order_lines (po_id, sort_order);

ALTER TABLE fs_delivery_checks
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fs_delivery_checks_po
  ON fs_delivery_checks (purchase_order_id) WHERE purchase_order_id IS NOT NULL;

-- ── Row security (same policy as every tenant table) ────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inv_categories', 'inv_items', 'suppliers', 'supplier_venues', 'inv_quotes',
                           'inv_quote_venue_prices', 'inv_price_history', 'inv_preferred', 'order_lists',
                           'order_list_venues', 'order_list_items', 'order_list_pars', 'supply_orders',
                           'supply_order_lines', 'purchase_orders', 'purchase_order_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

-- Default categories for every tenant (new tenants: seedPurchasing()).
INSERT INTO inv_categories (tenant_id, name, sort_order)
SELECT t.id, c.name, c.so
  FROM tenants t
 CROSS JOIN (VALUES
   ('Vegetables', 0), ('Fruit', 1), ('Herbs & Garnish', 2), ('Meat & Poultry', 3),
   ('Fish & Seafood', 4), ('Dairy & Eggs', 5), ('Dry Goods', 6),
   ('Oils, Sauces & Condiments', 7), ('Bakery', 8), ('Beverages', 9),
   ('Cleaning Supplies', 10), ('Packaging', 11)
 ) AS c(name, so);

-- ── Modules: order_sheets -> purchasing, order_sheet_setup -> purchasing_setup ──
UPDATE tenant_modules SET module_key = 'purchasing'       WHERE module_key = 'order_sheets'
   AND NOT EXISTS (SELECT 1 FROM tenant_modules m2 WHERE m2.tenant_id = tenant_modules.tenant_id AND m2.module_key = 'purchasing');
UPDATE tenant_modules SET module_key = 'purchasing_setup' WHERE module_key = 'order_sheet_setup'
   AND NOT EXISTS (SELECT 1 FROM tenant_modules m2 WHERE m2.tenant_id = tenant_modules.tenant_id AND m2.module_key = 'purchasing_setup');
DELETE FROM tenant_modules WHERE module_key IN ('order_sheets', 'order_sheet_setup');

-- Built-in roles get the new defaults (restaurant staff place orders, only
-- owners and admins set up the catalogue); custom roles keep what they had.
UPDATE tenant_roles
   SET permissions = (permissions - 'order_sheets' - 'order_sheet_setup')
                     || jsonb_build_object('purchasing',
                          CASE WHEN is_builtin THEN CASE key WHEN 'viewer' THEN 'view' ELSE 'manage' END
                               ELSE COALESCE(permissions ->> 'order_sheets', 'none') END)
                     || jsonb_build_object('purchasing_setup',
                          CASE WHEN is_builtin THEN CASE key WHEN 'owner' THEN 'manage' WHEN 'admin' THEN 'manage' ELSE 'none' END
                               ELSE COALESCE(permissions ->> 'order_sheet_setup', 'none') END);

-- ── Nav: Order sheets -> Purchasing (Order lists, Inventory, Suppliers) ──
UPDATE nav_items SET route = '/purchasing', module = 'purchasing', icon = 'ShoppingCart',
       label = CASE WHEN label = 'Order sheets' THEN 'Purchasing' ELSE label END
 WHERE route = '/order-sheets';
UPDATE nav_items SET route = '/purchasing/lists', module = 'purchasing_setup',
       label = CASE WHEN label = 'Templates' THEN 'Order lists' ELSE label END
 WHERE route = '/order-sheets/templates';
UPDATE nav_items SET route = '/inventory', module = 'purchasing_setup', icon = 'Package',
       label = CASE WHEN label = 'Categories' THEN 'Inventory' ELSE label END
 WHERE route = '/order-sheets/categories';
UPDATE nav_items SET module = 'purchasing' WHERE module = 'order_sheets';
UPDATE nav_items SET module = 'purchasing_setup' WHERE module = 'order_sheet_setup';

-- Suppliers link right after Inventory, for tenants that have it.
DO $$
DECLARE n record;
BEGIN
  FOR n IN SELECT tenant_id, parent_id, sort_order FROM nav_items WHERE route = '/inventory' LOOP
    IF EXISTS (SELECT 1 FROM nav_items s WHERE s.tenant_id = n.tenant_id AND s.route = '/suppliers') THEN
      CONTINUE;
    END IF;
    UPDATE nav_items SET sort_order = sort_order + 1
     WHERE tenant_id = n.tenant_id AND parent_id IS NOT DISTINCT FROM n.parent_id AND sort_order > n.sort_order;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (n.tenant_id, n.parent_id, 'link', 'Suppliers', 'Truck', '/suppliers', 'purchasing_setup', n.sort_order + 1);
  END LOOP;
END $$;

COMMIT;
