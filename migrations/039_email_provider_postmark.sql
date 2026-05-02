-- ============================================================
-- 039_email_provider_postmark.sql
--
-- Extend the email_provider CHECK constraint on venue_email_settings
-- to include 'postmark'.
--
-- Migration 035 created the column with a closed enum check
-- ('sendgrid', 'mailgun', 'ses', 'smtp'). Adding Postmark as a 5th
-- provider requires loosening that constraint.
--
-- Idempotent: looks up the existing constraint by name, drops it
-- if present, then adds the new one.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'venue_email_settings'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%email_provider%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE venue_email_settings DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE venue_email_settings
  ADD CONSTRAINT venue_email_settings_email_provider_check
    CHECK (email_provider IN ('sendgrid', 'postmark', 'mailgun', 'ses', 'smtp'));

COMMIT;
