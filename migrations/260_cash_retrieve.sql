-- Cash Recon: one Retrieve for every till system, an option to skip the
-- preview, and a scheduled fill (OUTSTANDING 44, item 6).
--
-- cash_venue_settings gains:
--   retrieve_skip_preview  Retrieve fills straight away, no preview window
--   auto_fill              the scheduled fill is on
--   auto_fill_at           the venue-local time it runs each day
--   auto_fill_last_on      the venue-local day it last ran (the claim: one run a day)
--   auto_fill_ran_at, auto_fill_result, auto_fill_error  what the last run did
--
-- cash_fill_values keeps the amount each fill last wrote into a day's field,
-- so the scheduled fill can tell a figure changed by hand since (it keeps
-- those) from one it wrote itself (it fills those again). Written by every
-- fill (services/reconFill.js fillReconDay()), the till's Z report included.

ALTER TABLE cash_venue_settings
  ADD COLUMN IF NOT EXISTS retrieve_skip_preview boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_fill             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_fill_at          time    NOT NULL DEFAULT '06:00',
  ADD COLUMN IF NOT EXISTS auto_fill_last_on     date,
  ADD COLUMN IF NOT EXISTS auto_fill_ran_at      timestamptz,
  ADD COLUMN IF NOT EXISTS auto_fill_result      jsonb,
  ADD COLUMN IF NOT EXISTS auto_fill_error       text;

CREATE TABLE IF NOT EXISTS cash_fill_values (
  tenant_id   uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id   uuid          NOT NULL REFERENCES cash_daily_reports(id) ON DELETE CASCADE,
  field_group text          NOT NULL CHECK (field_group IN ('income', 'takings', 'sc')),
  field_id    uuid          NOT NULL,
  amount      numeric(12,2) NOT NULL,
  source      text          NOT NULL,
  filled_at   timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, field_group, field_id)
);
CREATE INDEX IF NOT EXISTS cash_fill_values_tenant ON cash_fill_values (tenant_id);

ALTER TABLE cash_fill_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_fill_values FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cash_fill_values;
CREATE POLICY tenant_isolation ON cash_fill_values
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
