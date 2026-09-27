-- 108_tip_pots.sql
--
-- Tip pots (Rota setup, tenant-wide). A pot has a name and a distribution
-- method, collects money from Cash Recon service charge / tips sources
-- allocated to it, plus manual lines whose amounts are entered each week.
--
--   tip_pots               name, distribution house | points | manual
--   cash_sc_sources        + tip_pot_id: the pot a source feeds (at most one).
--                          Replaces cash_sc_sources.distribution (house /
--                          staff / split), which only ever fed the old single
--                          rota tip pot and is dropped here.
--   tip_pot_lines          named manual lines per pot (e.g. "Cash tips jar")
--   rota_week_pot_lines    each line's amount for a venue week
--   rota_week_pot_manual   manual distribution: amount per person per pot per
--                          venue week
--
-- rota_weeks (the old single-pot override) is dropped: manual lines and
-- per-pot manual distribution cover what it was for.

BEGIN;

CREATE TABLE IF NOT EXISTS tip_pots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  distribution  text        NOT NULL DEFAULT 'points'
                            CHECK (distribution IN ('house', 'points', 'manual')),
  sort_order    int         NOT NULL DEFAULT 0,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tip_pots_tenant_idx ON tip_pots (tenant_id, sort_order);
ALTER TABLE tip_pots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tip_pots_tenant ON tip_pots;
CREATE POLICY tip_pots_tenant ON tip_pots
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE cash_sc_sources
  ADD COLUMN IF NOT EXISTS tip_pot_id uuid REFERENCES tip_pots(id) ON DELETE SET NULL;

-- Carry over: sources that were "Distributed to Staff" go into one
-- "Staff tips" pot shared by points (what the rota did with them before).
INSERT INTO tip_pots (tenant_id, name, distribution)
SELECT DISTINCT tenant_id, 'Staff tips', 'points'
  FROM cash_sc_sources
 WHERE distribution = 'staff';

UPDATE cash_sc_sources s
   SET tip_pot_id = p.id
  FROM tip_pots p
 WHERE p.tenant_id = s.tenant_id
   AND p.name = 'Staff tips'
   AND s.distribution = 'staff';

ALTER TABLE cash_sc_sources DROP COLUMN IF EXISTS distribution;

CREATE TABLE IF NOT EXISTS tip_pot_lines (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pot_id      uuid        NOT NULL REFERENCES tip_pots(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tip_pot_lines_pot_idx ON tip_pot_lines (pot_id, sort_order);
ALTER TABLE tip_pot_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tip_pot_lines_tenant ON tip_pot_lines;
CREATE POLICY tip_pot_lines_tenant ON tip_pot_lines
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS rota_week_pot_lines (
  tenant_id   uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  week_start  date          NOT NULL,
  line_id     uuid          NOT NULL REFERENCES tip_pot_lines(id) ON DELETE CASCADE,
  amount      numeric(10,2) NOT NULL CHECK (amount >= 0),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, week_start, line_id)
);
ALTER TABLE rota_week_pot_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rota_week_pot_lines_tenant ON rota_week_pot_lines;
CREATE POLICY rota_week_pot_lines_tenant ON rota_week_pot_lines
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS rota_week_pot_manual (
  tenant_id   uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  week_start  date          NOT NULL,
  pot_id      uuid          NOT NULL REFERENCES tip_pots(id) ON DELETE CASCADE,
  staff_id    uuid          NOT NULL REFERENCES cash_staff(id) ON DELETE CASCADE,
  amount      numeric(10,2) NOT NULL CHECK (amount >= 0),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, week_start, pot_id, staff_id)
);
ALTER TABLE rota_week_pot_manual ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rota_week_pot_manual_tenant ON rota_week_pot_manual;
CREATE POLICY rota_week_pot_manual_tenant ON rota_week_pot_manual
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP TABLE IF EXISTS rota_weeks;

COMMIT;
