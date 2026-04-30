-- ============================================================
-- 035_email_templates_manage_token.sql
--
-- Foundation for the booking email system:
--
--   1. manage_token on bookings — UUID that authenticates guests
--      for the public manage page (/manage/{token}).  No login
--      needed; the token IS the auth.
--
--   2. email_templates — per-tenant (optionally per-venue)
--      templates for confirmation, reminder, modification, and
--      cancellation emails.  Subject + body support merge fields
--      like {{guest_name}}, {{booking_date}}, {{manage_link}}.
--
--   3. email_log — delivery audit trail.
--
--   4. venue_email_settings — per-venue config: reminder timing,
--      email provider selection, reply-to address.
--
-- All tables tenant-scoped via RLS.
-- ============================================================

BEGIN;

-- ── 1. Manage token on bookings ────────────────────────────

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS manage_token uuid UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- Backfill existing rows that have NULL manage_token
UPDATE bookings SET manage_token = gen_random_uuid()
 WHERE manage_token IS NULL;

ALTER TABLE bookings
  ALTER COLUMN manage_token SET NOT NULL;

CREATE INDEX IF NOT EXISTS bookings_manage_token_idx ON bookings (manage_token);


-- ── 2. Email templates ─────────────────────────────────────

CREATE TABLE email_templates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id      uuid        REFERENCES venues(id) ON DELETE CASCADE,

  type          text        NOT NULL
                            CHECK (type IN (
                              'confirmation', 'reminder',
                              'modification', 'cancellation'
                            )),
  subject       text        NOT NULL DEFAULT '',
  body_html     text        NOT NULL DEFAULT '',
  is_active     boolean     NOT NULL DEFAULT true,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, venue_id, type)
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_templates_tenant ON email_templates
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TRIGGER trg_email_templates_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 3. Email log ───────────────────────────────────────────

CREATE TABLE email_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id    uuid        REFERENCES bookings(id) ON DELETE SET NULL,
  template_type text        NOT NULL,
  recipient     text        NOT NULL,
  subject       text        NOT NULL,
  provider      text,
  provider_id   text,
  status        text        NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued', 'sent', 'failed', 'bounced')),
  error         text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_log_tenant ON email_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX email_log_booking_idx ON email_log (booking_id);
CREATE INDEX email_log_created_idx ON email_log (tenant_id, created_at DESC);


-- ── 4. Venue email settings ────────────────────────────────

CREATE TABLE venue_email_settings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id      uuid        NOT NULL UNIQUE REFERENCES venues(id) ON DELETE CASCADE,

  -- Provider config
  email_provider text       NOT NULL DEFAULT 'sendgrid'
                            CHECK (email_provider IN ('sendgrid', 'mailgun', 'ses', 'smtp')),
  from_name      text,
  from_email     text,
  reply_to       text,

  -- Provider-specific credentials (nullable — falls back to env vars)
  provider_api_key   text,
  provider_domain    text,
  provider_region    text,

  -- SMTP-specific (when email_provider = 'smtp')
  smtp_host      text,
  smtp_port      int,
  smtp_user      text,
  smtp_pass      text,
  smtp_secure    boolean     NOT NULL DEFAULT true,

  -- Reminder settings
  reminder_enabled       boolean NOT NULL DEFAULT true,
  reminder_hours_before  int     NOT NULL DEFAULT 24
                                 CHECK (reminder_hours_before BETWEEN 1 AND 168),

  -- Modify / cancel permissions
  allow_guest_modify     boolean NOT NULL DEFAULT true,
  allow_guest_cancel     boolean NOT NULL DEFAULT true,
  cancel_cutoff_hours    int     NOT NULL DEFAULT 2
                                 CHECK (cancel_cutoff_hours >= 0),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE venue_email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_email_settings_tenant ON venue_email_settings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TRIGGER trg_venue_email_settings_updated_at
  BEFORE UPDATE ON venue_email_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
