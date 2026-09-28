-- ============================================================
-- 123_orders_nav_fallback.sql
--
-- Migration 122 added the "Online orders" link (and its "Ordering setup"
-- child) only for tenants whose nav still had a top-level "Service"
-- section. Tenants who had renamed or restructured their nav got nothing,
-- so the new pages were unreachable from the sidebar.
--
-- For every tenant still without an /orders link, add it next to the
-- Customers link (wherever that lives), else next to Bookings, else at the
-- end of the top level. Tenants with no nav rows at all are left alone.
-- ============================================================

BEGIN;

DO $$
DECLARE
  t          record;
  new_parent uuid;
  after_sort int;
  orders_id  uuid;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    IF EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id AND route = '/orders')
       OR NOT EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id) THEN
      CONTINUE;
    END IF;

    SELECT parent_id, sort_order INTO new_parent, after_sort FROM nav_items
     WHERE tenant_id = t.id AND route = '/customers'
     ORDER BY sort_order LIMIT 1;
    IF NOT FOUND THEN
      SELECT parent_id, sort_order INTO new_parent, after_sort FROM nav_items
       WHERE tenant_id = t.id AND route = '/bookings'
       ORDER BY sort_order LIMIT 1;
    END IF;
    IF NOT FOUND THEN
      new_parent := NULL;
      SELECT COALESCE(MAX(sort_order), -1) INTO after_sort FROM nav_items
       WHERE tenant_id = t.id AND parent_id IS NULL;
    END IF;

    UPDATE nav_items SET sort_order = sort_order + 1
     WHERE tenant_id = t.id
       AND parent_id IS NOT DISTINCT FROM new_parent
       AND sort_order > after_sort;

    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, new_parent, 'link', 'Online orders', 'ShoppingBag', '/orders', 'web_orders', after_sort + 1)
    RETURNING id INTO orders_id;

    IF NOT EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id AND route = '/orders/settings') THEN
      INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
      VALUES (t.id, orders_id, 'link', 'Ordering setup', 'Settings2', '/orders/settings', 'web_ordering_setup', 0);
    END IF;
  END LOOP;
END $$;

COMMIT;
