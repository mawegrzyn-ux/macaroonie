-- 032_cash_recon_venue_settings.sql
--
-- Per-venue settings for the cash reconciliation module.
-- Currently stores allow_bulk_submit: when true, the "Submit Week" button
-- submits ALL open days (creating empty reports for days with no data).
-- When false (default), only days that already have draft data are submitted.

BEGIN;

CREATE TABLE cash_venue_settings (
  venue_id          uuid        PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  allow_bulk_submit boolean     NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cash_venue_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_venue_settings_tenant ON cash_venue_settings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;
