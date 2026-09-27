-- 113_rota_tip_moves.sql
--
-- Tip moves as individual transactions. Each move takes points or £ from one
-- person and gives it to one or more people (split equally, by amount or by
-- %; the split is worked out in the UI and stored as final amounts per
-- recipient). A week can hold any number of moves; each can be deleted on
-- its own. rotaCalc.js sums them into each person's points / £ adjustment.
--
-- Replaces rota_week_staff.points_adjustment (migration 106) and
-- rota_week_staff.tip_adjustment (migration 109), which only held one net
-- figure per person. Pre-production: existing net figures are dropped.

BEGIN;

CREATE TABLE IF NOT EXISTS rota_tip_moves (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id       uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  week_start     date        NOT NULL,
  kind           text        NOT NULL CHECK (kind IN ('points', 'money')),
  from_staff_id  uuid        NOT NULL REFERENCES cash_staff(id) ON DELETE CASCADE,
  note           text,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rota_tip_moves_week_idx ON rota_tip_moves (venue_id, week_start, created_at);
ALTER TABLE rota_tip_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rota_tip_moves_tenant ON rota_tip_moves;
CREATE POLICY rota_tip_moves_tenant ON rota_tip_moves
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS rota_tip_move_lines (
  move_id      uuid          NOT NULL REFERENCES rota_tip_moves(id) ON DELETE CASCADE,
  tenant_id    uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  to_staff_id  uuid          NOT NULL REFERENCES cash_staff(id) ON DELETE CASCADE,
  amount       numeric(10,2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (move_id, to_staff_id)
);
ALTER TABLE rota_tip_move_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rota_tip_move_lines_tenant ON rota_tip_move_lines;
CREATE POLICY rota_tip_move_lines_tenant ON rota_tip_move_lines
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE rota_week_staff
  DROP COLUMN IF EXISTS points_adjustment,
  DROP COLUMN IF EXISTS tip_adjustment;

COMMIT;
