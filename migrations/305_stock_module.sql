-- 305_stock_module.sql
--
-- Inventory phase 4a (docs/INVENTORY.md 10.1, decision D11; 27 Nov 2026): a
-- module of its own for stock, in a new group Stock (api/src/config/modules.js).
--   stock   View: stock on hand, counts and the ledger (no values: those
--           need Costing view); Use: count (and, from phase 4b, log waste,
--           send and receive transfers); Manage: approve counts, adjust
--           stock, storage areas, key-item lists and the stock settings
-- Built-in roles take the defaults in MODULES (owner and admin manage,
-- operator use, viewer view).

-- The module switch for every existing tenant (new ones seed from MODULES).
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'stock', true FROM tenants t
ON CONFLICT DO NOTHING;

-- Custom roles have no module defaults (those are for the four built-in
-- roles), so each takes a level from what it had in purchasing, where stock
-- counts were until now: whoever set the catalogue up (Purchasing setup
-- Manage) manages stock; whoever ordered and received (Purchasing Manage,
-- who could count) counts; whoever could see purchasing sees stock; the rest
-- get none. A role given a stock level already keeps it.
UPDATE tenant_roles
   SET permissions = permissions || jsonb_build_object('stock',
         CASE
           WHEN permissions->>'purchasing_setup' = 'manage' THEN 'manage'
           WHEN permissions->>'purchasing' = 'manage' THEN 'use'
           WHEN permissions->>'purchasing' IN ('view', 'use')
             OR permissions->>'purchasing_setup' = 'view'
             OR permissions->>'purchasing_approve' IN ('view', 'manage') THEN 'view'
           ELSE 'none'
         END)
 WHERE NOT is_builtin
   AND NOT (permissions ? 'stock');
