// shared/nav/purchasing.js: the Purchasing area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/purchasing', label: 'Purchasing', icon: 'ShoppingCart', module: 'purchasing',
    section: 'Stock', order: 10, catalogOrder: 140,
    keywords: 'purchasing stock ordering suppliers purchase orders deliveries receive book in goods order form approve returns return to supplier credit note credit notes refund from supplier',
    description: 'Order stock from suppliers: fill in an order list, send purchase orders, book deliveries in against them, and return goods with their credit notes.',
    // Inventory phase 9b: the Returns tab (?tab=returns), beside Order and Deliveries.
    accepts: ['tab'], tabs: ['order', 'deliveries', 'returns'],
  },
  {
    path: '/purchasing/lists', label: 'Order lists', icon: 'ClipboardList', module: 'purchasing_setup',
    section: 'Stock', parent: '/purchasing', order: 10, catalogOrder: 150,
    keywords: 'order lists pars par levels purchasing setup stock lists',
    description: 'The lists staff order from: which items are on each list and the usual amount (par) at each venue.',
  },
  {
    path: '/inventory', label: 'Inventory', icon: 'Package', module: 'purchasing_setup',
    section: 'Stock', parent: '/purchasing', order: 20, catalogOrder: 160,
    keywords: 'inventory items products catalogue stock supplier prices quotes packs codes price update',
    description: 'Everything you buy: items, the packs and prices each supplier sells them at, supplier codes and price updates.',
  },
  {
    path: '/suppliers', label: 'Suppliers', icon: 'Truck', module: 'purchasing_setup',
    section: 'Stock', parent: '/purchasing', order: 30, catalogOrder: 170,
    keywords: 'suppliers vendors delivery days cutoff lead time notice account numbers contacts',
    description: "Suppliers and how they deliver: contacts, how orders are sent, cut-off times, delivery days and each venue's account.",
  },
]
