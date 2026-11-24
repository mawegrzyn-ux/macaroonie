// shared/registry/bookings.js: the Bookings area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'bookings.bookings', label: 'Booking', plural: 'Bookings', words: ['reservation', 'table booking'],
    table: 'bookings', subjects: ['bookings.bookings', 'bookings.deposits', 'bookings.emails'],
    page: '/bookings', open: { page: '/timeline', with: ['venue', 'date'] },
    actions: ['create_booking', 'change_booking', 'set_booking_status', 'update_guest_details', 'add_booking_note'],
    forms: ['booking', 'booking_change'],
  },
  {
    key: 'guests.customers', label: 'Customer', plural: 'Customers', words: ['guest', 'diner'],
    table: 'customers', subjects: ['guests.customers'],
    page: '/customers',
    actions: ['update_customer', 'unsubscribe_customer', 'anonymise_customer'],
  },
  {
    key: 'bookings.closures', label: 'Closure', plural: 'Closures',
    words: ['closed day', 'close dates', 'schedule exception', 'private event', 'holiday closure'],
    table: 'schedule_exceptions',
    page: '/schedule',
    actions: ['close_dates', 'remove_closure'],
    forms: ['closure'],
  },
  {
    key: 'bookings.tables', label: 'Table', plural: 'Tables', words: ['table combination', 'table section'],
    table: 'tables', subjects: ['bookings.tables', 'bookings.combinations', 'bookings.sections'],
    page: '/tables',
  },
  {
    key: 'bookings.rules', label: 'Booking rules', plural: 'Booking rules', words: ['booking settings', 'party size', 'booking window'],
    table: 'booking_rules',
    page: '/rules',
    actions: ['update_booking_rules'],
  },
]
