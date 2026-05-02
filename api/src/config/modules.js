// src/config/modules.js
//
// Single source of truth for which modules exist in the platform.
// Used by:
//   - migration 038 to seed tenant_modules + default role permissions
//   - /api/access/modules to list available modules
//   - tenant/role admin UI to render permission matrix
//   - permission gate middleware
//
// Two layers of access control:
//
//   1. Tenant module switches (TENANT-LEVEL master) operate at the
//      `group` level — disabling the "bookings" group hides every
//      module that belongs to it (timeline, venues, tables, schedule,
//      rules, customers, widget_test). This matches operational
//      reality: those modules are one product, not separate ones.
//
//   2. Role permissions (USER-LEVEL granular) remain per-module —
//      so a role can still have bookings:manage + rules:view,
//      regardless of grouping.
//
// `core: true` means the module is always-on (no tenant toggle) —
// disabling Dashboard / Team / Settings / Docs would lock everyone
// out, so those have no master switch.
//
// To add a new module:
//   1. Add it here with a sensible default per built-in role + group
//   2. Insert it into tenant_modules for existing tenants (migration)
//   3. Wire `requirePermission('module_key', 'manage')` on the routes
//   4. Add its `module: '<key>'` field to NAV in AppShell.jsx

export const MODULES = [
  {
    key:    'bookings',
    label:  'Bookings',
    group:  'bookings',
    description: 'Timeline, booking list, drawer, walk-ins.',
    default: { owner: 'manage', admin: 'manage', operator: 'manage', viewer: 'view' },
  },
  {
    key:    'venues',
    label:  'Venues',
    group:  'bookings',
    description: 'Venue list + sections.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'view' },
  },
  {
    key:    'tables',
    label:  'Tables',
    group:  'bookings',
    description: 'Tables, combinations, disallowed pairs.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'view' },
  },
  {
    key:    'schedule',
    label:  'Schedule',
    group:  'bookings',
    description: 'Templates, sittings, slot caps, exceptions.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'view' },
  },
  {
    key:    'rules',
    label:  'Booking rules',
    group:  'bookings',
    description: 'Hold TTL, cutoff, deposit rules, smart allocation toggles.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'none' },
  },
  {
    key:    'customers',
    label:  'Customers',
    group:  'bookings',
    description: 'Customer profiles + GDPR (anonymise / export).',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'view' },
  },
  {
    key:    'widget_test',
    label:  'Widget test',
    group:  'bookings',
    description: 'Iframe preview of the public booking widget.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'none' },
  },
  {
    key:    'website',
    label:  'Website CMS',
    group:  'website',
    description: 'Per-venue sites, brand defaults, theme manager.',
    default: { owner: 'manage', admin: 'manage', operator: 'none', viewer: 'none' },
  },
  {
    key:    'email_templates',
    label:  'Booking emails',
    group:  'email_templates',
    description: 'Templates, provider settings, sent log.',
    default: { owner: 'manage', admin: 'manage', operator: 'none', viewer: 'none' },
  },
  {
    key:    'cash_recon',
    label:  'Cash reconciliation',
    group:  'cash_recon',
    description: 'Daily reconciliation, weekly grid, SC sources.',
    default: { owner: 'manage', admin: 'manage', operator: 'manage', viewer: 'none' },
  },
  {
    key:    'team',
    label:  'Team',
    core:   true,
    description: 'Invite users, change roles, deactivate, password reset.',
    default: { owner: 'manage', admin: 'view', operator: 'none', viewer: 'none' },
  },
  {
    key:    'settings',
    label:  'Settings',
    core:   true,
    description: 'Theme, timeline defaults, status colours.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'none' },
  },
  {
    key:    'dashboard',
    label:  'Dashboard',
    core:   true,
    description: 'Today overview cards.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'view' },
  },
  {
    key:    'documentation',
    label:  'Help + Docs',
    core:   true,
    description: 'Operator user guide and developer docs.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'view' },
  },
]

export const MODULE_KEYS = MODULES.map(m => m.key)

export const PERMISSION_LEVELS = ['none', 'view', 'manage']

// ── Module groups (for tenant master switches) ─────────────
//
// Each group has a key, a human label, a description, and the list
// of module keys that belong to it. Groups are the unit a tenant
// owner toggles; individual modules within a group enable/disable
// together.
//
// `core: true` modules have no group (no master switch).

export const MODULE_GROUPS = [
  {
    key:    'bookings',
    label:  'Bookings',
    description: 'Reservations, table management, schedule, rules — the core product.',
    moduleKeys: ['bookings', 'venues', 'tables', 'schedule', 'rules', 'customers', 'widget_test'],
  },
  {
    key:    'email_templates',
    label:  'Booking emails',
    description: 'Confirmation / reminder / cancellation emails to guests + manage page.',
    moduleKeys: ['email_templates'],
  },
  {
    key:    'website',
    label:  'Website CMS',
    description: 'Per-venue marketing sites, brand defaults, theme manager.',
    moduleKeys: ['website'],
  },
  {
    key:    'cash_recon',
    label:  'Cash reconciliation',
    description: 'Daily close-out, weekly grid, service-charge sources.',
    moduleKeys: ['cash_recon'],
  },
]

/** Look up the group a module belongs to. Returns null for core modules. */
export function groupOf(moduleKey) {
  for (const g of MODULE_GROUPS) {
    if (g.moduleKeys.includes(moduleKey)) return g.key
  }
  return null
}

/** Highest-to-lowest privilege. */
export function permissionAtLeast(actual, required) {
  const idx = (lvl) => PERMISSION_LEVELS.indexOf(lvl ?? 'none')
  return idx(actual) >= idx(required)
}
