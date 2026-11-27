// shared/nav/stock.js: the Stock area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/stock', label: 'Stock', icon: 'Boxes', module: 'stock',
    section: 'Stock', order: 25, catalogOrder: 166,
    keywords: 'stock stocktake stock take count counts counting on hand stock level storage areas walk-in key items adjustment shrinkage ledger history waste wastage spoilage thrown away binned waste reasons transfer transfers send stock receive stock in transit lost in transit usage usage from sales sales taken off theoretical usage sold recompute variance actual usage stock period close period food cost percent actual food cost theoretical food cost unexplained loss explain variance',
    description: 'Stock on hand at each venue with sales taken off, usage from sales by day and item, stock counts by storage area with their approval, waste and its reasons, transfers between venues (in transit, received, lost), adjustments, variance by period (actual usage against theoretical, food cost actual and theoretical, what each item lost unexplained), and each item\'s history.',
    accepts: ['venue', 'tab'], tabs: ['on-hand', 'usage', 'variance', 'counts', 'waste', 'transfers', 'adjustments', 'settings'],
  },
]
