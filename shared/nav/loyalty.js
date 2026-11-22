// shared/nav/loyalty.js: the Loyalty area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/loyalty', label: 'Loyalty', icon: 'Gift', module: 'loyalty',
    section: 'Service', order: 40, catalogOrder: 90,
    keywords: 'loyalty points stamps stamp cards rewards members wallet programme redeem',
    description: 'The loyalty programme: points, stamp cards, rewards, members and wallet cards.',
  },
]
