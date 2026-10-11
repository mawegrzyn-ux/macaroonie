-- 152_shared_dashboards.sql
--
-- Every dashboard can now hold every widget type: the H&S, Cash and Rota
-- dashboards no longer have their own widget lists (the widget_type CHECK
-- already lists every type, so it doesn't change). Which widgets a person
-- can add and see is decided by the widget's own module (checklists,
-- food_safety, cash_recon, rota, ...), in the API and the admin.
--
-- Also a fourth dashboard kind, 'custom': blank dashboards on the new
-- Dashboards page (/dashboards, /api/custom-dashboards), gated by the new
-- core module custom_dashboard. Core modules have no tenant switch, so
-- only role permissions and a nav link are added here.

BEGIN;

ALTER TABLE hs_dashboards DROP CONSTRAINT IF EXISTS hs_dashboards_kind_check;
ALTER TABLE hs_dashboards
  ADD CONSTRAINT hs_dashboards_kind_check CHECK (kind IN ('hs', 'cash', 'rota', 'custom'));

-- ── Role permissions ─────────────────────────────────────────
-- Built-in roles get the registry default (viewer: view, others: manage).
-- Custom roles copy their H&S Dashboard level, else view.
UPDATE tenant_roles
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || jsonb_build_object('custom_dashboard',
                          CASE
                            WHEN is_builtin AND key = 'viewer' THEN 'view'
                            WHEN is_builtin THEN 'manage'
                            ELSE COALESCE(permissions ->> 'hs_dashboard', 'view')
                          END)
 WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'custom_dashboard');

-- ── Nav link "Dashboards", right after Overview, for existing tenants ──
-- Anchored on the Overview route ('/'), not on a section label an operator
-- may have renamed. Tenants without an Overview link get it at the end of
-- the top level. New tenants get it from defaultNav.js.
DO $$
DECLARE
  t       record;
  ov_id   uuid;
  ov_par  uuid;
  ov_sort int;
  top_max int;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    IF NOT EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id)
       OR EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id AND route = '/dashboards') THEN
      CONTINUE;
    END IF;

    ov_id := NULL;
    SELECT id, parent_id, sort_order INTO ov_id, ov_par, ov_sort FROM nav_items
     WHERE tenant_id = t.id AND route = '/'
     ORDER BY sort_order LIMIT 1;

    IF ov_id IS NULL THEN
      SELECT COALESCE(MAX(sort_order), -1) INTO top_max FROM nav_items
       WHERE tenant_id = t.id AND parent_id IS NULL;
      INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
      VALUES (t.id, NULL, 'link', 'Dashboards', 'LayoutTemplate', '/dashboards', 'custom_dashboard', top_max + 1);
      CONTINUE;
    END IF;

    UPDATE nav_items
       SET sort_order = sort_order + 1
     WHERE tenant_id = t.id
       AND parent_id IS NOT DISTINCT FROM ov_par
       AND sort_order > ov_sort;

    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, ov_par, 'link', 'Dashboards', 'LayoutTemplate', '/dashboards', 'custom_dashboard', ov_sort + 1);
  END LOOP;
END $$;

COMMIT;
