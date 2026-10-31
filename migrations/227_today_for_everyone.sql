-- Today (migration 221, docs/CHAT_FIRST.md) is the front door for everyone
-- signed in: its tasks already follow each person's own access (an area they
-- can't see is left out and named). Its menu link was tied to the Overview's
-- permission (module dashboard) and copied the Overview link's hidden roles,
-- so a role without the Overview (a custom Supervisor, say) never had it.
-- The link now needs no module and is hidden from no role; the Navigation
-- designer can still hide it from a role.

UPDATE nav_items SET module = NULL, hidden_role_ids = '{}' WHERE route = '/today';
