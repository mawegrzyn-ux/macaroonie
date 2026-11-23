-- For review (/review) in every group's saved menu (Pepper-first step 5c,
-- 23 Nov 2026): what waits for the person before it takes effect (Pepper's
-- cards left unanswered, supplier orders to approve, invoices to book in)
-- and Done by Pepper, as two tabs (admin/src/pages/Review.jsx).
--
-- The link goes straight after the Pepper link (/ai), wherever that is in a
-- group's menu (the links after it, Done by Pepper among them, move down
-- one); the roles the Pepper link is hidden from don't see it either.
-- Skipped where the link is already there or there is no Pepper link. A
-- second run changes nothing.

WITH anchors AS (
  SELECT DISTINCT ON (n.tenant_id) n.tenant_id, n.parent_id, n.sort_order, n.hidden_role_ids
    FROM nav_items n
   WHERE n.route = '/ai'
   ORDER BY n.tenant_id, n.sort_order
), bumped AS (
  UPDATE nav_items n SET sort_order = n.sort_order + 1
    FROM anchors a
   WHERE n.tenant_id = a.tenant_id
     AND n.parent_id IS NOT DISTINCT FROM a.parent_id
     AND n.sort_order > a.sort_order
     AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/review')
  RETURNING 1
)
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids)
SELECT a.tenant_id, a.parent_id, 'link', 'For review', 'Inbox', '/review', 'ai_assistant', a.sort_order + 1,
       COALESCE(a.hidden_role_ids, '{}'::uuid[])
  FROM anchors a
 WHERE NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/review');
