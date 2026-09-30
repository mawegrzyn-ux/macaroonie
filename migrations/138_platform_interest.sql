-- ============================================================
-- 138_platform_interest.sql
--
-- Register-interest form on the platform page (macaroonie.com, apex).
-- One row per submission. Global platform table like backlog_items: no
-- tenant_id and no RLS; read and changed only by platform admins
-- (routes/platform.js), written by the public form (routes/platformSite.js).
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_interest (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  email       text        NOT NULL,
  company     text,
  phone       text,
  sites       text,
  message     text,
  consent_at  timestamptz NOT NULL,
  status      text        NOT NULL DEFAULT 'new'
                          CHECK (status IN ('new', 'contacted', 'closed')),
  notes       text,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_interest_created_idx ON platform_interest (created_at DESC);
