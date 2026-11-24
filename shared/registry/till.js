// shared/registry/till.js: the Till area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'till.checks', label: 'Check', plural: 'Checks', words: ['bill', 'till sale', 'void', 'discount', 'payment'],
    table: 'pos_checks',
    subjects: ['till.checks', 'till.lines', 'till.voids', 'till.cancelled', 'till.payments', 'till.discounts', 'till.charges',
      'till.vat', 'till.card_payments', 'till.receipts', 'till.activity', 'till.refusals'],
    page: '/pos/reports',
  },
  {
    key: 'till.days', label: 'Trading day', plural: 'Trading days', words: ['z read', 'end of day', 'till day'],
    table: 'pos_days', subjects: ['till.days'],
    page: '/pos/recon',
  },
  {
    key: 'till.devices', label: 'Device', plural: 'Devices', words: ['till', 'card machine', 'tablet'],
    table: 'pos_devices', subjects: ['till.devices', 'till.card_readers'],
    page: '/pos/tills',
  },
]

export const notObjects = {
  'How the till is set up and grouped (staff on the till, revenue streams, order types, courses, roles, floor areas): names sales are grouped by.':
    ['till.takers', 'till.streams', 'till.order_types', 'till.courses', 'till.roles', 'till.floor_areas'],
  'Taps on the till\'s buttons: a record of how a layout is used, not something to change.': ['till.taps'],
}
