-- ============================================================
-- 071_list_memberships.sql
-- Cross-tenant membership lookup for login-then-pick-tenant.
--
-- `users` is RLS-scoped to app.tenant_id, so /api/me could only see the
-- current restaurant. This SECURITY DEFINER function returns every active
-- tenant the identity belongs to (matched by Auth0 sub and/or email) so
-- the SPA can show a picker after a single login with no Auth0 org.
-- ============================================================

CREATE OR REPLACE FUNCTION list_memberships_for_identity(p_sub text, p_email text)
RETURNS TABLE (
  tenant_id    uuid,
  name         text,
  slug         text,
  plan         text,
  auth0_org_id text,
  is_active    boolean,
  role         user_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.name, t.slug, t.plan, t.auth0_org_id, t.is_active, u.role
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
   WHERE u.is_active = true
     AND t.is_active = true
     AND (
       (p_sub IS NOT NULL AND p_sub <> '' AND u.auth0_user_id = p_sub)
       OR (p_email IS NOT NULL AND p_email <> '' AND lower(u.email) = lower(p_email))
     )
   ORDER BY t.name;
$$;

COMMENT ON FUNCTION list_memberships_for_identity(text, text) IS
  'Bypasses users RLS to list every restaurant an Auth0 identity can open.';

REVOKE ALL ON FUNCTION list_memberships_for_identity(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_memberships_for_identity(text, text) TO PUBLIC;
