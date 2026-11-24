// shared/nav/cash.js: the Cash Recon area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/cash-recon', label: 'Cash recon', icon: 'Wallet', module: 'cash_recon',
    section: 'Money', order: 30, catalogOrder: 440,
    accepts: ['venue', 'date', 'week', 'tab'], tabs: ['week', 'wages'],
    keywords: 'cash reconciliation cash up cashing up daily takings income variance expenses petty cash wages declare submit banking count',
    description: 'The daily cash-up: income, takings, expenses and wages for each day and week, with the variance.',
  },
  {
    path: '/integrations', label: 'Integrations', icon: 'Plug', module: 'cash_recon',
    section: 'Money', order: 35, catalogOrder: 445,
    keywords: 'integrations loyverse square simphony other till pos connection sync sales import receipts webhook history api token',
    description: 'Other tills whose sales Macaroonie keeps: each connection, its venues, the last sync and the history import.',
  },
]
