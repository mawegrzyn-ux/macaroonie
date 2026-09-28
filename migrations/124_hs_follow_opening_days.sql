-- ============================================================
-- 124_hs_follow_opening_days.sql
--
-- Tenant-wide H&S setting: when on, food safety checks and daily
-- checklists are not expected on days a venue is closed (from its booking
-- schedule: exceptions, date overrides, weekly template). Weekly and
-- monthly checklists are unaffected. Off by default, so nothing changes
-- until an admin turns it on.
-- ============================================================

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS hs_follow_opening_days boolean NOT NULL DEFAULT false;

COMMIT;
