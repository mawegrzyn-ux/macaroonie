-- ============================================================
-- 005_bookings.sql
-- Booking holds + confirmed bookings + payments + notification log
-- ============================================================

-- ── Booking holds (temporary locks) ──────────────────────────
-- Created when guest presses Book. TTL = booking_rules.hold_ttl_secs.
-- Deleted on: payment confirmed, guest cancels, TTL sweep job.
-- UNIQUE (table_id, starts_at) is the DB-level double-booking guard.
CREATE TABLE booking_holds (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  table_id        uuid        NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,  -- starts_at + slot_duration_mins
  covers          int         NOT NULL CHECK (covers >= 1),
  -- Guest details captured at hold time so they're not lost if session drops
  guest_name      text        NOT NULL,
  guest_email     text        NOT NULL,
  guest_phone     text,
  -- Stripe PaymentIntent id — populated only when deposit required
  stripe_pi_id    text,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_id, starts_at)
);

ALTER TABLE booking_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY bh_tenant_isolation ON booking_holds
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- expires_at index: used by sweep job and availability queries
CREATE INDEX idx_holds_expires      ON booking_holds(expires_at);
CREATE INDEX idx_holds_table_time   ON booking_holds(table_id, starts_at);
CREATE INDEX idx_holds_venue        ON booking_holds(venue_id);

-- ── Bookings ──────────────────────────────────────────────────
CREATE TYPE booking_status AS ENUM (
  'pending_payment',  -- hold exists, awaiting Stripe webhook
  'confirmed',        -- active booking
  'cancelled',        -- cancelled by guest or operator
  'no_show',          -- guest did not arrive
  'completed'         -- post-visit, for record keeping
);

CREATE TABLE bookings (
  id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            uuid            NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  table_id            uuid            NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
  tenant_id           uuid            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Time
  starts_at           timestamptz     NOT NULL,
  ends_at             timestamptz     NOT NULL,

  -- Guest
  covers              int             NOT NULL CHECK (covers >= 1),
  guest_name          text            NOT NULL,
  guest_email         text            NOT NULL,
  guest_phone         text,
  guest_notes         text,           -- dietary, celebration, accessibility notes

  -- Status
  status              booking_status  NOT NULL DEFAULT 'confirmed',

  -- Operator notes (internal, not shown to guest)
  operator_notes      text,

  -- Reference shown to guest in confirmation email
  reference           text            NOT NULL UNIQUE
                                      DEFAULT upper(substring(gen_random_uuid()::text, 1, 8)),

  created_at          timestamptz     NOT NULL DEFAULT now(),
  updated_at          timestamptz     NOT NULL DEFAULT now(),

  -- Availability index: partial index excludes cancelled so overlap checks stay fast
  CONSTRAINT bookings_time_check CHECK (ends_at > starts_at)
);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY bookings_tenant_isolation ON bookings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Core availability check index (partial — skip cancelled)
CREATE INDEX idx_bookings_availability ON bookings(table_id, starts_at, ends_at)
  WHERE status NOT IN ('cancelled');

CREATE INDEX idx_bookings_venue_time   ON bookings(venue_id, starts_at);
CREATE INDEX idx_bookings_tenant_time  ON bookings(tenant_id, starts_at);
CREATE INDEX idx_bookings_guest_email  ON bookings(tenant_id, guest_email);
CREATE INDEX idx_bookings_reference    ON bookings(reference);

CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Payments ──────────────────────────────────────────────────
CREATE TYPE payment_status AS ENUM (
  'pending',
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded'
);

CREATE TABLE payments (
  id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          uuid            NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  tenant_id           uuid            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  stripe_pi_id        text            NOT NULL UNIQUE,
  amount              numeric(10,2)   NOT NULL CHECK (amount > 0),
  currency            char(3)         NOT NULL,
  status              payment_status  NOT NULL DEFAULT 'pending',

  refunded_amount     numeric(10,2)   NOT NULL DEFAULT 0,
  refunded_at         timestamptz,

  created_at          timestamptz     NOT NULL DEFAULT now(),
  updated_at          timestamptz     NOT NULL DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_tenant_isolation ON payments
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_payments_booking ON payments(booking_id);
CREATE INDEX idx_payments_stripe  ON payments(stripe_pi_id);

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Notification log ──────────────────────────────────────────
CREATE TYPE notification_type AS ENUM (
  'confirmation',
  'reminder_24h',
  'reminder_2h',
  'cancellation',
  'no_show_followup'
);

CREATE TABLE notification_log (
  id              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid                NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  tenant_id       uuid                NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type            notification_type   NOT NULL,
  recipient_email text                NOT NULL,
  sent_at         timestamptz,
  failed_at       timestamptz,
  error           text,
  created_at      timestamptz         NOT NULL DEFAULT now()
);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY nl_tenant_isolation ON notification_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_notif_booking ON notification_log(booking_id);
CREATE INDEX idx_notif_tenant  ON notification_log(tenant_id, created_at);
