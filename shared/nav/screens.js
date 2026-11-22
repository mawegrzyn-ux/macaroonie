// shared/nav/screens.js: the Menu screens area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/screens', label: 'Menu screens', icon: 'Monitor', module: 'screens',
    section: 'Store tech', order: 90, catalogOrder: 680,
    keywords: 'menu screens digital signage displays tv order ready link pair code',
    description: 'Menu screens and order ready boards at each venue: link a screen by its code and choose what it shows.',
  },
  {
    path: '/screens/boards', label: 'Screen board designer', icon: 'Presentation', module: 'screens',
    section: 'Store tech', order: 100, catalogOrder: 690,
    keywords: 'screen designer boards menu board digital signage design blocks order ready tiles video',
    description: 'Design the boards that menu screens show: menus, prices, pictures, video and order numbers, placed by hand.',
  },
  {
    path: '/screens/playlists', label: 'Screen playlists', icon: 'ListVideo', module: 'screens',
    section: 'Store tech', order: 110, catalogOrder: 700,
    keywords: 'screen playlists boards rotation times of day transitions schedule',
    description: 'Playlists of boards for menu screens: how long each board shows, the times of day and the transitions.',
  },
  {
    path: '/screens/walls', label: 'Screen walls', icon: 'Grid2x2', module: 'screens',
    section: 'Store tech', order: 120, catalogOrder: 710,
    keywords: 'screen walls video wall grid side by side',
    description: "Several screens side by side as one wall: the grid, each screen's place and what the wall shows.",
  },
]
