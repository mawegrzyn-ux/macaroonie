-- 106_staff_rota.sql
--
-- Staff rota: roles, shifts (day parts), rota settings, per-shift pay
-- rates, rota entries, and the per-week pay / points / tip adjustments.
--
-- Scope:
--   staff_roles, rota_settings, rota_shifts   tenant-wide (one set per company)
--   cash_staff, staff_shift_rates,
--   rota_entries, rota_weeks, rota_week_staff  per venue (staff belong to a venue)
--
-- Pay model on cash_staff:
--   pay_type 'hourly'  default_rate = GBP per hour; staff_shift_rates.rate
--                      = GBP per hour for that shift (overrides default)
--   pay_type 'fixed'   pay_basis 'week'  default_rate = GBP per week worked
--                      pay_basis 'day'   default_rate = GBP per day worked
--                      pay_basis 'shift' staff_shift_rates.rate = GBP for
--                                        that shift (default_rate as fallback)
--
-- Tips / service charge: each shift has points; each role a points
-- multiplier. A person's points = sum(shift points x role multiplier),
-- plus any manual adjustment for the week (rota_week_staff). Their share
-- of the week's tip pot = their points / everyone's points.
--
-- Also: a third dashboard kind, 'rota', with its own widget types.

BEGIN;

-- ── Roles (job titles) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_roles (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               text          NOT NULL,
  points_multiplier  numeric(5,2)  NOT NULL DEFAULT 1 CHECK (points_multiplier >= 0),
  sort_order         int           NOT NULL DEFAULT 0,
  is_active          boolean       NOT NULL DEFAULT true,
  created_at         timestamptz   NOT NULL DEFAULT now()
);
ALTER TABLE staff_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_roles_tenant ON staff_roles;
CREATE POLICY staff_roles_tenant ON staff_roles
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_staff_roles_tenant ON staff_roles (tenant_id, sort_order);

-- ── Rota settings (one row per tenant) ─────────────────────────
CREATE TABLE IF NOT EXISTS rota_settings (
  tenant_id     uuid        PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  mode          text        NOT NULL DEFAULT 'day_parts' CHECK (mode IN ('day_parts', 'hourly')),
  slot_minutes  int         NOT NULL DEFAULT 30 CHECK (slot_minutes IN (15, 30, 60)),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rota_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rota_settings_tenant ON rota_settings;
CREATE POLICY rota_settings_tenant ON rota_settings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Shifts / day parts ─────────────────────────────────────────
-- end_time <= start_time means the shift runs past midnight.
CREATE TABLE IF NOT EXISTS rota_shifts (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text          NOT NULL,
  start_time  time          NOT NULL,
  end_time    time          NOT NULL,
  points      numeric(6,2)  NOT NULL DEFAULT 1 CHECK (points >= 0),
  sort_order  int           NOT NULL DEFAULT 0,
  is_active   boolean       NOT NULL DEFAULT true,
  created_at  timestamptz   NOT NULL DEFAULT now()
);
ALTER TABLE rota_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rota_shifts_tenant ON rota_shifts;
CREATE POLICY rota_shifts_tenant ON rota_shifts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_rota_shifts_tenant ON rota_shifts (tenant_id, sort_order);

-- ── Staff: role + fixed-pay basis ──────────────────────────────
ALTER TABLE cash_staff ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES staff_roles(id) ON DELETE SET NULL;
ALTER TABLE cash_staff ADD COLUMN IF NOT EXISTS pay_basis text NOT NULL DEFAULT 'week';
ALTER TABLE cash_staff DROP CONSTRAINT IF EXISTS cash_staff_pay_basis_check;
ALTER TABLE cash_staff ADD CONSTRAINT cash_staff_pay_basis_check CHECK (pay_basis IN ('week', 'day', 'shift'));

-- ── Per-shift pay rates ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_shift_rates (
  tenant_id  uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id   uuid          NOT NULL REFERENCES cash_staff(id) ON DELETE CASCADE,
  shift_id   uuid          NOT NULL REFERENCES rota_shifts(id) ON DELETE CASCADE,
  rate       numeric(8,2)  NOT NULL CHECK (rate >= 0),
  PRIMARY KEY (staff_id, shift_id)
);
ALTER TABLE staff_shift_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_shift_rates_tenant ON staff_shift_rates;
CREATE POLICY staff_shift_rates_tenant ON staff_shift_rates
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Rota entries ───────────────────────────────────────────────
-- Day-parts mode: one row per staff / date / shift (shift_id set).
-- Hourly mode:    one row per worked period (start_time/end_time set);
--                 periods for a person on a day must not overlap (API).
CREATE TABLE IF NOT EXISTS rota_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  staff_id    uuid        NOT NULL REFERENCES cash_staff(id) ON DELETE CASCADE,
  work_date   date        NOT NULL,
  shift_id    uuid        REFERENCES rota_shifts(id) ON DELETE CASCADE,
  start_time  time,
  end_time    time,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rota_entries_kind_check CHECK (
    (shift_id IS NOT NULL AND start_time IS NULL AND end_time IS NULL)
    OR (shift_id IS NULL AND start_time IS NOT NULL AND end_time IS NOT NULL)
  )
);
ALTER TABLE rota_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rota_entries_tenant ON rota_entries;
CREATE POLICY rota_entries_tenant ON rota_entries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_rota_entries_venue_date ON rota_entries (tenant_id, venue_id, work_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rota_entries_shift
  ON rota_entries (staff_id, work_date, shift_id) WHERE shift_id IS NOT NULL;

-- ── Per-week tip pot override ──────────────────────────────────
CREATE TABLE IF NOT EXISTS rota_weeks (
  tenant_id         uuid           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id          uuid           NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  week_start        date           NOT NULL,
  tip_pot_override  numeric(10,2)  CHECK (tip_pot_override >= 0),
  updated_at        timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, week_start)
);
ALTER TABLE rota_weeks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rota_weeks_tenant ON rota_weeks;
CREATE POLICY rota_weeks_tenant ON rota_weeks
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Per-week, per-person points adjustment + pay override ──────
CREATE TABLE IF NOT EXISTS rota_week_staff (
  tenant_id          uuid           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id           uuid           NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  week_start         date           NOT NULL,
  staff_id           uuid           NOT NULL REFERENCES cash_staff(id) ON DELETE CASCADE,
  points_adjustment  numeric(8,2)   NOT NULL DEFAULT 0,
  pay_override       numeric(10,2)  CHECK (pay_override >= 0),
  updated_at         timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, week_start, staff_id)
);
ALTER TABLE rota_week_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rota_week_staff_tenant ON rota_week_staff;
CREATE POLICY rota_week_staff_tenant ON rota_week_staff
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Rota dashboards: third dashboard kind ──────────────────────
ALTER TABLE hs_dashboards DROP CONSTRAINT IF EXISTS hs_dashboards_kind_check;
ALTER TABLE hs_dashboards
  ADD CONSTRAINT hs_dashboards_kind_check CHECK (kind IN ('hs', 'cash', 'rota'));

ALTER TABLE hs_dashboard_widgets
  DROP CONSTRAINT IF EXISTS hs_dashboard_widgets_widget_type_check;
ALTER TABLE hs_dashboard_widgets
  ADD CONSTRAINT hs_dashboard_widgets_widget_type_check
  CHECK (widget_type IN (
    'checklist', 'temp_checks', 'delivery_checks', 'hold_checks', 'cooking_checks', 'action_log',
    'cash_wages_paid', 'cash_petty_cash', 'cash_recon_grid',
    'cash_week_balance', 'cash_day_balance', 'cash_day_tiles',
    'cash_week_expenses', 'cash_week_summary_grid', 'cash_week_staff',
    'rota_grid', 'rota_today', 'rota_week_pay', 'rota_tips'
  ));

-- ── Nav: a "Staff" section after "Service", for existing tenants ──
-- Staff (children: Roles), Rota (children: Rota setup), Rota dashboard.
-- New tenants get the same tree from defaultNav.js.
DO $$
DECLARE
  t            record;
  svc_sort     int;
  sec_id       uuid;
  staff_id     uuid;
  rota_id      uuid;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    -- Skip tenants with no nav tree at all, and tenants that already have the rota.
    IF NOT EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id)
       OR EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id AND route = '/rota') THEN
      CONTINUE;
    END IF;

    svc_sort := NULL;
    SELECT sort_order INTO svc_sort FROM nav_items
     WHERE tenant_id = t.id AND parent_id IS NULL AND kind = 'section' AND label = 'Service'
     ORDER BY sort_order LIMIT 1;
    IF svc_sort IS NULL THEN
      SELECT COALESCE(MIN(sort_order), 0) - 1 INTO svc_sort FROM nav_items
       WHERE tenant_id = t.id AND parent_id IS NULL;
    END IF;

    UPDATE nav_items
       SET sort_order = sort_order + 1
     WHERE tenant_id = t.id AND parent_id IS NULL AND sort_order > svc_sort;

    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, NULL, 'section', 'Staff', NULL, NULL, NULL, svc_sort + 1)
    RETURNING id INTO sec_id;

    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, sec_id, 'link', 'Staff', 'UsersRound', '/staff', 'staff', 0)
    RETURNING id INTO staff_id;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, staff_id, 'link', 'Roles', 'BadgeCheck', '/staff/roles', 'staff', 0);

    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, sec_id, 'link', 'Rota', 'CalendarRange', '/rota', 'rota', 1)
    RETURNING id INTO rota_id;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, rota_id, 'link', 'Rota setup', 'Settings2', '/rota/setup', 'staff', 0);

    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, sec_id, 'link', 'Rota dashboard', 'LayoutGrid', '/rota-dashboard', 'rota_dashboard', 2);
  END LOOP;
END $$;

COMMIT;
