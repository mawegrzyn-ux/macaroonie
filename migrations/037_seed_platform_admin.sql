-- ============================================================
-- 037_seed_platform_admin.sql
--
-- Seed initial platform admin (Michal Wegrzyn) so /platform
-- becomes accessible without manual DB access.
--
-- Idempotent: ON CONFLICT DO NOTHING on auth0_user_id UNIQUE.
-- Safe to re-run; safe on fresh DB builds.
-- ============================================================

BEGIN;

INSERT INTO platform_admins (auth0_user_id, email, full_name, is_active)
VALUES (
  'google-oauth2|104333628650535375082',
  'ma.wegrzyn@gmail.com',
  'Michal Wegrzyn',
  true
)
ON CONFLICT (auth0_user_id) DO NOTHING;

COMMIT;
