-- 213_platform_settings.sql
--
-- Settings the platform itself holds that aren't secrets (platform_secrets,
-- migration 149, is for keys and is sealed). First user: the Macaroonie
-- Android app download (name 'android_app', services/androidAppSvc.js). A
-- platform admin pastes the app's link on the Platform page (Android app
-- tab); the server keeps its own copy of the APK, and the setup screen of
-- pos., kitchen. and kiosk. offers it at /android.
--
--   value       jsonb, its shape decided by the code that owns the name.
--   updated_by  email of the platform admin who saved it.
--
-- Global like platform_admins: no tenant, so no RLS. Read in system mode or
-- on the plain pool; only platform-admin routes change it.

BEGIN;

CREATE TABLE IF NOT EXISTS platform_settings (
  name        text        PRIMARY KEY,
  value       jsonb       NOT NULL,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;
