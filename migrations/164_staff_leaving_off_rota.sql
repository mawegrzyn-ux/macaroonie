-- 164_staff_leaving_off_rota.sql
--
-- Staff who leave, and staff who are off the rota for a while (Staff page).
--
--   cash_staff.left_on    the person's last working day. From the day after,
--                         they are not on the rota: weeks after it don't show
--                         them, and the week they leave in shows their days
--                         after it as Left. Earlier weeks still show them.
--                         NULL = still on the staff. Setting it takes their
--                         rota entries after that day off the rota.
--   cash_staff.left_note  optional reason, shown on the Staff page.
--
--   staff_rota_off        periods a person is off the rota (from_date to
--                         to_date, both included): extended leave, a season
--                         away, a suspension. Those days are blocked on the
--                         rota and a week entirely inside a period doesn't
--                         show them. Adding one takes their rota entries in
--                         it off the rota. Periods for one person don't
--                         overlap. Paid holiday is still booked on the rota
--                         itself (PTO), not here.
--
-- Everything that lists "current" staff skips people who have left: the
-- rota, the rota pay payload (unless they have money that week), new wage
-- weeks, the wages Add person list, and the till's sign-in list.

BEGIN;

ALTER TABLE cash_staff
  ADD COLUMN IF NOT EXISTS left_on   date,
  ADD COLUMN IF NOT EXISTS left_note text;

CREATE TABLE IF NOT EXISTS staff_rota_off (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id    uuid        NOT NULL REFERENCES cash_staff(id) ON DELETE CASCADE,
  from_date   date        NOT NULL,
  to_date     date        NOT NULL,
  note        text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);
CREATE INDEX IF NOT EXISTS staff_rota_off_lookup
  ON staff_rota_off (tenant_id, staff_id, from_date);
ALTER TABLE staff_rota_off ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_rota_off_tenant ON staff_rota_off;
CREATE POLICY staff_rota_off_tenant ON staff_rota_off
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;
