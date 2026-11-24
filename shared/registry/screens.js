// shared/registry/screens.js: the Menu screens area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'screens.screens', label: 'Menu screen', plural: 'Menu screens', words: ['screen', 'board', 'playlist', 'wall', 'display'],
    table: 'screens', subjects: ['screens.screens', 'screens.boards', 'screens.playlists', 'screens.walls'],
    page: '/screens',
    actions: ['reload_screen'],
  },
]
