-- 118_rota_tips_permission.sql
--
-- Splits the rota "pay & tips" permission in two so a role can see (or
-- manage) wages without tips, or tips without wages:
--
--   rota_pay   hours and pay, pay overrides, fill Cash Recon wages
--   rota_tips  tip pots, points, tip shares, pot amounts, tip moves
--
-- Every role's new rota_tips starts equal to its current rota_pay, and the
-- tenant switch copies rota_pay's, so nothing changes until someone edits
-- the role on the Access page.

BEGIN;

INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'rota_tips',
       COALESCE((SELECT m.is_enabled FROM tenant_modules m
                  WHERE m.tenant_id = t.id AND m.module_key = 'rota_pay'), true)
  FROM tenants t
ON CONFLICT (tenant_id, module_key) DO NOTHING;

UPDATE tenant_roles
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || jsonb_build_object('rota_tips',
                          COALESCE(permissions ->> 'rota_pay',
                                   CASE key WHEN 'owner' THEN 'manage' WHEN 'admin' THEN 'manage' ELSE 'none' END))
 WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'rota_tips');

COMMIT;
