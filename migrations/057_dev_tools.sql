BEGIN;

CREATE TABLE backlog_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                    text NOT NULL,
  description              text,
  type                     text NOT NULL DEFAULT 'task'
                             CHECK (type IN ('epic','story','task','bug','spike')),
  status                   text NOT NULL DEFAULT 'backlog'
                             CHECK (status IN ('backlog','todo','in_progress','in_review','done')),
  priority                 text NOT NULL DEFAULT 'medium'
                             CHECK (priority IN ('critical','high','medium','low')),
  labels                   text[] NOT NULL DEFAULT '{}',
  story_points             int,
  sort_order               int NOT NULL DEFAULT 0,
  reporter_tenant_id       uuid REFERENCES tenants(id) ON DELETE SET NULL,
  promoted_from_issue_id   uuid,
  promoted_from_request_id uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE issue_log (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title                  text NOT NULL,
  description            text,
  category               text NOT NULL DEFAULT 'incident'
                           CHECK (category IN ('incident','problem','change_request','service_request')),
  impact                 text NOT NULL DEFAULT 'low'
                           CHECK (impact IN ('critical','high','medium','low')),
  urgency                text NOT NULL DEFAULT 'low'
                           CHECK (urgency IN ('critical','high','medium','low')),
  priority               text NOT NULL DEFAULT 'p4'
                           CHECK (priority IN ('p1','p2','p3','p4')),
  status                 text NOT NULL DEFAULT 'new'
                           CHECK (status IN ('new','acknowledged','in_progress','resolved','closed')),
  resolution_notes       text,
  promoted_to_backlog_id uuid REFERENCES backlog_items(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz
);

ALTER TABLE issue_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_log_tenant ON issue_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE feature_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title                  text NOT NULL,
  description            text,
  status                 text NOT NULL DEFAULT 'submitted'
                           CHECK (status IN ('submitted','under_review','planned','in_progress','shipped','declined')),
  admin_notes            text,
  upvotes                int NOT NULL DEFAULT 0,
  promoted_to_backlog_id uuid REFERENCES backlog_items(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feature_request_upvotes (
  request_id uuid NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, user_id)
);

CREATE TABLE changelog_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version          text,
  title            text NOT NULL,
  body             text,
  type             text NOT NULL DEFAULT 'feature'
                     CHECK (type IN ('feature','fix','improvement','security','breaking','maintenance')),
  is_published     boolean NOT NULL DEFAULT false,
  published_at     timestamptz,
  backlog_item_ids uuid[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Seed new modules for existing tenants
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, m.key, true
FROM tenants t
CROSS JOIN (VALUES ('issue_log'),('feature_requests'),('changelog')) AS m(key)
ON CONFLICT DO NOTHING;

-- Add permissions to existing built-in roles
UPDATE tenant_roles SET permissions = permissions ||
  '{"issue_log":"manage","feature_requests":"manage","changelog":"view"}'::jsonb
WHERE key = 'owner' AND (permissions->>'issue_log') IS NULL;

UPDATE tenant_roles SET permissions = permissions ||
  '{"issue_log":"manage","feature_requests":"manage","changelog":"view"}'::jsonb
WHERE key = 'admin' AND (permissions->>'issue_log') IS NULL;

UPDATE tenant_roles SET permissions = permissions ||
  '{"issue_log":"manage","feature_requests":"manage","changelog":"view"}'::jsonb
WHERE key = 'operator' AND (permissions->>'issue_log') IS NULL;

UPDATE tenant_roles SET permissions = permissions ||
  '{"issue_log":"view","feature_requests":"view","changelog":"view"}'::jsonb
WHERE key = 'viewer' AND (permissions->>'issue_log') IS NULL;

COMMIT;
