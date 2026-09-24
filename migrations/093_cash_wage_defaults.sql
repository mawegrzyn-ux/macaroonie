-- 093_cash_wage_defaults.sql
-- Per-venue default wage list: "set this week's staff as the default" so future
-- new weeks auto-populate from this list instead of the full active-staff roster.
-- Replaces the "Load template" button (which pulled from cash_staff directly).

BEGIN;

CREATE TABLE cash_wage_defaults (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id)    ON DELETE CASCADE,
  staff_id    uuid        NOT NULL REFERENCES cash_staff(id) ON DELETE CASCADE,
  entry_type  text        NOT NULL DEFAULT 'fixed'
                          CHECK (entry_type IN ('hourly', 'fixed')),
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, staff_id)
);

ALTER TABLE cash_wage_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_wage_defaults_tenant ON cash_wage_defaults
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;
