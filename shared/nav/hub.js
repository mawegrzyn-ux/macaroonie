// shared/nav/hub.js: the Venue hub area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.
//
// Store tech: one page per part (admin/src/pages/PosSetup.jsx TABS).

export const pages = [
  {
    path: '/pos/hub', label: 'Venue hub', icon: 'Server', module: 'pos_setup',
    section: 'Store tech', order: 130, catalogOrder: 260,
    keywords: 'venue hub mini pc offline printing hub first install computer',
    description: 'The venue hub: a small computer that keeps tills, kitchen screens and printers working when the internet is down.',
  },
  {
    path: '/pos/printers', label: 'Printers', icon: 'Printer', module: 'pos_setup',
    section: 'Store tech', order: 140, catalogOrder: 270,
    keywords: 'printers network usb receipt printer kitchen tickets print again',
    description: 'Receipt and kitchen printers at a venue: network printers and ones plugged into a till or the hub.',
  },
  {
    path: '/pos/printing', label: 'Printing', icon: 'ReceiptText', module: 'pos_setup',
    section: 'Store tech', order: 150, catalogOrder: 280,
    keywords: 'printing what prints where which design receipts bills kitchen tickets',
    description: 'Which design each kind of ticket prints with: kitchen tickets, till receipts and kiosk receipts, for the company and each venue.',
  },
  {
    path: '/pos/print-designs', label: 'Receipt & ticket designer', icon: 'ScrollText', module: 'pos_setup',
    section: 'Store tech', order: 160, catalogOrder: 290,
    keywords: 'print designer receipt ticket designs kitchen tickets bills layout paper words',
    description: 'Design printed kitchen tickets and receipts: their parts, the order they come in and the words, with a preview.',
  },
]
