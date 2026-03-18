-- ============================================================
-- 004_booking_rules.sql
-- Booking rules + deposit config per venue
-- ============================================================

-- ── Booking rules ────────────────────────────────────────────
-- One row per venue (can extend to per-sitting overrides later).
CREATE TABLE booking_rules (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            uuid        NOT NULL UNIQUE REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Slot duration: how long a booking occupies the table
  slot_duration_mins  int         NOT NULL DEFAULT 90
                                  CHECK (slot_duration_mins > 0),

  -- Buffer added after each booking before table is offered again
  buffer_after_mins   int         NOT NULL DEFAULT 0
                                  CHECK (buffer_after_mins >= 0),

  -- Covers
  min_covers          int         NOT NULL DEFAULT 1
                                  CHECK (min_covers >= 1),
  max_covers          int         NOT NULL DEFAULT 20
                                  CHECK (max_covers >= 1),

  -- Booking window
  -- How many days ahead guests can book (0 = same day allowed)
  book_from_days      int         NOT NULL DEFAULT 0,
  -- How many days in advance bookings open (e.g. 90 = 3 months ahead max)
  book_until_days     int         NOT NULL DEFAULT 90,
  -- Cutoff: how many minutes before a slot guests can no longer book
  cutoff_before_mins  int         NOT NULL DEFAULT 60,

  -- Hold TTL: how long a hold is kept before being released (configurable per venue)
  hold_ttl_secs       int         NOT NULL DEFAULT 300
                                  CHECK (hold_ttl_secs BETWEEN 60 AND 1800),

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_rules_covers_check CHECK (max_covers >= min_covers),
  CONSTRAINT booking_rules_window_check CHECK (book_until_days > book_from_days)
);

ALTER TABLE booking_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY br_tenant_isolation ON booking_rules
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_booking_rules_venue  ON booking_rules(venue_id);
CREATE INDEX idx_booking_rules_tenant ON booking_rules(tenant_id);

CREATE TRIGGER trg_booking_rules_updated_at
  BEFORE UPDATE ON booking_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Deposit rules ────────────────────────────────────────────
CREATE TYPE deposit_type AS ENUM ('fixed', 'per_cover');

-- One row per venue. requires_deposit = false → no payment at booking.
CREATE TABLE deposit_rules (
  id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            uuid            NOT NULL UNIQUE REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id           uuid            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  requires_deposit    boolean         NOT NULL DEFAULT false,
  deposit_type        deposit_type,               -- null when requires_deposit = false
  -- fixed: flat amount per booking (e.g. £10.00)
  -- per_cover: amount × guest count (e.g. £5.00 × 4 guests = £20.00)
  deposit_amount      numeric(10,2),
  -- Stripe uses smallest currency unit (pence/cents); store in major unit here,
  -- multiply × 100 when creating PaymentIntent
  currency            char(3)         NOT NULL DEFAULT 'GBP',

  -- Refund policy
  -- NULL = non-refundable; integer = refundable if cancelled > N hours before slot
  refund_hours_before int,

  created_at          timestamptz     NOT NULL DEFAULT now(),
  updated_at          timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT deposit_rules_amount_check
    CHECK (
      (requires_deposit = false)
      OR (deposit_type IS NOT NULL AND deposit_amount IS NOT NULL AND deposit_amount > 0)
    )
);

ALTER TABLE deposit_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY dr_tenant_isolation ON deposit_rules
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_deposit_rules_venue ON deposit_rules(venue_id);

CREATE TRIGGER trg_deposit_rules_updated_at
  BEFORE UPDATE ON deposit_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
