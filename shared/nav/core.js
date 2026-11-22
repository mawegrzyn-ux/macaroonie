// shared/nav/core.js: the Core area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/venues', label: 'Venues', icon: 'Building2', module: 'venues',
    section: 'Venues', order: 10, catalogOrder: 740,
    keywords: 'venues locations restaurants sites addresses time zones currency',
    description: 'Your locations: name, address, time zone and currency.',
  },
  {
    path: '/team', label: 'Team', icon: 'Users', module: 'team',
    section: 'Admin', order: 10, catalogOrder: 810,
    keywords: 'team users invite deactivate passwords logins people access',
    description: 'People with a login: invite someone, set their role, reset a password or switch them off.',
  },
  {
    path: '/access', label: 'Access', icon: 'Shield', module: 'team',
    section: 'Admin', order: 20, catalogOrder: 820,
    keywords: 'access permissions roles modules levels view use manage switch off',
    description: 'What each role can see and change, area by area, and which parts of the app are switched on.',
  },
  {
    path: '/issues', label: 'Issues', icon: 'AlertCircle', module: 'issue_log',
    section: 'Help', order: 40, catalogOrder: 890,
    keywords: 'issues problems incidents tickets support bugs priority log',
    description: 'Report a problem and follow what happens to it.',
  },
  {
    path: '/feature-requests', label: 'Feature requests', icon: 'Lightbulb', module: 'feature_requests',
    section: 'Help', order: 50, catalogOrder: 900,
    keywords: 'feature requests ideas wishlist upvote suggestions asks',
    description: "Suggest something new and vote for other people's ideas.",
  },
  {
    path: '/changelog', label: "What's new", icon: 'Newspaper', module: 'changelog',
    section: 'Help', order: 30, catalogOrder: 910,
    keywords: 'whats new changelog release notes updates shipped',
    description: 'What has changed in the app lately.',
  },
  {
    path: '/platform', searchOnly: true,
    catalogOrder: 940,
    keywords: 'platform tenants groups stripe keys ai usage limits android app interest admin',
    description: 'For platform admins: restaurant groups, Stripe keys, Pepper usage and the Android app.',
  },
  {
    path: '/backlog', searchOnly: true,
    catalogOrder: 950,
    keywords: 'backlog kanban dev board epics stories bugs',
    description: 'For platform admins: the development board.',
  },
]
