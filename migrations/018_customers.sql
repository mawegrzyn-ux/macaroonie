-- ============================================================
-- 018_customers.sql
--
-- Customer profile table with GDPR support.
-- Bookings are linked via customer_id (nullable — existing
-- bookings have no customer record yet; new ones are linked
-- automatically on confirm).
--
-- GDPR anonymise path:
--   UPDATE customers SET name='Anonymised', email='anon-…@deleted.local',
--          phone=null, is_anonymised=true, anonymised_at=now()
--   UPDATE bookings SET guest_name='Anonymised', guest_email=...,
--          guest_phone=null, reference='ANON-…'
--   (record is kept; only PII is overwritten)
-- ============================================================

CREATE TABLE customers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  email         text,
  phone         text,
  notes         text,
  is_anonymised boolean     NOT NULL DEFAULT false,
  anonymised_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_tenant ON customers
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Fast search
CREATE INDEX customers_name_idx  ON customers (tenant_id, lower(name));
CREATE INDEX customers_email_idx ON customers (tenant_id, lower(coalesce(email, '')));

-- Link bookings to customers
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX bookings_customer_id_idx ON bookings (customer_id)
  WHERE customer_id IS NOT NULL;
