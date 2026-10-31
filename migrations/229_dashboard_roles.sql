-- 229_dashboard_roles.sql
--
-- Two access changes (31 Oct 2026):
--
-- 1. A Use level between View and Manage for checklists, food safety logs
--    and the H&S action log: the everyday work (tick a checklist, log a
--    temperature, add or tick off an action) without changing the setup.
--    No schema change: a role's permissions jsonb can now hold 'use' for
--    those modules (config/modules.js, PERMISSION_LEVELS / levelsOf()).
--
-- 2. Each dashboard (H&S, Cash, Rota and the blank ones) can be hidden from
--    roles, like menu links and Overview tiles: hidden_role_ids lists the
--    tenant_roles that don't see it. People who can manage that dashboard
--    page still see every dashboard while they edit the layout.

ALTER TABLE hs_dashboards
  ADD COLUMN IF NOT EXISTS hidden_role_ids uuid[] NOT NULL DEFAULT '{}';
