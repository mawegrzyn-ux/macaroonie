-- Pins (Pepper-first step 2a, reports/AI first back office strategy.md
-- "Home: the day comes to the person", docs/PEPPER_FIRST.md 4.3): each
-- person's own shortcuts on Home, kept on the server so they follow the
-- person to any device. They replace the Overview's Quick access picker,
-- which kept its list in each browser (maca_dashboard_shortcuts).
--
-- One row per pin, in the person's order. A pin is a page of the person's
-- own menu (path), optionally opened at a venue and a tab (the page's
-- address must accept them: shared/nav/links.js pageLink()), with an
-- optional name of the person's own. The whole list is saved at once
-- (PUT /api/pins, routes/pins.js), at most 12.
--
-- Decision 8 of the strategy: a person's pins are theirs. Nothing reads
-- them for anyone else, and no report subject covers them.

CREATE TABLE IF NOT EXISTS home_pins (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_sub   text        NOT NULL,
  sort_order integer     NOT NULL,
  path       text        NOT NULL CHECK (path ~ '^/[a-z0-9/-]*$' AND char_length(path) <= 100),
  venue_id   uuid        REFERENCES venues(id) ON DELETE SET NULL,
  tab        text        CHECK (tab IS NULL OR tab ~ '^[a-z0-9_-]{1,40}$'),
  label      text        CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_sub, sort_order)
);
CREATE INDEX IF NOT EXISTS home_pins_venue ON home_pins (venue_id) WHERE venue_id IS NOT NULL;

ALTER TABLE home_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_pins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON home_pins;
CREATE POLICY tenant_isolation ON home_pins
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
