-- 266_till_taps.sql
--
-- Taps on till layout buttons (22 Nov 2026, OUTSTANDING 44.8): how often
-- each button of a till layout's zones is tapped, a count per day, till,
-- person, layout, zone and button (shared/pos/tillTaps.js). The till counts
-- and sends them every minute (POST /pos-api/till-taps); kept 90 days
-- (TAPS_KEEP_DAYS: older rows go as a venue's tills send theirs). Shown as a
-- heat map in the till layout designer and in the report builder (till.taps).
--   cell   the button: a section, menu or dish id, the designer's button id,
--          or 'times' (the Menu times button)
--   label  its words when last tapped (a dish renamed keeps its id)

CREATE TABLE IF NOT EXISTS pos_till_taps (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  device_id   uuid        NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
  staff_id    uuid        REFERENCES cash_staff(id) ON DELETE CASCADE,
  layout_id   uuid        NOT NULL REFERENCES pos_till_layouts(id) ON DELETE CASCADE,
  zone_id     text        NOT NULL CHECK (char_length(zone_id) BETWEEN 1 AND 40),
  zone_type   text        NOT NULL CHECK (zone_type IN ('categories', 'menus', 'items', 'category', 'buttons', 'popup')),
  cell        text        NOT NULL CHECK (char_length(cell) BETWEEN 1 AND 80),
  label       text        CHECK (label IS NULL OR char_length(label) <= 80),
  day         date        NOT NULL,
  taps        int         NOT NULL DEFAULT 0 CHECK (taps >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_till_taps_uq
  ON pos_till_taps (device_id, (COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid)), layout_id, zone_id, cell, day);
CREATE INDEX IF NOT EXISTS pos_till_taps_layout ON pos_till_taps (tenant_id, layout_id, day);
CREATE INDEX IF NOT EXISTS pos_till_taps_venue ON pos_till_taps (venue_id, day);

ALTER TABLE pos_till_taps ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_till_taps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_till_taps;
CREATE POLICY tenant_isolation ON pos_till_taps
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
