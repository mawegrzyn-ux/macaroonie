// shared/nav/kitchen.js: the Kitchen area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.
//
// Store tech: one page per part (admin/src/pages/PosSetup.jsx TABS).

export const pages = [
  {
    path: '/pos/kitchen', label: 'Kitchen screens', icon: 'CookingPot', module: 'pos_setup',
    section: 'Store tech', order: 70, catalogOrder: 240,
    keywords: 'kitchen screens kds stations bump expo prep pass splitter sleeper live view ticket colours test',
    description: 'Kitchen screens at a venue: stations, the screens, ticket colours, online orders, the live view and the test kitchen.',
  },
  {
    path: '/pos/kitchen-flow', label: 'Kitchen flow designer', icon: 'Route', module: 'pos_setup',
    section: 'Store tech', order: 80, catalogOrder: 250,
    keywords: 'kitchen flow designer flows routing stations links boxes kds where dishes go splitter sleeper setter',
    description: 'Draw the way dishes travel through the kitchen: from orders in to prep stations, the pass, runners, printers and order ready boards.',
  },
]
