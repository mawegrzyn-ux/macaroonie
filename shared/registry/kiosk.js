// shared/registry/kiosk.js: the Kiosk area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'kiosks.visits', label: 'Kiosk visit', plural: 'Kiosk visits', words: ['kiosk session', 'kiosk order'],
    table: 'kiosk_sessions', subjects: ['kiosks.visits'],
    page: '/pos/kiosk-analytics',
  },
  {
    key: 'kiosks.designs', label: 'Kiosk design', plural: 'Kiosk designs', words: ['kiosk look'],
    table: 'kiosk_designs', subjects: ['kiosks.designs'],
    page: '/pos/kiosk-designs',
  },
]
