// shared/nav/kiosk.js: the Kiosk area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.
//
// Store tech: one page per part (admin/src/pages/PosSetup.jsx TABS).

export const pages = [
  {
    path: '/pos/kiosks', label: 'Kiosks', icon: 'TabletSmartphone', module: 'pos_setup',
    section: 'Store tech', order: 50, catalogOrder: 220,
    keywords: 'kiosks self order self service devices link pair code',
    description: 'Self-order kiosks at a venue: link a kiosk by its code and choose its design, revenue stream and card machine.',
  },
  {
    path: '/pos/kiosk-designs', label: 'Kiosk designer', icon: 'Paintbrush', module: 'pos_setup',
    section: 'Store tech', order: 60, catalogOrder: 230,
    keywords: 'kiosk designer designs self order look colours start screen layout choices languages preview share theme',
    description: 'Design how the self-order kiosks look and work: colours, start screen, menu layout, choices, paying and the order done screen.',
  },
  {
    path: '/pos/kiosk-analytics', label: 'Kiosk analytics', icon: 'Activity', module: 'pos_reports',
    section: 'Money', order: 20, catalogOrder: 430,
    keywords: 'kiosk analytics journeys visits replay funnel behaviour watch',
    description: 'How guests use the kiosks: where they give up, time on each screen, popular dishes, and a replay of each visit.',
  },
]
