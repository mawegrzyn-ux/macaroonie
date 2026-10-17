-- ============================================================
-- 176_forced_rls.sql
-- Row-level security that holds for the app's own database role.
--
-- The app's role owns the tables, and a table's owner isn't held to RLS
-- unless the table FORCEs it, so until now the policies stopped nothing:
-- every query relied on its own tenant_id filter. From here:
--
--   * every table with a tenant_id has RLS on and forced;
--   * one policy each: the row's tenant is the transaction's tenant
--     (app.tenant_id, set by withTenant()), or the transaction is in system
--     mode (app.bypass_rls = 'on', set by withSystem(): background jobs,
--     sweeps, and the look-ups by token, slug or device that find the
--     tenant in the first place);
--   * a query with neither (one on the bare pool) sees no rows of a tenant
--     table and can't write one.
--
-- current_setting(name, true) returns '' rather than NULL once a pooled
-- connection has had the setting in an earlier transaction, hence NULLIF.
--
-- Feature requests are one board every tenant reads (and upvotes); they
-- get a read-all policy beside the tenant one. table_combination_members
-- has no tenant_id: a row is visible when its combination is.
-- ============================================================

BEGIN;

-- Only a table's owner (or a superuser) can force RLS on it. Tables made
-- by hand as another role (an early psql run as postgres) would stop this
-- migration at the first one: list them all with the fix instead.
DO $$
DECLARE bad text;
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RETURN; END IF;
  SELECT string_agg(format('%I (owner %s)', c.relname, pg_get_userbyid(c.relowner)), ', ' ORDER BY c.relname) INTO bad
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind = 'r'
     AND pg_get_userbyid(c.relowner) <> current_user
     AND (c.relname = 'table_combination_members'
          OR EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Row-level security can only be forced by a table''s owner, and these tables belong to another role: %. As postgres, run ALTER TABLE <table> OWNER TO % for each, then deploy again.', bad, current_user;
  END IF;
END $$;

DO $$
DECLARE
  t record;
  p record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
  LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t.relname LOOP
      EXECUTE format('DROP POLICY %I ON %I', p.policyname, t.relname);
    END LOOP;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.relname);
    EXECUTE format($sql$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
               OR current_setting('app.bypass_rls', true) = 'on')
    $sql$, t.relname);
  END LOOP;
END $$;

CREATE POLICY board_read ON feature_requests FOR SELECT USING (true);
CREATE POLICY board_read ON feature_request_upvotes FOR SELECT USING (true);

-- A screen pairing has no tenant until someone signed in types its code
-- (routes/screens.js claims it inside their tenant's transaction): an
-- unclaimed one is any tenant's to find by its code.
DROP POLICY tenant_isolation ON screen_pairings;
CREATE POLICY tenant_isolation ON screen_pairings
  USING (tenant_id IS NULL
         OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'table_combination_members' LOOP
    EXECUTE format('DROP POLICY %I ON table_combination_members', p.policyname);
  END LOOP;
END $$;
ALTER TABLE table_combination_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_combination_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON table_combination_members
  USING (EXISTS (SELECT 1 FROM table_combinations c WHERE c.id = combination_id));

-- The hold sweep deletes every tenant's expired holds (pg_cron calls it
-- with no tenant): system mode for its own statement, then back. (A
-- function's SET clause can't name a custom setting without superuser.)
CREATE OR REPLACE FUNCTION sweep_expired_holds()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  prev text := current_setting('app.bypass_rls', true);
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  DELETE FROM booking_holds WHERE expires_at < now();
  PERFORM set_config('app.bypass_rls', coalesce(prev, ''), true);
END;
$$;

-- Memberships across tenants are read by the app in system mode
-- (services/membershipSvc.js); the SECURITY DEFINER function would see
-- nothing now that RLS holds for its owner too.
DROP FUNCTION IF EXISTS list_memberships_for_identity(text, text);

COMMIT;
