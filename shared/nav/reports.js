// shared/nav/reports.js: the Reports area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/reports', label: 'Reports', icon: 'FileBarChart', module: 'reports',
    section: 'Home', order: 50, catalogOrder: 50,
    keywords: 'reports report figures numbers analysis sales by day dish server payments discounts voids vat bookings covers no-shows online orders export csv excel spreadsheet download starter past runs history kept files email emailed schedules scheduled send daily weekly monthly',
    description: 'Reports on every part of the business: open a starter or build your own, ask Pepper for one, read it as a table or chart, download or keep it as CSV or Excel, email it now or on a schedule, and see past runs.',
  },
]
