// shared/nav/ordering.js: the Online ordering area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/orders', label: 'Online orders', icon: 'ShoppingBag', module: 'web_orders',
    section: 'Service', order: 50, catalogOrder: 100,
    accepts: ['venue', 'date', 'tab'], tabs: ['board', 'report', 'transactions'],
    keywords: 'online orders web ordering board collection takeaway preparing ready refund pause sold out transactions',
    description: 'Online orders as they come in: accept, prepare, mark ready, refund, pause ordering, mark dishes sold out and see every transaction.',
  },
  {
    path: '/orders/settings', label: 'Ordering setup', icon: 'Settings2', module: 'web_ordering_setup',
    section: 'Venues', order: 50, catalogOrder: 120,
    keywords: 'ordering setup online ordering settings collection slots hours payment methods stripe tips minimum order',
    description: 'Online ordering for each venue: collection times, lead time, payment methods, tips and the minimum order.',
  },
  {
    path: '/promotions', label: 'Promotions', icon: 'BadgePercent', module: 'promotions',
    section: 'Menus', order: 20, catalogOrder: 130,
    keywords: 'promotions offers deals promo codes vouchers meal deal spend discount online',
    description: 'Offers for online ordering and the till: money off, free dishes, meal deals and promo codes, and when they run.',
  },
]
