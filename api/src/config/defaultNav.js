// src/config/defaultNav.js
//
// Canonical default nav tree — mirrors migration 091's one-time seed for
// existing tenants. This module is what NEW tenants get seeded from (see
// platform.js's tenant creation route) and what "Reset to defaults" in the
// nav designer restores. Keep this in sync with the migration's seed if
// you ever change what a fresh tenant should start with — the migration
// itself is never re-run, so this is the only copy that matters going
// forward.

export const DEFAULT_NAV_TREE = [
  {
    label: 'Service', children: [
      { label: 'Overview', icon: 'LayoutDashboard', route: '/', module: 'dashboard' },
      { label: 'Timeline', icon: 'CalendarDays', route: '/timeline', module: 'bookings' },
      { label: 'Bookings', icon: 'BookOpen', route: '/bookings', module: 'bookings' },
      { label: 'Customers', icon: 'UserRound', route: '/customers', module: 'customers' },
      {
        label: 'Order sheets', icon: 'ClipboardList', route: '/order-sheets', module: 'order_sheets',
        children: [
          { label: 'Templates', icon: 'ClipboardList', route: '/order-sheets/templates', module: 'order_sheet_setup' },
          { label: 'Categories', icon: 'Tag', route: '/order-sheets/categories', module: 'order_sheet_setup' },
        ],
      },
      { label: 'Cash recon', icon: 'Wallet', route: '/cash-recon', module: 'cash_recon' },
      { label: 'Cash dashboard', icon: 'LayoutGrid', route: '/cash-dashboard', module: 'cash_dashboard' },
      { label: 'Food safety', icon: 'Thermometer', route: '/food-safety', module: 'food_safety' },
      { label: 'Checklists', icon: 'ListChecks', route: '/checklists', module: 'checklists' },
      { label: 'H&S Dashboard', icon: 'LayoutGrid', route: '/hs-dashboard', module: 'hs_dashboard' },
      { label: 'Action log', icon: 'ClipboardCheck', route: '/hs-action-log', module: 'hs_action_log' },
    ],
  },
  {
    label: 'Website', children: [
      { label: 'Website', icon: 'Globe', route: '/website', module: 'website' },
      {
        label: 'Menus', icon: 'ChefHat', route: '/menus', module: 'menus',
        children: [
          { label: 'Variant groups', icon: 'Layers', route: '/menus/variant-groups', module: 'menus' },
          { label: 'Dietary groups', icon: 'Tag', route: '/menus/dietary-groups', module: 'menus' },
        ],
      },
      { label: 'Media', icon: 'FolderOpen', route: '/media', module: 'website' },
      { label: 'Reviews', icon: 'MessageSquare', route: '/reviews', module: 'website' },
    ],
  },
  {
    label: 'Setup', children: [
      { label: 'Venues', icon: 'Building2', route: '/venues', module: 'venues' },
      { label: 'Tables', icon: 'Table2', route: '/tables', module: 'tables' },
      { label: 'Schedule', icon: 'Clock', route: '/schedule', module: 'schedule' },
      { label: 'Rules', icon: 'Settings', route: '/rules', module: 'rules' },
    ],
  },
  {
    label: 'Account', children: [
      {
        label: 'Emails', icon: 'Mail', route: '/email-templates', module: 'email_templates',
        children: [
          { label: 'Monitor', icon: 'Activity', route: '/email-monitoring', module: 'email_templates' },
        ],
      },
      { label: 'Team', icon: 'Users', route: '/team', module: 'team' },
      { label: 'Access', icon: 'Shield', route: '/access', module: 'team' },
      { label: 'Settings', icon: 'SlidersHorizontal', route: '/settings', module: 'settings' },
      { label: 'Widget test', icon: 'LayoutTemplate', route: '/widget-test', module: 'widget_test' },
      { label: 'Test data', icon: 'FlaskConical', route: '/test-data', module: 'test_data' },
      { label: 'Legacy import', icon: 'FileSpreadsheet', route: '/legacy-import', module: 'test_data' },
      { label: 'Navigation', icon: 'Compass', route: '/nav-designer', module: 'nav_designer' },
    ],
  },
  {
    label: 'Help', children: [
      { label: 'Issues', icon: 'AlertCircle', route: '/issues', module: 'issue_log' },
      { label: 'Feature requests', icon: 'Lightbulb', route: '/feature-requests', module: 'feature_requests' },
      { label: "What's new", icon: 'Newspaper', route: '/changelog', module: 'changelog' },
      { label: 'Documentation', icon: 'BookMarked', route: '/docs', module: 'documentation' },
      { label: 'Help', icon: 'HelpCircle', route: '/help', module: 'documentation' },
    ],
  },
]

/** Insert DEFAULT_NAV_TREE for one tenant. Caller decides whether to clear existing rows first. */
export async function seedDefaultNav(tx, tenantId) {
  async function insertNode(node, parentId, sortOrder) {
    const kind = node.route ? 'link' : 'section'
    const [row] = await tx`
      INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
      VALUES (${tenantId}, ${parentId}, ${kind}, ${node.label}, ${node.icon ?? null}, ${node.route ?? null}, ${node.module ?? null}, ${sortOrder})
      RETURNING id
    `
    for (let i = 0; i < (node.children ?? []).length; i++) {
      await insertNode(node.children[i], row.id, i)
    }
  }
  for (let i = 0; i < DEFAULT_NAV_TREE.length; i++) {
    await insertNode(DEFAULT_NAV_TREE[i], null, i)
  }
}
