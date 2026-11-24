// shared/registry/local-info.js: the Local info area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'local.items', label: 'Local event', plural: 'Local news and events', words: ['event', 'incident', 'traffic', 'roadworks'],
    table: 'local_info_items', subjects: ['local.items'],
    page: '/local-info',
    actions: ['add_local_event', 'delete_local_info'],
  },
  {
    key: 'local.captures', label: 'Local info capture', plural: 'Local info captures', words: ['capture', 'forecast search'],
    table: 'local_info_sources', subjects: ['local.captures'],
    page: '/local-info',
    actions: ['run_local_capture'],
  },
]

export const notObjects = {
  'The weather read for each venue: a record kept for reports, never changed by hand.': ['local.weather', 'local.weather_hours'],
}
