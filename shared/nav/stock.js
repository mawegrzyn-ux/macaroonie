// shared/nav/stock.js: the Stock area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/stock', label: 'Stock', icon: 'Boxes', module: 'stock',
    section: 'Stock', order: 25, catalogOrder: 166,
    keywords: 'stock stocktake stock take count counts counting on hand stock level storage areas walk-in key items adjustment shrinkage ledger history',
    description: 'Stock on hand at each venue, stock counts by storage area with their approval, adjustments, and each item\'s history.',
    accepts: ['venue', 'tab'], tabs: ['on-hand', 'counts', 'adjustments', 'settings'],
  },
]
