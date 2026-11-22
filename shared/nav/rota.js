// shared/nav/rota.js: the Staff & rota area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/staff', label: 'Staff', icon: 'UsersRound', module: 'staff',
    section: 'People', order: 10, catalogOrder: 460,
    keywords: 'staff people employees pay wages rates paid by bank cash leaving dates',
    description: 'The people who work at each venue: pay, how they are paid, roles, leaving dates and time off the rota.',
  },
  {
    path: '/staff/roles', label: 'Roles', icon: 'BadgeCheck', module: 'staff',
    section: 'People', parent: '/staff', order: 10, catalogOrder: 470,
    keywords: 'staff roles job titles tip points multiplier chef server',
    description: 'Job roles shared by every venue, and how many tip points each one earns.',
  },
  {
    path: '/rota', label: 'Rota', icon: 'CalendarRange', module: 'rota',
    section: 'People', order: 20, catalogOrder: 480,
    keywords: 'rota shifts week schedule staffing hours who is working holiday sick time off pay wages tips print',
    description: 'The weekly rota for a venue: who works which shift, time off, hours, pay and tips.',
  },
  {
    path: '/rota/setup', label: 'Rota setup', icon: 'Settings2', module: 'staff',
    section: 'People', parent: '/rota', order: 10, catalogOrder: 490,
    keywords: 'rota setup shifts day parts hourly slots tip pots points rounding',
    description: 'How the rota works: shifts or hourly slots, tip pots and how tips are shared and rounded.',
  },
  {
    path: '/rota-dashboard', label: 'Rota dashboard', icon: 'LayoutGrid', module: 'rota_dashboard',
    section: 'People', order: 30, catalogOrder: 500,
    keywords: 'rota dashboard widgets whos on today pay tips grid',
    description: "Rota dashboards built from widgets: who is on today, the week's rota, pay and tips.",
  },
]
