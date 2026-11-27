-- 299_recipes_modules.sql
--
-- Inventory phase 1 (docs/INVENTORY.md 10.1, decision D7; 27 Nov 2026): two
-- modules in a new group, Recipes and costing (api/src/config/modules.js).
--   recipes   View reads recipes and their methods, without costs (the
--             kitchen's recipe book); Manage changes them
--   costing   View shows what recipes cost at each venue's prices; Manage
--             will set cost targets and scenarios (later phases)
-- Built-in roles take the defaults in MODULES (owner and admin manage both;
-- operator views recipes; viewer has neither).

-- The module switches for every existing tenant (new ones seed from MODULES).
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, m.key, true FROM tenants t CROSS JOIN (VALUES ('recipes'), ('costing')) AS m(key)
ON CONFLICT DO NOTHING;

-- Custom roles have no module defaults (those are for the four built-in
-- roles). Recipes without costs are the kitchen's recipe book: View for every
-- custom role not given a level. A cost tells what suppliers charge, so
-- Costing View goes only to the custom roles that already see supplier
-- prices (Purchasing setup View or Manage); the rest get none.
UPDATE tenant_roles
   SET permissions = permissions || '{"recipes": "view"}'::jsonb
 WHERE NOT is_builtin
   AND NOT (permissions ? 'recipes');
UPDATE tenant_roles
   SET permissions = permissions || jsonb_build_object('costing',
         CASE WHEN permissions->>'purchasing_setup' IN ('view', 'manage') THEN 'view' ELSE 'none' END)
 WHERE NOT is_builtin
   AND NOT (permissions ? 'costing');
