// shared/nav/dashboards.js: the Dashboards area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/overview', label: 'Overview', icon: 'LayoutDashboard', module: 'dashboard',
    section: 'Home', order: 30, catalogOrder: 30,
    keywords: 'overview tiles stats summary dashboard figures desk',
    description: "Tiles you arrange with today's bookings and figures, your venues, your pins and health and safety status.",
  },
  {
    path: '/dashboards', label: 'Dashboards', icon: 'LayoutTemplate', module: 'custom_dashboard',
    section: 'Home', order: 40, catalogOrder: 40,
    keywords: 'dashboards custom blank widgets build your own',
    description: 'Dashboards you build yourself from any widget: cash, rota, health and safety and more on one page.',
  },
  {
    path: '/cash-dashboard', label: 'Cash dashboard', icon: 'LayoutGrid', module: 'cash_dashboard',
    section: 'Money', order: 40, catalogOrder: 450,
    keywords: 'cash dashboard widgets week balance import loyverse gloriafood fill',
    description: 'Cash dashboards built from widgets: day and week balances, wages paid, petty cash, tips to pay out and imports.',
  },
  {
    path: '/hs-dashboard', label: 'H&S dashboard', icon: 'LayoutGrid', module: 'hs_dashboard',
    section: 'Health & safety', order: 30, catalogOrder: 530,
    keywords: 'health safety dashboard hs widgets temperature checks compliance',
    description: "Health and safety dashboards: a day's checklists and temperature checks on one page, ready to fill in.",
  },
]
