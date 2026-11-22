// src/pages/docs/rbac.jsx
// The Docs page's "RBAC: Modules & Roles" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'rbac'
export const label = 'RBAC: Modules & Roles'
export const order = 90

// ── RBAC: MODULES & ROLES ────────────────────
export function Section() {
  return (
    <section id="rbac" data-doc="">
      <H2>RBAC: Modules &amp; Roles</H2>
      <P>
        Two layers of access control, introduced by migration 038. The model in
        <Mono>api/src/config/modules.js</Mono> is the single source of truth for
        every module the platform knows about (<Mono>MODULES</Mono>).
      </P>

      <H3>Schema (migration 038)</H3>
      <DataTable
        head={['Table', 'Purpose', 'Key columns']}
        rows={[
          ['tenant_modules', 'Per-tenant on/off switch per module. Disabled modules are hidden from nav AND rejected at the API.', 'tenant_id, module_key, is_enabled, config jsonb. UNIQUE(tenant_id, module_key).'],
          ['tenant_roles',   'Custom roles per tenant. permissions JSONB maps module_key → "manage" | "use" | "view" | "none" ("use" only on modules that offer it, migration 229).', 'tenant_id, key, label, is_builtin, is_active, permissions, sort_order. UNIQUE(tenant_id, key).'],
          ['users.custom_role_id (added)', 'Optional FK to tenant_roles. When NULL, the legacy users.role enum is used + mapped to a built-in role with the same key.', 'nullable uuid, ON DELETE SET NULL'],
        ]}
      />

      <H3>Module groups</H3>
      <P>
        <Mono>MODULE_GROUPS</Mono> in <Mono>modules.js</Mono> bundles tightly-coupled
        modules under one master switch. The Modules tab in <Mono>/access</Mono> toggles
        GROUPS, not individual modules — so disabling Bookings hides every booking-related
        nav entry at once.
      </P>
      <DataTable
        head={['Group', 'Modules in the group']}
        rows={[
          ['bookings',        'bookings, venues, tables, schedule, rules, customers, widget_test'],
          ['email_templates', 'email_templates'],
          ['website',         'website'],
          ['cash_recon',      'cash_recon'],
          ['pepper',          'ai_assistant (was in bookings until migration 173; Pepper covers every area, so it has its own switch)'],
          ['(core, no group)', 'dashboard, team, settings, documentation — always-on'],
        ]}
      />

      <H3>API</H3>
      <DataTable
        head={['Method', 'Path', 'Role', 'Purpose']}
        rows={[
          ['GET',    '/api/access/modules',           'any auth',     'List modules with per-tenant enabled state'],
          ['GET',    '/api/access/module-groups',     'any auth',     'List groups with derived enabled state (AND of members)'],
          ['PATCH',  '/api/access/module-groups/:key', 'owner',        'Toggle every member module in one transaction'],
          ['PATCH',  '/api/access/modules/:key',      'owner',        'Toggle a single module (internal use)'],
          ['GET',    '/api/access/roles',             'any auth',     'List tenant_roles with permissions'],
          ['POST',   '/api/access/roles',             'owner',        'Create custom role'],
          ['PATCH',  '/api/access/roles/:id',         'owner',        'Edit role label/description/active/permissions'],
          ['DELETE', '/api/access/roles/:id',         'owner',        'Delete custom role (built-ins protected, refuses if users still reference)'],
        ]}
      />

      <H3>Permission gating</H3>
      <P>
        Use <Mono>requirePermission(moduleKey, &apos;view&apos; | &apos;manage&apos;)</Mono> on routes
        that should respect both the tenant module switch AND the user&apos;s role
        permissions. Platform admins bypass automatically. The middleware checks tenant
        module enablement first (rejects with 403 if disabled even for owner), then the
        user&apos;s role permission level.
      </P>
      <P>
        <Mono>/api/me</Mono> returns <Mono>enabled_modules: string[]</Mono> and
        <Mono> permissions: {`{ [module]: level }`}</Mono>, computed from the union of
        tenant_modules + role permissions. The frontend uses this to gate nav entries
        in <Mono>AppShell.jsx</Mono>.
      </P>

      <H3>View uses, Manage changes (Oct 2026 rollout)</H3>
      <P>
        Every module&apos;s routes now go through module permissions: reads need{' '}
        <Mono>view</Mono>, changes need <Mono>manage</Mono>. Route files that used the old
        <Mono> requireRole(&apos;admin&apos;, &apos;owner&apos;)</Mono> gates (Cash Recon, bookings,
        venues, schedules, customers, menus, website, media, reviews, emails, email monitor,
        payments, issue log, feature requests) define a <Mono>PERM</Mono> object after their
        imports (<Mono>PERM.view</Mono>, <Mono>PERM.manage</Mono>, and where the old gate was
        owner/admin and the operator default is already manage, <Mono>PERM.adminManage</Mono>{' '}
        = <Mono>[requireRole(&apos;admin&apos;, &apos;owner&apos;), requirePermission(module, &apos;manage&apos;)]</Mono>:
        Cash Recon settings and unsubmit, deleting a booking, refunds; removing an email
        suppression is owner + manage). Uploads to the website store accept any of website,
        promotions or menus manage; media changes website or menus manage
        (<Mono>requireAnyPermission</Mono>).
      </P>
      <P>
        Reads other modules depend on stay open to every tenant member: the venue list and
        venue detail, tables, sections, combinations, booking rules, schedules,{' '}
        <Mono>GET /website/tenant-site</Mono>, menu reads and the media library list. Only
        their writes are gated. A refusal reads &ldquo;Your role can view X but not change
        it.&rdquo; / &ldquo;Your role doesn&apos;t have access to X.&rdquo; (<Mono>permissionMessage()</Mono>{' '}
        in <Mono>auth.js</Mono>). <Mono>GET /email-templates/settings/:venueId</Mono> returns
        the provider key, SMTP password and SES secret as <Mono>null</Mono> with{' '}
        <Mono>secrets_hidden: true</Mono> below manage.
      </P>
      <P>
        Built-in roles: tenants created after migration 038 had no <Mono>tenant_roles</Mono>{' '}
        rows, so a user&apos;s role resolved to nothing. Migration 160 inserts the four
        built-in roles for every tenant (<Mono>ON CONFLICT DO NOTHING</Mono>), new tenants get
        them from <Mono>seedBuiltinRoles()</Mono> (<Mono>modules.js</Mono>, called by{' '}
        <Mono>POST /api/platform/tenants</Mono>), and the role key falls back to{' '}
        <Mono>users.role</Mono> when no role row matches. An empty built-in permissions map
        means the module defaults; <Mono>GET /api/access/roles</Mono> returns every module&apos;s
        resolved level (<Mono>resolvePermission()</Mono>).
      </P>
      <P>
        Admin side: <Mono>usePermission(moduleKey)</Mono> (<Mono>hooks/usePermission.js</Mono>)
        returns <Mono>{'{ level, canView, canUse, canManage, isOwnerOrAdmin, isOwner, loaded }'}</Mono>{' '}
        from <Mono>/me</Mono>. Screens hide or disable their change controls when{' '}
        <Mono>canManage</Mono> is false and show <Mono>ReadOnlyNotice</Mono>; a settings form
        is wrapped in <Mono>ReadOnlyFieldset</Mono> (a native{' '}
        <Mono>{'<fieldset disabled>'}</Mono>, which disables every input, select and button
        inside, but not links or clickable divs). Deep component trees pass the state through
        a small context (<Mono>CashReadOnly</Mono> in CashRecon.jsx, <Mono>TimelineReadOnly</Mono>,
        <Mono> MenuReadOnly</Mono>). Dashboards use the page config&apos;s{' '}
        <Mono>moduleKey</Mono> (see H&amp;S Dashboard). The API refuses the change regardless,
        so the admin only decides what is shown.
      </P>

      <H3>Use: a level between View and Manage (migration 229)</H3>
      <P>
        <Mono>PERMISSION_LEVELS</Mono> is <Mono>none, view, use, manage</Mono> (lowest first)
        and <Mono>PERMISSION_RANK</Mono> its order, shared by <Mono>auth.js</Mono>,{' '}
        <Mono>ai/context.js</Mono> and <Mono>routes/installer.js</Mono>. Only a module whose{' '}
        <Mono>MODULES</Mono> entry has a <Mono>use</Mono> text offers it: checklists,
        food_safety, hs_action_log, cash_recon (Use: the day PUT, submit, expenses and receipts,
        the wages PUT, Loyverse / GloriaFood fills, receipt reading, the till&apos;s fill-recon; Pepper&apos;s
        cash change tools carry <Mono>needs: &apos;use&apos;</Mono>; Set as default needs Manage,
        <Mono>canSetDefault</Mono> on <Mono>WeekWagesEditor</Mono>). <Mono>levelsOf(key)</Mono> lists a module&apos;s levels
        (<Mono>GET /api/access/modules</Mono> sends them as <Mono>levels</Mono>, with the{' '}
        <Mono>use</Mono> text for the Access page), <Mono>workLevel(key)</Mono> is the level that
        does its everyday work (<Mono>use</Mono> where offered, else <Mono>manage</Mono>), and{' '}
        <Mono>permissionAtLeast()</Mono> compares by rank. The role routes refuse a level a
        module doesn&apos;t offer (400 &ldquo;Cash reconciliation has no use level: pick None,
        View or Manage.&rdquo;), and <Mono>resolvePermission()</Mono> reads a stored{' '}
        <Mono>use</Mono> on any other module as <Mono>view</Mono>.
      </P>
      <DataTable
        head={['Module', 'Use (requirePermission(m, \'use\'))', 'Manage only']}
        rows={[
          ['checklists', 'PUT /checklists/instance', 'templates and their items'],
          ['food_safety', 'POST / PATCH of temp-logs, deliveries, holds and cooking', 'equipment, capture times, hold stations and times, cooking sessions, settings and items; DELETE /cooking/:id'],
          ['hs_action_log', 'POST /entries, PATCH /entries/:id and /complete', 'DELETE /entries/:id, the categories'],
        ]}
      />
      <P>
        Elsewhere: the Today feed&apos;s <Mono>can_act</Mono> is{' '}
        <Mono>permissionAtLeast(level, workLevel(module))</Mono> (<Mono>services/opsToday.js</Mono>);
        Pepper&apos;s eight H&amp;S change tools check <Mono>use</Mono> and say{' '}
        <Mono>needs: &apos;use&apos;</Mono>, which <Mono>toolAllowed()</Mono> reads for the
        connector&apos;s list (other change tools still need manage). In the admin,{' '}
        <Mono>canUse</Mono> (use or manage) unlocks the check panels in{' '}
        <Mono>components/checklists</Mono>, <Mono>foodSafety</Mono> and{' '}
        <Mono>hsActionLog</Mono>; their setup, deleting and category controls stay on{' '}
        <Mono>canManage</Mono>. Anything that asks whether someone can see a module must test{' '}
        <Mono>level !== &apos;none&apos;</Mono> (or the rank), never{' '}
        <Mono>level === &apos;view&apos; || level === &apos;manage&apos;</Mono>, which hides it
        from Use (the dashboards&apos; <Mono>canUseWidget()</Mono> did).
      </P>
      <H3>Allergen lookup (migration 258)</H3>
      <P>
        Module <Mono>allergens</Mono> (label Allergen lookup, group Menus; defaults owner / admin manage,
        operator / viewer view): the read-only lookup over the live menus without Menus access. Migration 258
        adds its <Mono>tenant_modules</Mono> row, gives every custom role <Mono>allergens: view</Mono> where it
        names none (custom roles have no module defaults, so they would otherwise lose the lookup they had
        through Menus) and puts the <Mono>/allergens</Mono> link after Online orders. It gates{' '}
        <Mono>GET /api/menus/:id/allergens?version=live</Mono> (<Mono>requireAnyPermission(['menus', 'allergens'])</Mono>;
        the draft, the matrix, still needs Menus view), the <Mono>allergen_lookup</Mono> dashboard widget
        (<Mono>WIDGET_MODULE</Mono>), the Overview tile (<Mono>TILE_MODULE</Mono> in{' '}
        <Mono>routes/dashboardTiles.js</Mono>, applied by <Mono>/api/me</Mono>), the phone tile
        (<Mono>module</Mono> in <Mono>mobile/registry.js</Mono>) and Pepper&apos;s <Mono>find_dishes</Mono>{' '}
        (a tool may name its own <Mono>modules</Mono>; <Mono>TOOL_MODULE_KEYS</Mono> for the connector). With
        the lookup alone, find_dishes reads live menus only.
      </P>
    </section>
  )
}
