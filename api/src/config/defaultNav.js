// src/config/defaultNav.js
//
// The default main menu: what new tenants are seeded with (platform.js's
// tenant creation route) and what "Reset to defaults" in the nav designer
// restores. Grouped by job, each page once. Migration 196 put every tenant
// on this tree and migration 202 replaced Till setup and Menu screens with the
// Store tech section (later migrations add single links, e.g. 219's Venue
// hub, 221's Today, 228's Till layouts); api/test/nav-default.test.mjs checks 196's tree with those changes
// applied matches this one, so change them together.

export const DEFAULT_NAV_TREE = [
  {
    label: 'Home', children: [
      { label: 'Today', icon: 'Sun', route: '/today' },
      { label: 'Overview', icon: 'LayoutDashboard', route: '/', module: 'dashboard' },
      { label: 'Dashboards', icon: 'LayoutTemplate', route: '/dashboards', module: 'custom_dashboard' },
      { label: 'Pepper', icon: 'Sparkles', route: '/ai', module: 'ai_assistant' },
    ],
  },
  {
    label: 'Service', children: [
      { label: 'Timeline', icon: 'CalendarDays', route: '/timeline', module: 'bookings' },
      { label: 'Bookings', icon: 'BookOpen', route: '/bookings', module: 'bookings' },
      { label: 'Customers', icon: 'UserRound', route: '/customers', module: 'customers' },
      { label: 'Loyalty', icon: 'Gift', route: '/loyalty', module: 'loyalty' },
      { label: 'Online orders', icon: 'ShoppingBag', route: '/orders', module: 'web_orders' },
    ],
  },
  {
    label: 'Money', children: [
      { label: 'Till reports', icon: 'BarChart3', route: '/pos/reports', module: 'pos_reports' },
      { label: 'Kiosk analytics', icon: 'Activity', route: '/pos/kiosk-analytics', module: 'pos_reports' },
      { label: 'Cash recon', icon: 'Wallet', route: '/cash-recon', module: 'cash_recon' },
      { label: 'Cash dashboard', icon: 'LayoutGrid', route: '/cash-dashboard', module: 'cash_dashboard' },
    ],
  },
  {
    label: 'Health & safety', children: [
      { label: 'Food safety', icon: 'Thermometer', route: '/food-safety', module: 'food_safety' },
      { label: 'Checklists', icon: 'ListChecks', route: '/checklists', module: 'checklists' },
      { label: 'H&S dashboard', icon: 'LayoutGrid', route: '/hs-dashboard', module: 'hs_dashboard' },
      { label: 'Action log', icon: 'ClipboardCheck', route: '/hs-action-log', module: 'hs_action_log' },
    ],
  },
  {
    label: 'Stock', children: [
      {
        label: 'Purchasing', icon: 'ShoppingCart', route: '/purchasing', module: 'purchasing',
        children: [
          { label: 'Order lists', icon: 'ClipboardList', route: '/purchasing/lists', module: 'purchasing_setup' },
          { label: 'Inventory', icon: 'Package', route: '/inventory', module: 'purchasing_setup' },
          { label: 'Suppliers', icon: 'Truck', route: '/suppliers', module: 'purchasing_setup' },
        ],
      },
    ],
  },
  {
    label: 'People', children: [
      {
        label: 'Staff', icon: 'UsersRound', route: '/staff', module: 'staff',
        children: [
          { label: 'Roles', icon: 'BadgeCheck', route: '/staff/roles', module: 'staff' },
        ],
      },
      {
        label: 'Rota', icon: 'CalendarRange', route: '/rota', module: 'rota',
        children: [
          { label: 'Rota setup', icon: 'Settings2', route: '/rota/setup', module: 'staff' },
        ],
      },
      { label: 'Rota dashboard', icon: 'LayoutGrid', route: '/rota-dashboard', module: 'rota_dashboard' },
    ],
  },
  {
    label: 'Menus', children: [
      {
        label: 'Menus', icon: 'ChefHat', route: '/menus', module: 'menus',
        children: [
          { label: 'Menu times', icon: 'Clock', route: '/menus/times', module: 'menus' },
          { label: 'Variant groups', icon: 'Layers', route: '/menus/variant-groups', module: 'menus' },
          { label: 'Allergens & dietary', icon: 'Tag', route: '/menus/dietary-tags', module: 'menus' },
          { label: 'Allergen matrix', icon: 'Grid3x3', route: '/menus/allergens', module: 'menus' },
          { label: 'Tax rates', icon: 'Percent', route: '/menus/tax', module: 'menus' },
          { label: 'Translations', icon: 'Languages', route: '/menus/translations', module: 'menus' },
          { label: 'Deliveroo menu', icon: 'Bike', route: '/menus/deliveroo', module: 'menus' },
        ],
      },
      { label: 'Promotions', icon: 'BadgePercent', route: '/promotions', module: 'promotions' },
    ],
  },
  {
    label: 'Brand & web', children: [
      { label: 'Brand & theme', icon: 'Palette', route: '/brand', module: 'website' },
      { label: 'Website', icon: 'Globe', route: '/website', module: 'website' },
      { label: 'Media', icon: 'FolderOpen', route: '/media', module: 'website' },
      { label: 'Reviews', icon: 'MessageSquare', route: '/reviews', module: 'website' },
      {
        label: 'Emails', icon: 'Mail', route: '/email-templates', module: 'email_templates',
        children: [
          { label: 'Monitor', icon: 'Activity', route: '/email-monitoring', module: 'email_templates' },
        ],
      },
    ],
  },
  {
    label: 'Venues', children: [
      {
        label: 'Venues', icon: 'Building2', route: '/venues', module: 'venues',
        children: [
          { label: 'New venue', icon: 'Store', route: '/new-location', module: 'venues' },
        ],
      },
      { label: 'Schedule', icon: 'Clock', route: '/schedule', module: 'schedule' },
      { label: 'Tables', icon: 'Table2', route: '/tables', module: 'tables' },
      { label: 'Booking rules', icon: 'Settings', route: '/rules', module: 'rules' },
      { label: 'Ordering setup', icon: 'Settings2', route: '/orders/settings', module: 'web_ordering_setup' },
    ],
  },
  {
    // Migration 202 holds this section as JSON (the nav test checks they match).
    label: 'Store tech', children: [
      { label: 'Tills', icon: 'MonitorSmartphone', route: '/pos/tills', module: 'pos_setup' },
      { label: 'Till layouts', icon: 'PanelsTopLeft', route: '/pos/layouts', module: 'pos_setup' },
      { label: 'Floor plan', icon: 'LayoutPanelTop', route: '/pos/floor', module: 'pos_setup' },
      { label: 'Kiosks', icon: 'TabletSmartphone', route: '/pos/kiosks', module: 'pos_setup' },
      { label: 'Kitchen screens', icon: 'CookingPot', route: '/pos/kitchen', module: 'pos_setup' },
      { label: 'Menu screens', icon: 'Monitor', route: '/screens', module: 'screens' },
      { label: 'Venue hub', icon: 'Server', route: '/pos/hub', module: 'pos_setup' },
      { label: 'Printers', icon: 'Printer', route: '/pos/printers', module: 'pos_setup' },
      { label: 'Printing', icon: 'ReceiptText', route: '/pos/printing', module: 'pos_setup' },
      { label: 'Card machines', icon: 'CreditCard', route: '/pos/cards', module: 'pos_setup' },
      { label: 'Device updates', icon: 'RefreshCw', route: '/pos/updates', module: 'pos_setup' },
      { label: 'Order types', icon: 'ListOrdered', route: '/pos/types', module: 'pos_setup' },
      { label: 'Discounts', icon: 'BadgePercent', route: '/pos/discounts', module: 'pos_setup' },
      { label: 'Revenue streams', icon: 'Waypoints', route: '/pos/streams', module: 'pos_setup' },
      { label: 'Courses', icon: 'UtensilsCrossed', route: '/pos/courses', module: 'pos_setup' },
      { label: 'Staff and PINs', icon: 'KeyRound', route: '/pos/staff', module: 'pos_setup' },
      { label: 'Till roles', icon: 'ShieldCheck', route: '/pos/roles', module: 'pos_setup' },
      { label: 'Receipts and payments', icon: 'Receipt', route: '/pos/receipts', module: 'pos_setup' },
      { label: 'Cash Recon link', icon: 'ArrowRightLeft', route: '/pos/recon', module: 'pos_setup' },
    ],
  },
  {
    label: 'Admin', children: [
      { label: 'Team', icon: 'Users', route: '/team', module: 'team' },
      { label: 'Access', icon: 'Shield', route: '/access', module: 'team' },
      { label: 'Settings', icon: 'SlidersHorizontal', route: '/settings', module: 'settings' },
      { label: 'Navigation', icon: 'Compass', route: '/nav-designer', module: 'nav_designer' },
      { label: 'Widget test', icon: 'LayoutTemplate', route: '/widget-test', module: 'widget_test' },
      { label: 'Test data', icon: 'FlaskConical', route: '/test-data', module: 'test_data' },
      { label: 'Legacy import', icon: 'FileSpreadsheet', route: '/legacy-import', module: 'test_data' },
    ],
  },
  {
    label: 'Help', children: [
      { label: 'Help', icon: 'HelpCircle', route: '/help', module: 'documentation' },
      { label: 'Documentation', icon: 'BookMarked', route: '/docs', module: 'documentation' },
      { label: "What's new", icon: 'Newspaper', route: '/changelog', module: 'changelog' },
      { label: 'Issues', icon: 'AlertCircle', route: '/issues', module: 'issue_log' },
      { label: 'Feature requests', icon: 'Lightbulb', route: '/feature-requests', module: 'feature_requests' },
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
