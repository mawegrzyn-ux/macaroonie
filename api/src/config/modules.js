// src/config/modules.js
//
// Single source of truth for which modules exist in the platform.
// Used by:
//   - migration 038 to seed tenant_modules + default role permissions
//   - /api/tenant/modules to list available modules
//   - tenant/role admin UI to render permission matrix
//   - permission gate middleware
//
// To add a new module:
//   1. Add it here with a sensible `default_permission` per built-in role
//   2. Insert it into tenant_modules for existing tenants (migration)
//   3. Wire `requirePermission('module_key', 'manage')` on the relevant routes
//   4. Hide its nav entry when disabled (admin/src/components/layout/AppShell.jsx)

export const MODULES = [
  {
    key:    'bookings',
    label:  'Bookings',
    description: 'Timeline, booking list, drawer, walk-ins.',
    default: { owner: 'manage', admin: 'manage', operator: 'manage', viewer: 'view' },
  },
  {
    key:    'venues',
    label:  'Venues',
    description: 'Venue list + sections.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'view' },
  },
  {
    key:    'tables',
    label:  'Tables',
    description: 'Tables, combinations, disallowed pairs.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'view' },
  },
  {
    key:    'schedule',
    label:  'Schedule',
    description: 'Templates, sittings, slot caps, exceptions.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'view' },
  },
  {
    key:    'rules',
    label:  'Booking rules',
    description: 'Hold TTL, cutoff, deposit rules, smart allocation toggles.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'none' },
  },
  {
    key:    'customers',
    label:  'Customers',
    description: 'Customer profiles + GDPR (anonymise / export).',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'view' },
  },
  {
    key:    'website',
    label:  'Website CMS',
    description: 'Per-venue sites, brand defaults, theme manager.',
    default: { owner: 'manage', admin: 'manage', operator: 'none', viewer: 'none' },
  },
  {
    key:    'email_templates',
    label:  'Booking emails',
    description: 'Templates, provider settings, sent log.',
    default: { owner: 'manage', admin: 'manage', operator: 'none', viewer: 'none' },
  },
  {
    key:    'cash_recon',
    label:  'Cash reconciliation',
    description: 'Daily reconciliation, weekly grid, SC sources.',
    default: { owner: 'manage', admin: 'manage', operator: 'manage', viewer: 'none' },
  },
  {
    key:    'team',
    label:  'Team',
    description: 'Invite users, change roles, deactivate, password reset.',
    default: { owner: 'manage', admin: 'view', operator: 'none', viewer: 'none' },
  },
  {
    key:    'settings',
    label:  'Settings',
    description: 'Theme, timeline defaults, status colours.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'none' },
  },
  {
    key:    'dashboard',
    label:  'Dashboard',
    description: 'Today overview cards.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'view' },
  },
  {
    key:    'widget_test',
    label:  'Widget test',
    description: 'Iframe preview of the public booking widget.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'none' },
  },
  {
    key:    'documentation',
    label:  'Help + Docs',
    description: 'Operator user guide and developer docs.',
    default: { owner: 'manage', admin: 'manage', operator: 'view', viewer: 'view' },
  },
]

export const MODULE_KEYS = MODULES.map(m => m.key)

export const PERMISSION_LEVELS = ['none', 'view', 'manage']

/** Highest-to-lowest privilege. */
export function permissionAtLeast(actual, required) {
  const idx = (lvl) => PERMISSION_LEVELS.indexOf(lvl ?? 'none')
  return idx(actual) >= idx(required)
}
