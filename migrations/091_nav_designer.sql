-- ============================================================
-- 091_nav_designer.sql
--
-- Admin-configurable navigation: a single shared nav tree per tenant
-- (arbitrary depth via parent_id), with per-role visibility. Replaces the
-- previously-hardcoded NAV_SECTIONS array in AppShell.jsx.
--
-- Model:
--   nav_items — one row per section/link. 'section' nodes are pure
--   grouping labels (no route); 'link' nodes point at an app route.
--   Depth is unlimited — a link can have children which have children,
--   etc. `module`, where set, ties the item to the existing
--   tenant_modules/tenant_roles permission system (module disabled or
--   role has no permission → hidden, same as today). `hidden_role_ids`
--   is an ADDITIONAL hide on top of that — an admin can hide an
--   otherwise-permitted item for specific roles without touching module
--   permissions. `show_in_launcher` + `launcher_sort_order` mark items
--   that also appear as quick-access tiles (see tenants.nav_style below);
--   this reuses the same catalog rather than a separate tile table.
--
-- tenants.nav_style toggles between the traditional sidebar and a
-- launcher-only (quick-access tiles) home screen, tenant-wide.
-- ============================================================

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS nav_style text NOT NULL DEFAULT 'sidebar'
    CHECK (nav_style IN ('sidebar', 'launcher'));

CREATE TABLE IF NOT EXISTS nav_items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id           uuid        REFERENCES nav_items(id) ON DELETE CASCADE,
  kind                text        NOT NULL DEFAULT 'link' CHECK (kind IN ('section', 'link')),
  label               text        NOT NULL,
  icon                text,
  route               text,
  module              text,
  hidden_role_ids     uuid[]      NOT NULL DEFAULT '{}',
  show_in_launcher    boolean     NOT NULL DEFAULT false,
  launcher_sort_order int         NOT NULL DEFAULT 0,
  sort_order          int         NOT NULL DEFAULT 0,
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'section' OR route IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_nav_items_tenant_parent
  ON nav_items (tenant_id, parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_nav_items_launcher
  ON nav_items (tenant_id, show_in_launcher, launcher_sort_order);

ALTER TABLE nav_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'nav_items' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON nav_items
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_nav_items_updated_at ON nav_items;
CREATE TRIGGER trg_nav_items_updated_at
  BEFORE UPDATE ON nav_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Register module + permissions ─────────────────────────────
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'nav_designer', true FROM tenants t
ON CONFLICT (tenant_id, module_key) DO NOTHING;

UPDATE tenant_roles
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || jsonb_build_object('nav_designer',
                          CASE key WHEN 'owner' THEN 'manage' ELSE 'none' END)
 WHERE is_builtin = true
   AND NOT (permissions ? 'nav_designer');

-- ── Seed each tenant's default tree from today's hardcoded nav ────
-- Mirrors admin/src/components/layout/AppShell.jsx's NAV_SECTIONS at the
-- time this migration was written. Only runs for tenants that don't
-- already have any nav_items (so it's a one-time seed, safe to re-run).
DO $$
DECLARE
  t record;
  sec_id uuid;
  item_id uuid;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    IF EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id) THEN
      CONTINUE;
    END IF;

    -- Service
    INSERT INTO nav_items (tenant_id, kind, label, sort_order) VALUES (t.id, 'section', 'Service', 0) RETURNING id INTO sec_id;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order) VALUES
      (t.id, sec_id, 'link', 'Dashboard', 'LayoutDashboard', '/', 'dashboard', 0),
      (t.id, sec_id, 'link', 'Timeline', 'CalendarDays', '/timeline', 'bookings', 1),
      (t.id, sec_id, 'link', 'Bookings', 'BookOpen', '/bookings', 'bookings', 2),
      (t.id, sec_id, 'link', 'Customers', 'UserRound', '/customers', 'customers', 3);
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order) VALUES
      (t.id, sec_id, 'link', 'Order sheets', 'ClipboardList', '/order-sheets', 'order_sheets', 4) RETURNING id INTO item_id;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order) VALUES
      (t.id, item_id, 'link', 'Templates', 'ClipboardList', '/order-sheets/templates', 'order_sheet_setup', 0),
      (t.id, item_id, 'link', 'Categories', 'Tag', '/order-sheets/categories', 'order_sheet_setup', 1);
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order) VALUES
      (t.id, sec_id, 'link', 'Cash recon', 'Wallet', '/cash-recon', 'cash_recon', 5),
      (t.id, sec_id, 'link', 'Food safety', 'Thermometer', '/food-safety', 'food_safety', 6),
      (t.id, sec_id, 'link', 'Checklists', 'ListChecks', '/checklists', 'checklists', 7),
      (t.id, sec_id, 'link', 'H&S Dashboard', 'LayoutGrid', '/hs-dashboard', 'hs_dashboard', 8);

    -- Website
    INSERT INTO nav_items (tenant_id, kind, label, sort_order) VALUES (t.id, 'section', 'Website', 1) RETURNING id INTO sec_id;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order) VALUES
      (t.id, sec_id, 'link', 'Website', 'Globe', '/website', 'website', 0);
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order) VALUES
      (t.id, sec_id, 'link', 'Menus', 'ChefHat', '/menus', 'menus', 1) RETURNING id INTO item_id;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order) VALUES
      (t.id, item_id, 'link', 'Variant groups', 'Layers', '/menus/variant-groups', 'menus', 0),
      (t.id, item_id, 'link', 'Dietary groups', 'Tag', '/menus/dietary-groups', 'menus', 1);
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order) VALUES
      (t.id, sec_id, 'link', 'Media', 'FolderOpen', '/media', 'website', 2),
      (t.id, sec_id, 'link', 'Reviews', 'MessageSquare', '/reviews', 'website', 3);

    -- Setup
    INSERT INTO nav_items (tenant_id, kind, label, sort_order) VALUES (t.id, 'section', 'Setup', 2) RETURNING id INTO sec_id;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order) VALUES
      (t.id, sec_id, 'link', 'Venues', 'Building2', '/venues', 'venues', 0),
      (t.id, sec_id, 'link', 'Tables', 'Table2', '/tables', 'tables', 1),
      (t.id, sec_id, 'link', 'Schedule', 'Clock', '/schedule', 'schedule', 2),
      (t.id, sec_id, 'link', 'Rules', 'Settings', '/rules', 'rules', 3);

    -- Account
    INSERT INTO nav_items (tenant_id, kind, label, sort_order) VALUES (t.id, 'section', 'Account', 3) RETURNING id INTO sec_id;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order) VALUES
      (t.id, sec_id, 'link', 'Emails', 'Mail', '/email-templates', 'email_templates', 0) RETURNING id INTO item_id;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order) VALUES
      (t.id, item_id, 'link', 'Monitor', 'Activity', '/email-monitoring', 'email_templates', 0);
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order) VALUES
      (t.id, sec_id, 'link', 'Team', 'Users', '/team', 'team', 1),
      (t.id, sec_id, 'link', 'Access', 'Shield', '/access', 'team', 2),
      (t.id, sec_id, 'link', 'Settings', 'SlidersHorizontal', '/settings', 'settings', 3),
      (t.id, sec_id, 'link', 'Widget test', 'LayoutTemplate', '/widget-test', 'widget_test', 4),
      (t.id, sec_id, 'link', 'Test data', 'FlaskConical', '/test-data', 'test_data', 5),
      (t.id, sec_id, 'link', 'Legacy import', 'FileSpreadsheet', '/legacy-import', 'test_data', 6),
      (t.id, sec_id, 'link', 'Navigation', 'Compass', '/nav-designer', 'nav_designer', 7);

    -- Help
    INSERT INTO nav_items (tenant_id, kind, label, sort_order) VALUES (t.id, 'section', 'Help', 4) RETURNING id INTO sec_id;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order) VALUES
      (t.id, sec_id, 'link', 'Issues', 'AlertCircle', '/issues', 'issue_log', 0),
      (t.id, sec_id, 'link', 'Feature requests', 'Lightbulb', '/feature-requests', 'feature_requests', 1),
      (t.id, sec_id, 'link', 'What''s new', 'Newspaper', '/changelog', 'changelog', 2),
      (t.id, sec_id, 'link', 'Documentation', 'BookMarked', '/docs', 'documentation', 3),
      (t.id, sec_id, 'link', 'Help', 'HelpCircle', '/help', 'documentation', 4);
  END LOOP;
END $$;

COMMIT;
