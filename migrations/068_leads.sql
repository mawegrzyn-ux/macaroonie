-- 068_leads.sql
-- Marketing site "register interest" capture. Prospects submit this before
-- they're a tenant, so there's no tenant_id to scope by yet — global table,
-- no RLS, same pattern as platform_admins / backlog_items. Read via
-- pm2 logs / direct DB query for now; the marketing form's own notification
-- email is the primary "you have a new lead" signal.

CREATE TABLE leads (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  email        text        NOT NULL,
  venue_name   text,
  message      text,
  source       text        NOT NULL DEFAULT 'marketing_site',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_leads_created ON leads(created_at DESC);
