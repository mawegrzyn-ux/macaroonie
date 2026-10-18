-- 183_kitchen_balance.sql
--
-- Balance boxes in the kitchen flow (shared/pos/kitchen.js): a station of
-- kind 'balance' shares work between the stations it links to. Each
-- ticket's dishes that reach it go on to one of them, the one with the
-- fewest pieces still to cook (its settings.pieces: [{ kind: 'dish', id,
-- qty } | { kind: 'option', label, qty }], like On order counts), taking
-- turns on a tie. It has no screen and nothing to bump.
--
--   kds_balance_turns   the station each box picked last, so a tie goes to
--                       the next one. Written by the sequencer.

BEGIN;

ALTER TABLE kds_stations DROP CONSTRAINT IF EXISTS kds_stations_kind_check;
ALTER TABLE kds_stations ADD CONSTRAINT kds_stations_kind_check CHECK (kind IN ('prep', 'expo', 'runner', 'board', 'balance'));

CREATE TABLE IF NOT EXISTS kds_balance_turns (
  station_id      uuid        PRIMARY KEY REFERENCES kds_stations(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id        uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  last_station_id uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kds_balance_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE kds_balance_turns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kds_balance_turns;
CREATE POLICY tenant_isolation ON kds_balance_turns
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

COMMIT;
