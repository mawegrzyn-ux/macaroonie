-- 291_cash_integrations_menu.sql
--
-- Integrations (/integrations) in every group's saved menu (sales from other
-- tills, phase 1, 24 Nov 2026): the other tills whose sales Macaroonie keeps,
-- their venues, sync and history import (admin/src/pages/Integrations.jsx).
--
-- The link goes straight after the Cash recon link (/cash-recon), wherever
-- that is in a group's menu (the links after it move down one); the roles
-- the Cash recon link is hidden from don't see it either. Skipped where the
-- link is already there or there is no Cash recon link. A second run changes
-- nothing.

WITH anchors AS (
  SELECT DISTINCT ON (n.tenant_id) n.tenant_id, n.parent_id, n.sort_order, n.hidden_role_ids
    FROM nav_items n
   WHERE n.route = '/cash-recon'
   ORDER BY n.tenant_id, n.sort_order
), bumped AS (
  UPDATE nav_items n SET sort_order = n.sort_order + 1
    FROM anchors a
   WHERE n.tenant_id = a.tenant_id
     AND n.parent_id IS NOT DISTINCT FROM a.parent_id
     AND n.sort_order > a.sort_order
     AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/integrations')
  RETURNING 1
)
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids)
SELECT a.tenant_id, a.parent_id, 'link', 'Integrations', 'Plug', '/integrations', 'cash_recon', a.sort_order + 1,
       COALESCE(a.hidden_role_ids, '{}'::uuid[])
  FROM anchors a
 WHERE NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/integrations');
