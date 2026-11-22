// shared/nav/till.js: the Till (Store tech) area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.
//
// Store tech: one page per part (admin/src/pages/PosSetup.jsx TABS).

export const pages = [
  {
    path: '/pos/board', label: 'Tech board', icon: 'Activity', module: 'pos_setup',
    section: 'Store tech', order: 10, catalogOrder: 180,
    keywords: 'tech board kit status online offline devices tills kitchen screens kiosks printers card machines menu screens hub health working down broken platform',
    description: "A venue's kit on one page: whether each till, kitchen screen, kiosk, printer, card machine, menu screen and the venue hub is working, the last thing it did, and whether Macaroonie itself is up.",
  },
  {
    path: '/pos/tills', label: 'Tills', icon: 'MonitorSmartphone', module: 'pos_setup',
    section: 'Store tech', order: 20, catalogOrder: 190,
    keywords: 'tills till epos devices link pair code order numbers receipt choice',
    description: 'The tills at a venue: link a till by its code, name it, and choose its revenue stream, layout and printers.',
  },
  {
    path: '/pos/layouts', label: 'Till layouts', icon: 'PanelsTopLeft', module: 'pos_setup',
    section: 'Store tech', order: 30, catalogOrder: 200,
    keywords: 'till layouts screen designer zones buttons categories grid pop ups order screen phone tablet',
    description: "Design the till's order screen: zones for the order, categories, dishes and buttons, for tablets and phones.",
  },
  {
    path: '/pos/floor', label: 'Floor plan', icon: 'LayoutPanelTop', module: 'pos_setup',
    section: 'Store tech', order: 40, catalogOrder: 210,
    keywords: 'floor plan designer table map areas sections rooms till',
    description: "Draw each venue's floor plan for the tills: rooms and where the tables sit.",
  },
  {
    path: '/pos/cards', label: 'Card machines', icon: 'CreditCard', module: 'pos_setup',
    section: 'Store tech', order: 170, catalogOrder: 300,
    keywords: 'card machines readers terminals dojo stripe sumup contactless payments',
    description: 'Card machines for tills and kiosks: accounts with Stripe, Dojo or SumUp, the machines and recent payments.',
  },
  {
    path: '/pos/types', label: 'Order types', icon: 'ListOrdered', module: 'pos_setup',
    section: 'Store tech', order: 190, catalogOrder: 310,
    keywords: 'order types eat in take out takeaway delivery collection',
    description: 'Order types such as Eat in, Take out and Delivery, used by tills, kiosks and online ordering.',
  },
  {
    path: '/pos/discounts', label: 'Discounts', icon: 'BadgePercent', module: 'pos_setup',
    section: 'Store tech', order: 200, catalogOrder: 320,
    keywords: 'discounts presets percent amount money off manager approval till',
    description: 'The discounts staff can give on the till, and which of them need a manager.',
  },
  {
    path: '/pos/charges', label: 'Charges', icon: 'HandCoins', module: 'pos_setup',
    section: 'Store tech', order: 210, catalogOrder: 330,
    keywords: 'charges service charge cup deposit bag fee charge matrix',
    description: 'Service charges and fees: the list, what each is charged on, and which order types and revenue streams get them.',
  },
  {
    path: '/pos/flows', label: 'Order flows', icon: 'Workflow', module: 'pos_setup',
    section: 'Store tech', order: 220, catalogOrder: 340,
    keywords: 'order flows designer prompts suggest dishes upsell add automatically bag charge ask',
    description: 'Design order flows: prompts that suggest dishes, and dishes or charges added by themselves, on tills, kiosks and online.',
  },
  {
    path: '/pos/streams', label: 'Revenue streams', icon: 'Waypoints', module: 'pos_setup',
    section: 'Store tech', order: 230, catalogOrder: 350,
    keywords: 'revenue streams channels centres recognising sales',
    description: 'Revenue streams: where sales are counted, the order types each one offers, and whether they ask for guests and use courses.',
  },
  {
    path: '/pos/courses', label: 'Courses', icon: 'UtensilsCrossed', module: 'pos_setup',
    section: 'Store tech', order: 240, catalogOrder: 360,
    keywords: 'courses starters mains desserts hold fire order',
    description: 'Courses such as starters, mains and desserts, used to hold dishes and fire them to the kitchen.',
  },
  {
    path: '/pos/staff', label: 'Staff and PINs', icon: 'KeyRound', module: 'pos_setup',
    section: 'Store tech', order: 250, catalogOrder: 370,
    keywords: 'staff pins till sign in codes who can',
    description: 'Who can sign in to the tills, their PINs and their till role.',
  },
  {
    path: '/pos/roles', label: 'Till roles', icon: 'ShieldCheck', module: 'pos_setup',
    section: 'Store tech', order: 260, catalogOrder: 380,
    keywords: 'till roles permissions switches manager supervisor approvals voids refunds',
    description: 'Till roles and what each may do: discounts, voids, refunds and approvals.',
  },
  {
    path: '/pos/receipts', label: 'Receipts and payments', icon: 'Receipt', module: 'pos_setup',
    section: 'Store tech', order: 270, catalogOrder: 390,
    keywords: 'receipts payments tenders cash drawer receipt prompts covers guests asking',
    description: 'Till settings for receipts and payments: ways to pay, the receipt choice, the order prompt and what needs a manager.',
  },
  {
    path: '/pos/updates', label: 'Device updates', icon: 'RefreshCw', module: 'pos_setup',
    section: 'Store tech', order: 180, catalogOrder: 400,
    keywords: 'device updates pull times how often devices check refresh content',
    description: 'How often tills, kiosks, kitchen screens and menu screens check for new menus, prices and settings.',
  },
  {
    path: '/pos/recon', label: 'Cash Recon link', icon: 'ArrowRightLeft', module: 'pos_setup',
    section: 'Store tech', order: 280, catalogOrder: 410,
    keywords: 'cash recon link till z report fills mapping takings',
    description: "Which Cash Recon fields the till's end of day fills in.",
  },
  {
    path: '/pos/reports', label: 'Till reports', icon: 'BarChart3', module: 'pos_reports',
    section: 'Money', order: 10, catalogOrder: 420,
    keywords: 'till reports sales z x checks history cancelled kitchen report day',
    description: "Sales from the tills: the day's figures, checks and their history, cancelled orders, charges and the kitchen report.",
  },
]
