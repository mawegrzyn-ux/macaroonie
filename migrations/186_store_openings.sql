-- 186_store_openings.sql
--
-- Opening a new location with Pepper. Someone describes the new store in a
-- few words; Pepper scopes it area by area (copy from a location the group
-- already has, set up new, or leave out), asks questions only where the
-- answer changes the setup, then writes a short brief. Creating it makes the
-- venue and every area of the plan in one transaction
-- (services/storeSetup.js).
--
--   store_openings   one row per new location being planned:
--     input          what the person wrote first
--     steps          the history: each AI step with what the person sent
--                    (answers, a deep dive, a change) and what came back
--     ai             Pepper's latest answer (summary, questions, brief)
--     overrides      what the person set themselves (name, slug, time zone,
--                    opening date, the location to copy from, each area's
--                    choice); always wins over Pepper's plan
--     plan           the checked plan the location is created from
--     results        what creating it did, per area
--     followups      what is left for people to do, ticked off on the page
--     busy_until     a short lease while Pepper or the creation runs, so two
--                    tabs can't run the same step at once

BEGIN;

CREATE TABLE IF NOT EXISTS store_openings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id         uuid        REFERENCES venues(id) ON DELETE SET NULL,
  title            text        NOT NULL DEFAULT 'New location',
  status           text        NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'questions', 'ready', 'created')),
  input            text        NOT NULL,
  steps            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ai               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  overrides        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  plan             jsonb,
  results          jsonb,
  followups        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  rounds           int         NOT NULL DEFAULT 0,
  busy_until       timestamptz,
  created_by       text,
  created_by_email text,
  opened_at        timestamptz,
  opened_by        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_openings_tenant ON store_openings (tenant_id, updated_at DESC);

ALTER TABLE store_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_openings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON store_openings;
CREATE POLICY tenant_isolation ON store_openings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- Nav: "New location" after Venues. New tenants get it from defaultNav.js.
DO $$
DECLARE
  t         record;
  anchor    record;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    IF EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id AND route = '/new-location') THEN
      CONTINUE;
    END IF;
    SELECT parent_id, sort_order INTO anchor FROM nav_items
     WHERE tenant_id = t.id AND route = '/venues' ORDER BY sort_order LIMIT 1;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    UPDATE nav_items SET sort_order = sort_order + 1
     WHERE tenant_id = t.id AND parent_id IS NOT DISTINCT FROM anchor.parent_id
       AND sort_order > anchor.sort_order;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, anchor.parent_id, 'link', 'New location', 'Store', '/new-location', 'venues', anchor.sort_order + 1);
  END LOOP;
END $$;

COMMIT;
