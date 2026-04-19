-- ============================================================
-- 027_cash_reconciliation.sql
--
-- Cash Reconciliation module.
-- Provides daily takings/income declaration, petty-cash expense
-- tracking, and weekly wage reporting per venue.
--
-- Tables:
--   cash_income_sources   — configurable income sources (POS, delivery, other)
--   cash_payment_channels — payment channels (cash, card, voucher, online, other)
--   cash_sc_sources       — service charge / tips sources
--   cash_staff            — staff wage templates
--   cash_daily_reports    — daily declaration header (draft → submitted)
--   cash_income_entries   — income per source per report
--   cash_takings_entries  — takings per channel per report
--   cash_sc_entries       — service charge / tips per source per report
--   cash_expenses         — petty cash expenses per report (with optional receipt)
--   cash_wage_reports     — weekly wages header
--   cash_wage_entries     — wage line per staff member per week
--
-- All tables are tenant-scoped via RLS using the existing
-- `app.tenant_id` session variable pattern.
-- ============================================================

BEGIN;

-- ── cash_income_sources ──────────────────────────────────────
CREATE TABLE cash_income_sources (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  name         text        NOT NULL,
  type         text        NOT NULL DEFAULT 'other'
                           CHECK (type IN ('pos', 'delivery', 'other')),
  vat_rate     numeric(5,2) NOT NULL DEFAULT 0
                           CHECK (vat_rate >= 0 AND vat_rate <= 100),
  vat_inclusive boolean    NOT NULL DEFAULT true,
  is_active    boolean     NOT NULL DEFAULT true,
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cash_income_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_income_sources_tenant ON cash_income_sources
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── cash_payment_channels ────────────────────────────────────
CREATE TABLE cash_payment_channels (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  name         text        NOT NULL,
  type         text        NOT NULL DEFAULT 'cash'
                           CHECK (type IN ('cash', 'card', 'voucher', 'online', 'other')),
  is_active    boolean     NOT NULL DEFAULT true,
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cash_payment_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_payment_channels_tenant ON cash_payment_channels
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── cash_sc_sources ──────────────────────────────────────────
-- Service charge / tips sources.
CREATE TABLE cash_sc_sources (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id             uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  name                 text        NOT NULL,
  type                 text        NOT NULL DEFAULT 'tips'
                                   CHECK (type IN ('tips', 'service_charge')),
  included_in_takings  boolean     NOT NULL DEFAULT false,
  distribution         text        NOT NULL DEFAULT 'house'
                                   CHECK (distribution IN ('house', 'staff', 'split')),
  is_active            boolean     NOT NULL DEFAULT true,
  sort_order           int         NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cash_sc_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_sc_sources_tenant ON cash_sc_sources
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── cash_staff ───────────────────────────────────────────────
CREATE TABLE cash_staff (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  name         text        NOT NULL,
  default_rate numeric(8,2),
  is_active    boolean     NOT NULL DEFAULT true,
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cash_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_staff_tenant ON cash_staff
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── cash_daily_reports ───────────────────────────────────────
CREATE TABLE cash_daily_reports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  report_date  date        NOT NULL,
  status       text        NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'submitted')),
  notes        text,
  submitted_at timestamptz,
  submitted_by text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, venue_id, report_date)
);

ALTER TABLE cash_daily_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_daily_reports_tenant ON cash_daily_reports
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── cash_income_entries ──────────────────────────────────────
CREATE TABLE cash_income_entries (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id    uuid        NOT NULL REFERENCES cash_daily_reports(id) ON DELETE CASCADE,
  source_id    uuid        NOT NULL REFERENCES cash_income_sources(id),
  gross_amount numeric(10,2) NOT NULL DEFAULT 0,
  vat_amount   numeric(10,2) NOT NULL DEFAULT 0,
  net_amount   numeric(10,2) NOT NULL DEFAULT 0
);

ALTER TABLE cash_income_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_income_entries_tenant ON cash_income_entries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── cash_takings_entries ─────────────────────────────────────
CREATE TABLE cash_takings_entries (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id    uuid        NOT NULL REFERENCES cash_daily_reports(id) ON DELETE CASCADE,
  channel_id   uuid        NOT NULL REFERENCES cash_payment_channels(id),
  amount       numeric(10,2) NOT NULL DEFAULT 0
);

ALTER TABLE cash_takings_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_takings_entries_tenant ON cash_takings_entries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── cash_sc_entries ──────────────────────────────────────────
CREATE TABLE cash_sc_entries (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id    uuid        NOT NULL REFERENCES cash_daily_reports(id) ON DELETE CASCADE,
  source_id    uuid        NOT NULL REFERENCES cash_sc_sources(id),
  amount       numeric(10,2) NOT NULL DEFAULT 0
);

ALTER TABLE cash_sc_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_sc_entries_tenant ON cash_sc_entries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── cash_expenses ────────────────────────────────────────────
CREATE TABLE cash_expenses (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id    uuid        NOT NULL REFERENCES cash_daily_reports(id) ON DELETE CASCADE,
  description  text        NOT NULL,
  category     text,
  amount       numeric(10,2) NOT NULL DEFAULT 0,
  receipt_url  text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cash_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_expenses_tenant ON cash_expenses
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── cash_wage_reports ────────────────────────────────────────
CREATE TABLE cash_wage_reports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  week_start   date        NOT NULL,
  status       text        NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'submitted')),
  notes        text,
  submitted_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, venue_id, week_start)
);

ALTER TABLE cash_wage_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_wage_reports_tenant ON cash_wage_reports
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── cash_wage_entries ────────────────────────────────────────
CREATE TABLE cash_wage_entries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wage_report_id  uuid        NOT NULL REFERENCES cash_wage_reports(id) ON DELETE CASCADE,
  staff_id        uuid        REFERENCES cash_staff(id),
  name            text        NOT NULL,
  hours           numeric(5,2),
  rate            numeric(8,2),
  total           numeric(10,2) NOT NULL DEFAULT 0,
  cash_amount     numeric(10,2) NOT NULL DEFAULT 0,
  notes           text
);

ALTER TABLE cash_wage_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_wage_entries_tenant ON cash_wage_entries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;
