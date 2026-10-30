-- 222_forget_deleted_menus.sql
--
-- Online ordering settings, revenue streams and the Deliveroo file pick
-- menus by id in uuid arrays with no foreign key, and deleting a menu left
-- its id behind. Ordering setup then sent that id back unseen and every
-- save failed with "A chosen menu wasn't found"; a revenue stream naming
-- only deleted menus showed the till no menu at all.
--
-- Deleting a menu now takes it out of all three (forgetMenu() in
-- routes/menus.js). This clears the ids already left behind, and the menu
-- times kept for them.

UPDATE ordering_settings o
   SET menu_ids = COALESCE((
         SELECT array_agg(u.id ORDER BY u.n)
           FROM unnest(o.menu_ids) WITH ORDINALITY AS u(id, n)
          WHERE EXISTS (SELECT 1 FROM menus m WHERE m.id = u.id AND m.tenant_id = o.tenant_id)
       ), '{}'::uuid[]),
       menu_schedules = COALESCE((
         SELECT jsonb_object_agg(e.key, e.value)
           FROM jsonb_each(o.menu_schedules) AS e
          WHERE EXISTS (SELECT 1 FROM menus m WHERE m.id::text = e.key AND m.tenant_id = o.tenant_id)
       ), '{}'::jsonb),
       updated_at = now()
 WHERE EXISTS (SELECT 1 FROM unnest(o.menu_ids) AS u(id)
                WHERE NOT EXISTS (SELECT 1 FROM menus m WHERE m.id = u.id AND m.tenant_id = o.tenant_id))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(o.menu_schedules) AS k(key)
                WHERE NOT EXISTS (SELECT 1 FROM menus m WHERE m.id::text = k.key AND m.tenant_id = o.tenant_id));

UPDATE pos_revenue_streams r
   SET menu_ids = COALESCE((
         SELECT array_agg(u.id ORDER BY u.n)
           FROM unnest(r.menu_ids) WITH ORDINALITY AS u(id, n)
          WHERE EXISTS (SELECT 1 FROM menus m WHERE m.id = u.id AND m.tenant_id = r.tenant_id)
       ), '{}'::uuid[])
 WHERE EXISTS (SELECT 1 FROM unnest(r.menu_ids) AS u(id)
                WHERE NOT EXISTS (SELECT 1 FROM menus m WHERE m.id = u.id AND m.tenant_id = r.tenant_id));

UPDATE deliveroo_settings d
   SET menu_ids = COALESCE((
         SELECT array_agg(u.id ORDER BY u.n)
           FROM unnest(d.menu_ids) WITH ORDINALITY AS u(id, n)
          WHERE EXISTS (SELECT 1 FROM menus m WHERE m.id = u.id AND m.tenant_id = d.tenant_id)
       ), '{}'::uuid[]),
       updated_at = now()
 WHERE EXISTS (SELECT 1 FROM unnest(d.menu_ids) AS u(id)
                WHERE NOT EXISTS (SELECT 1 FROM menus m WHERE m.id = u.id AND m.tenant_id = d.tenant_id));
