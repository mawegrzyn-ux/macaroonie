-- 156_pos.sql
--
-- The till (POS): docs/POS.md. Table service and counter service on
-- tablets at pos.{root}, a separate app (pos/) that keeps working offline.
--
-- Setup (admin, Till setup / Floor plan pages, module pos_setup):
--   pos_settings          one per venue: trading-day start, VAT defaults,
--                         receipt words, tenders, counter order numbers,
--                         the Cash Recon mapping, the venue's PIN salt
--   pos_revenue_centres   Restaurant / Bar / Takeaway: VAT eat-in or
--                         takeaway, which menus, default service charge
--   pos_roles             what a person may do on the till (shared/pos/permissions.js)
--   cash_staff +          pos_pin_hash (PBKDF2 of the PIN with the venue's
--                         salt, so a PIN alone finds the person), pos_role_id
--   pos_courses           Drinks / Starters / Mains / Desserts; menu sections
--                         and dishes pick their course (pos_course_id)
--   pos_printers          network printers (hub prints to them later)
--   pos_print_routes      dish / section / revenue centre / default -> printer
--   floor_areas           the floor plan's rooms; tables get a position
--   pos_devices           tills and (later) hubs; paired with a one-time code
--
-- Menu additions (saved with the menu by upsertMenuTree, so they keep their
-- values across menu saves; no foreign keys into the menu tree because a
-- save re-inserts sections and dishes under their ids):
--   menu_items: kind ('dish' | 'combo'), kitchen_name, pos_course_id,
--               pos_colour, combo (meal deal slots, jsonb)
--   menu_sections: pos_course_id, pos_colour
--   menu_variant_groups: pos_prefixes (No / Light / Extra on the till)
--   menu_variant_options: child_group_id (choosing it asks another group)
--
-- Trading (written by the sequencer, services/posSvc.js + shared/pos/sequencer.js):
--   pos_venue_state       last event number, next check / order number, open day
--   pos_days              trading days (closed by the Z report)
--   pos_events            every till event in order (kept 6 years: VAT records)
--   pos_event_rejections  events refused (offline conflicts) for a manager to review
--   pos_checks            check state (projection of the events)
--   pos_check_lines       one row per check line, for reports
--   pos_payments          payments and refunds, for reports
--   pos_print_jobs        tickets waiting for a printer (the venue hub, later)
--   cash_daily_reports +  pos_filled_at / pos_filled_by (Z report fills the day)
--   promotions +          channels: 'online' and / or 'pos'
--
-- Ids made on the till (events, checks, lines, payments) are ULIDs (text).

BEGIN;

-- ── Settings ───────────────────────────────────────────────────
CREATE TABLE pos_settings (
  venue_id                   uuid         PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id                  uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pin_salt                   text         NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  day_starts_at              text         NOT NULL DEFAULT '04:00' CHECK (day_starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  default_vat_rate_eat_in    numeric(5,2) NOT NULL DEFAULT 20 CHECK (default_vat_rate_eat_in BETWEEN 0 AND 100),
  default_vat_rate_takeaway  numeric(5,2) NOT NULL DEFAULT 20 CHECK (default_vat_rate_takeaway BETWEEN 0 AND 100),
  vat_number                 text,
  receipt_name               text,
  receipt_address            text[]       NOT NULL DEFAULT '{}',
  receipt_footer             text,
  bill_footer                text,
  service_charge_label       text,
  -- [{ key: 'cash' | 'card_external' | 'voucher' | 'account' | 'other', label, enabled }]
  tenders                    jsonb        NOT NULL DEFAULT '[]'::jsonb,
  tips_enabled               boolean      NOT NULL DEFAULT true,
  require_covers             boolean      NOT NULL DEFAULT true,
  order_no_start             int          NOT NULL DEFAULT 1 CHECK (order_no_start BETWEEN 1 AND 900),
  auto_logout_secs           int          NOT NULL DEFAULT 0 CHECK (auto_logout_secs BETWEEN 0 AND 3600),
  counter_revenue_centre_id  uuid,
  -- { income: { <cash_income_sources.id>: [revenue_centre_id | 'all'] },
  --   takings: { <cash_payment_channels.id>: [tender key] },
  --   sc: { <cash_sc_sources.id>: ['service_charge' | 'tips'] } }
  recon_map                  jsonb        NOT NULL DEFAULT '{}'::jsonb,
  recon_auto_fill            boolean      NOT NULL DEFAULT true,
  created_at                 timestamptz  NOT NULL DEFAULT now(),
  updated_at                 timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE pos_revenue_centres (
  id                         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id                   uuid         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name                       text         NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  vat_mode                   text         NOT NULL DEFAULT 'eat_in' CHECK (vat_mode IN ('eat_in', 'takeaway')),
  menu_ids                   uuid[]       NOT NULL DEFAULT '{}',
  service_charge_percent     numeric(5,2) NOT NULL DEFAULT 0 CHECK (service_charge_percent BETWEEN 0 AND 50),
  service_charge_min_covers  int          NOT NULL DEFAULT 0 CHECK (service_charge_min_covers BETWEEN 0 AND 100),
  colour                     text,
  sort_order                 int          NOT NULL DEFAULT 0,
  is_active                  boolean      NOT NULL DEFAULT true,
  created_at                 timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX pos_revenue_centres_venue ON pos_revenue_centres (venue_id, sort_order);

ALTER TABLE pos_settings
  ADD CONSTRAINT pos_settings_counter_rc_fk FOREIGN KEY (counter_revenue_centre_id)
  REFERENCES pos_revenue_centres(id) ON DELETE SET NULL;

-- ── Roles and PINs ─────────────────────────────────────────────
CREATE TABLE pos_roles (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text        NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  permissions  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_roles_tenant ON pos_roles (tenant_id, sort_order);

ALTER TABLE cash_staff
  ADD COLUMN IF NOT EXISTS pos_pin_hash text,
  ADD COLUMN IF NOT EXISTS pos_role_id  uuid REFERENCES pos_roles(id) ON DELETE SET NULL;
-- A PIN finds one person in a venue (the hash uses the venue's salt).
CREATE UNIQUE INDEX cash_staff_pos_pin_uq ON cash_staff (venue_id, pos_pin_hash) WHERE pos_pin_hash IS NOT NULL;

-- ── Courses ────────────────────────────────────────────────────
CREATE TABLE pos_courses (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             text        NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  short_name       text,
  hold_by_default  boolean     NOT NULL DEFAULT false,
  colour           text,
  sort_order       int         NOT NULL DEFAULT 0,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_courses_tenant ON pos_courses (tenant_id, sort_order);

-- ── Menu additions ─────────────────────────────────────────────
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS kind          text NOT NULL DEFAULT 'dish' CHECK (kind IN ('dish', 'combo')),
  ADD COLUMN IF NOT EXISTS kitchen_name  text,
  ADD COLUMN IF NOT EXISTS pos_course_id uuid,
  ADD COLUMN IF NOT EXISTS pos_colour    text,
  -- { slots: [{ id, name, min, max, item_ids: [], section_ids: [], upcharges: { item_id: pence } }] }
  ADD COLUMN IF NOT EXISTS combo         jsonb;
ALTER TABLE menu_sections
  ADD COLUMN IF NOT EXISTS pos_course_id uuid,
  ADD COLUMN IF NOT EXISTS pos_colour    text;
ALTER TABLE menu_variant_groups
  ADD COLUMN IF NOT EXISTS pos_prefixes boolean NOT NULL DEFAULT false;
ALTER TABLE menu_variant_options
  ADD COLUMN IF NOT EXISTS child_group_id uuid REFERENCES menu_variant_groups(id) ON DELETE SET NULL;

-- ── Printers ───────────────────────────────────────────────────
CREATE TABLE pos_printers (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id           uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name               text        NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  kind               text        NOT NULL DEFAULT 'station' CHECK (kind IN ('station', 'receipt')),
  host               text,
  port               int         NOT NULL DEFAULT 9100 CHECK (port BETWEEN 1 AND 65535),
  columns            int         NOT NULL DEFAULT 42 CHECK (columns BETWEEN 24 AND 64),
  backup_printer_id  uuid        REFERENCES pos_printers(id) ON DELETE SET NULL,
  sort_order         int         NOT NULL DEFAULT 0,
  is_active          boolean     NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_printers_venue ON pos_printers (venue_id, sort_order);

-- target_id: a dish / section / revenue centre id (NULL for 'default').
-- No foreign key: dishes and sections are re-inserted by menu saves.
CREATE TABLE pos_print_routes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  printer_id   uuid        NOT NULL REFERENCES pos_printers(id) ON DELETE CASCADE,
  target_kind  text        NOT NULL CHECK (target_kind IN ('item', 'section', 'revenue_centre', 'default')),
  target_id    uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((target_kind = 'default') = (target_id IS NULL))
);
CREATE UNIQUE INDEX pos_print_routes_uq ON pos_print_routes (venue_id, printer_id, target_kind, COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ── Floor plan ─────────────────────────────────────────────────
CREATE TABLE floor_areas (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id            uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name                text        NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  width               int         NOT NULL DEFAULT 24 CHECK (width BETWEEN 6 AND 80),
  height              int         NOT NULL DEFAULT 16 CHECK (height BETWEEN 4 AND 60),
  revenue_centre_id   uuid        REFERENCES pos_revenue_centres(id) ON DELETE SET NULL,
  -- walls, bar counters, labels: [{ id, kind: 'label' | 'wall' | 'bar' | 'plant', x, y, w, h, text }]
  decor               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  sort_order          int         NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX floor_areas_venue ON floor_areas (venue_id, sort_order);

-- Position on the plan, in grid cells of the area.
ALTER TABLE tables
  ADD COLUMN IF NOT EXISTS floor_area_id uuid REFERENCES floor_areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_x    numeric(6,2),
  ADD COLUMN IF NOT EXISTS pos_y    numeric(6,2),
  ADD COLUMN IF NOT EXISTS pos_w    numeric(6,2),
  ADD COLUMN IF NOT EXISTS pos_h    numeric(6,2),
  ADD COLUMN IF NOT EXISTS shape    text NOT NULL DEFAULT 'rect',
  ADD COLUMN IF NOT EXISTS rotation int  NOT NULL DEFAULT 0;
ALTER TABLE tables DROP CONSTRAINT IF EXISTS tables_shape_check;
ALTER TABLE tables ADD CONSTRAINT tables_shape_check CHECK (shape IN ('rect', 'round'));
ALTER TABLE tables DROP CONSTRAINT IF EXISTS tables_rotation_check;
ALTER TABLE tables ADD CONSTRAINT tables_rotation_check CHECK (rotation IN (0, 90, 180, 270));

-- ── Devices ────────────────────────────────────────────────────
CREATE TABLE pos_devices (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id            uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  kind                text        NOT NULL DEFAULT 'terminal' CHECK (kind IN ('terminal', 'hub')),
  name                text        NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  -- Short code on offline check numbers (T2-0041).
  short_code          text        NOT NULL,
  secret_hash         text,
  pairing_code_hash   text,
  pairing_expires_at  timestamptz,
  paired_at           timestamptz,
  last_seen_at        timestamptz,
  app_version         text,
  user_agent          text,
  -- { mode: 'table' | 'counter', revenue_centre_id, receipt_printer_id, floor_area_id }
  settings            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  revoked_at          timestamptz,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_devices_venue ON pos_devices (venue_id);
CREATE UNIQUE INDEX pos_devices_pairing_uq ON pos_devices (pairing_code_hash) WHERE pairing_code_hash IS NOT NULL;

-- ── Trading ────────────────────────────────────────────────────
CREATE TABLE pos_days (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id         uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  business_date    date        NOT NULL,
  z_number         int,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  closed_by        uuid,
  declared_cash    int,
  close_notes      text,
  -- the Z report's figures (shared/pos/reports.js dayFigures), kept as printed
  figures          jsonb,
  recon_filled_at  timestamptz,
  recon_error      text
);
CREATE INDEX pos_days_venue ON pos_days (venue_id, opened_at DESC);
CREATE UNIQUE INDEX pos_days_open_uq ON pos_days (venue_id) WHERE closed_at IS NULL;

CREATE TABLE pos_venue_state (
  venue_id        uuid        PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  last_seq        bigint      NOT NULL DEFAULT 0,
  next_check_no   int         NOT NULL DEFAULT 1,
  next_order_no   int         NOT NULL DEFAULT 1,
  next_z_number   int         NOT NULL DEFAULT 1,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pos_events (
  id           text        PRIMARY KEY,
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  seq          bigint      NOT NULL,
  day_id       uuid        REFERENCES pos_days(id) ON DELETE SET NULL,
  check_id     text,
  device_id    text,
  staff_id     uuid,
  approved_by  uuid,
  type         text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  assigned     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  client_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, seq)
);
CREATE INDEX pos_events_check ON pos_events (check_id, seq);
CREATE INDEX pos_events_day ON pos_events (day_id, seq);

CREATE TABLE pos_event_rejections (
  id           text        PRIMARY KEY,
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  check_id     text,
  device_id    text,
  staff_id     uuid,
  type         text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  client_at    timestamptz,
  error        text        NOT NULL,
  code         text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  text,
  resolution   text
);
CREATE INDEX pos_event_rejections_venue ON pos_event_rejections (venue_id, created_at DESC);

CREATE TABLE pos_checks (
  id                 text        PRIMARY KEY,
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id           uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day_id             uuid        REFERENCES pos_days(id) ON DELETE SET NULL,
  number             int,
  order_no           int,
  mode               text        NOT NULL,
  table_id           uuid,
  tab_name           text,
  covers             int,
  server_id          uuid,
  revenue_centre_id  uuid,
  status             text        NOT NULL,
  opened_at          timestamptz,
  closed_at          timestamptz,
  subtotal           int         NOT NULL DEFAULT 0,
  discount           int         NOT NULL DEFAULT 0,
  service_charge     int         NOT NULL DEFAULT 0,
  total              int         NOT NULL DEFAULT 0,
  vat                int         NOT NULL DEFAULT 0,
  paid               int         NOT NULL DEFAULT 0,
  tips               int         NOT NULL DEFAULT 0,
  refunded           int         NOT NULL DEFAULT 0,
  state              jsonb       NOT NULL,
  last_seq           bigint      NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_checks_venue_status ON pos_checks (venue_id, status);
CREATE INDEX pos_checks_day ON pos_checks (day_id);

CREATE TABLE pos_check_lines (
  id                 text        PRIMARY KEY,
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id           uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  check_id           text        NOT NULL REFERENCES pos_checks(id) ON DELETE CASCADE,
  day_id             uuid,
  item_id            uuid,
  section_id         uuid,
  name               text        NOT NULL,
  qty                int         NOT NULL,
  gross              int         NOT NULL,
  discount           int         NOT NULL DEFAULT 0,
  net                int         NOT NULL,
  vat_rate           numeric(5,2) NOT NULL DEFAULT 0,
  vat                int         NOT NULL DEFAULT 0,
  revenue_centre_id  uuid,
  course_id          uuid,
  seat               int,
  status             text        NOT NULL,
  added_by           uuid,
  voided_by          uuid,
  void_reason        text,
  void_day_id        uuid,
  sent_at            timestamptz
);
CREATE INDEX pos_check_lines_check ON pos_check_lines (check_id);
CREATE INDEX pos_check_lines_day ON pos_check_lines (day_id);

CREATE TABLE pos_payments (
  id           text        PRIMARY KEY,
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  check_id     text        NOT NULL REFERENCES pos_checks(id) ON DELETE CASCADE,
  day_id       uuid,
  kind         text        NOT NULL CHECK (kind IN ('payment', 'refund')),
  tender       text        NOT NULL,
  amount       int         NOT NULL,
  tip          int         NOT NULL DEFAULT 0,
  staff_id     uuid,
  voided       boolean     NOT NULL DEFAULT false,
  reason       text,
  at           timestamptz
);
CREATE INDEX pos_payments_day ON pos_payments (day_id);
CREATE INDEX pos_payments_check ON pos_payments (check_id);

CREATE TABLE pos_print_jobs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id      uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  printer_id    uuid        REFERENCES pos_printers(id) ON DELETE SET NULL,
  event_id      text,
  check_id      text,
  kind          text        NOT NULL,
  title         text,
  ops           jsonb       NOT NULL,
  status        text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'printing', 'printed', 'failed', 'cancelled')),
  attempts      int         NOT NULL DEFAULT 0,
  error         text,
  claimed_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  printed_at    timestamptz
);
CREATE INDEX pos_print_jobs_venue ON pos_print_jobs (venue_id, status, created_at);

-- Promotions can run online, on the till or both (the till applies them
-- with shared/promotions.js like online ordering does).
ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS channels text[] NOT NULL DEFAULT '{online}';
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_channels_check;
ALTER TABLE promotions ADD CONSTRAINT promotions_channels_check
  CHECK (channels <@ ARRAY['online', 'pos']::text[] AND cardinality(channels) >= 1);

-- Cash Recon days filled from the till's Z report (services/reconFill.js).
ALTER TABLE cash_daily_reports
  ADD COLUMN IF NOT EXISTS pos_filled_at timestamptz,
  ADD COLUMN IF NOT EXISTS pos_filled_by text;

-- ── Row level security ─────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pos_settings', 'pos_revenue_centres', 'pos_roles', 'pos_courses', 'pos_printers', 'pos_print_routes',
    'floor_areas', 'pos_devices', 'pos_days', 'pos_venue_state', 'pos_events', 'pos_event_rejections',
    'pos_checks', 'pos_check_lines', 'pos_payments', 'pos_print_jobs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

-- ── Defaults for existing tenants ──────────────────────────────
-- POS roles (same as DEFAULT_POS_ROLES in shared/pos/permissions.js).
INSERT INTO pos_roles (tenant_id, name, permissions, sort_order)
SELECT t.id, r.name, r.permissions::jsonb, r.sort_order
  FROM tenants t
 CROSS JOIN (VALUES
   ('Server', '{"discount_max_pct":0,"transfer":true}', 0),
   ('Supervisor', '{"void":true,"comp":true,"discount_max_pct":25,"open_drawer":true,"reopen":true,"take_over":true,"transfer":true,"reports":true,"manager":true}', 1),
   ('Manager', '{"void":true,"refund":true,"comp":true,"discount_max_pct":100,"open_drawer":true,"reopen":true,"take_over":true,"price_override":true,"transfer":true,"reports":true,"close_day":true,"manager":true}', 2)
 ) AS r(name, permissions, sort_order);

-- Courses (same as DEFAULT_COURSES in services/posSvc.js).
INSERT INTO pos_courses (tenant_id, name, short_name, hold_by_default, sort_order)
SELECT t.id, c.name, c.short_name, c.hold, c.sort_order
  FROM tenants t
 CROSS JOIN (VALUES
   ('Drinks', 'DR', false, 0),
   ('Starters', 'ST', false, 1),
   ('Mains', 'MN', true, 2),
   ('Desserts', 'DS', true, 3)
 ) AS c(name, short_name, hold, sort_order);

-- ── Modules (group 'pos') ──────────────────────────────────────
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, m.key, true FROM tenants t CROSS JOIN (VALUES ('pos_setup'), ('pos_reports')) AS m(key)
ON CONFLICT DO NOTHING;

UPDATE tenant_roles
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || jsonb_build_object('pos_setup',
                          CASE WHEN is_builtin AND key IN ('owner', 'admin') THEN 'manage' ELSE 'none' END)
                     || jsonb_build_object('pos_reports',
                          CASE WHEN is_builtin AND key IN ('owner', 'admin') THEN 'manage'
                               WHEN is_builtin AND key = 'operator' THEN 'view'
                               ELSE COALESCE(permissions ->> 'cash_recon', 'none') END)
 WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'pos_setup');

-- ── Nav: a "Till" section after "Service", for existing tenants ──
-- Till setup (children: Floor plan), Till reports. New tenants get it from
-- defaultNav.js.
DO $$
DECLARE
  t         record;
  svc_sort  int;
  sec_id    uuid;
  setup_id  uuid;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    IF NOT EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id)
       OR EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id AND route = '/pos') THEN
      CONTINUE;
    END IF;

    -- After the section holding the Overview link (usually "Service").
    svc_sort := NULL;
    SELECT p.sort_order INTO svc_sort FROM nav_items n JOIN nav_items p ON p.id = n.parent_id
     WHERE n.tenant_id = t.id AND n.route = '/' AND p.parent_id IS NULL
     ORDER BY p.sort_order LIMIT 1;
    IF svc_sort IS NULL THEN
      SELECT COALESCE(MIN(sort_order), 0) - 1 INTO svc_sort FROM nav_items
       WHERE tenant_id = t.id AND parent_id IS NULL;
    END IF;

    UPDATE nav_items SET sort_order = sort_order + 1
     WHERE tenant_id = t.id AND parent_id IS NULL AND sort_order > svc_sort;

    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, NULL, 'section', 'Till', NULL, NULL, NULL, svc_sort + 1)
    RETURNING id INTO sec_id;

    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, sec_id, 'link', 'Till setup', 'MonitorSmartphone', '/pos', 'pos_setup', 0)
    RETURNING id INTO setup_id;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, setup_id, 'link', 'Floor plan', 'LayoutPanelTop', '/pos/floor', 'pos_setup', 0);

    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, sec_id, 'link', 'Till reports', 'BarChart3', '/pos/reports', 'pos_reports', 1);
  END LOOP;
END $$;

COMMIT;
