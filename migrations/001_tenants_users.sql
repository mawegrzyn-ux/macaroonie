-- ============================================================
-- 001_tenants_users.sql
-- Foundation: tenants + users
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_cron";   -- for hold sweep job

-- ── Tenants ──────────────────────────────────────────────────
-- Not RLS-protected (resolved at auth time only)
CREATE TABLE tenants (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  slug              text        NOT NULL UNIQUE,
  plan              text        NOT NULL DEFAULT 'starter',   -- starter | pro | enterprise
  stripe_account_id text,                                     -- Stripe Connect account
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── Users (operators / admins per tenant) ────────────────────
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'operator', 'viewer');

CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         text        NOT NULL,
  password_hash text,                       -- null if SSO only
  role          user_role   NOT NULL DEFAULT 'operator',
  full_name     text,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_tenant_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_users_tenant ON users(tenant_id);

-- ── Updated_at trigger (reused across all tables) ────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
