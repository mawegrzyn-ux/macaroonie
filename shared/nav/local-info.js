// shared/nav/local-info.js: the Local info area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/local-info', label: 'Local info', icon: 'CloudSun', module: 'local_info',
    section: 'Home', order: 20, catalogOrder: 20,
    keywords: 'local info information weather forecast traffic roadworks road closures events incidents news area calendar what is on happening nearby',
    description: 'Weather, traffic, events and incidents around each venue on a calendar, with events you add yourself and captures that run by themselves.',
  },
]
