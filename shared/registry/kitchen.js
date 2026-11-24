// shared/registry/kitchen.js: the Kitchen area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'kitchen.tickets', label: 'Kitchen ticket', plural: 'Kitchen tickets', words: ['ticket', 'kds', 'remake', 'ticket time'],
    table: 'kds_log', subjects: ['kitchen.tickets', 'kitchen.remakes', 'kitchen.orders', 'kitchen.taps'],
    page: '/pos/kitchen',
  },
  {
    key: 'kitchen.stations', label: 'Kitchen station', plural: 'Kitchen stations', words: ['station', 'kitchen screen'],
    table: 'kds_stations', subjects: ['kitchen.stations'],
    page: '/pos/kitchen',
  },
]
