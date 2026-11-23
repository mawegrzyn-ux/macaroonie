// shared/nav/shell.js: the Shell area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  // Home: for everyone signed in (its tasks follow each person's own access,
  // migration 227 for the Today link it replaced), migration 273.
  {
    path: '/', label: 'Home', icon: 'Home',
    section: 'Home', order: 10, catalogOrder: 10,
    keywords: 'home start today ops tasks due now to do day plan checks morning front door pins shortcuts week ahead',
    description: 'Where the day starts: search or ask Pepper, your pins, what needs doing at a venue today and the week ahead.',
  },
  {
    path: '/settings', label: 'Settings', icon: 'SlidersHorizontal', module: 'settings',
    section: 'Admin', order: 30, catalogOrder: 830,
    keywords: 'settings theme colour timeline appearance preferences status colours',
    description: 'Your own settings: colours, the timeline view and booking status colours.',
  },
  {
    path: '/nav-designer', label: 'Navigation', icon: 'Compass', module: 'nav_designer',
    section: 'Admin', order: 40, catalogOrder: 880,
    keywords: 'navigation menu designer sidebar links sections descriptions customise rearrange',
    description: 'Arrange this menu: sections, links, names, descriptions and who sees what.',
  },
  {
    path: '/docs', label: 'Documentation', icon: 'BookMarked', module: 'documentation',
    section: 'Help', order: 20, catalogOrder: 920,
    keywords: 'documentation technical docs developer architecture reference',
    description: 'Technical notes on how the app is built, for developers.',
  },
  {
    path: '/help', label: 'Help', icon: 'HelpCircle', module: 'documentation',
    section: 'Help', order: 10, catalogOrder: 930,
    keywords: 'help guide how to user manual instructions',
    description: 'How to do things in the app, page by page.',
  },
]
