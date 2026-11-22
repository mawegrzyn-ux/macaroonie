// shared/nav/bookings.js: the Bookings area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/timeline', label: 'Timeline', icon: 'CalendarDays', module: 'bookings',
    section: 'Service', order: 10, catalogOrder: 60,
    accepts: ['venue', 'date'],
    keywords: 'timeline gantt day view tables drag reservations bookings seat move today floor',
    description: "The day's bookings as bars on the tables through time: drag to move or resize, seat walk-ins and spot clashes.",
  },
  {
    path: '/bookings', label: 'Bookings', icon: 'BookOpen', module: 'bookings',
    section: 'Service', order: 20, catalogOrder: 70,
    accepts: ['venue', 'date'],
    keywords: 'bookings reservations list guests covers arrivals seated status walk in party no show',
    description: 'Every booking of a day in a list by time: change its status, guest details, table and notes, or add a booking.',
  },
  {
    path: '/customers', label: 'Customers', icon: 'UserRound', module: 'customers',
    section: 'Service', order: 30, catalogOrder: 80,
    keywords: 'customers guests crm database contact details gdpr export anonymise newsletter marketing',
    description: 'Guests who booked or ordered: contact details, visit history, newsletter consent, data export and erasure.',
  },
  {
    path: '/tables', label: 'Tables', icon: 'Table2', module: 'tables',
    section: 'Venues', order: 30, catalogOrder: 760,
    keywords: 'tables combinations seats capacity sections disallowed pairs reorder',
    description: 'Tables and sections at each venue, which tables can be joined, and their order on the timeline.',
  },
  {
    path: '/schedule', label: 'Schedule', icon: 'Clock', module: 'schedule',
    section: 'Venues', order: 20, catalogOrder: 770,
    keywords: 'schedule sittings sessions opening times slots caps exceptions booking hours doors closures christmas',
    description: 'When each venue takes bookings: sittings for each day, slot limits, one-off days and seasonal changes.',
  },
  {
    path: '/rules', label: 'Booking rules', icon: 'Settings', module: 'rules',
    section: 'Venues', order: 40, catalogOrder: 780,
    keywords: 'booking rules deposits party size cutoff cut off holds widget hours allocation statuses',
    description: 'Booking rules for a venue: party sizes, how far ahead guests can book, holds, deposits and which statuses are used.',
  },
  {
    path: '/email-templates', label: 'Emails', icon: 'Mail', module: 'email_templates',
    section: 'Brand & web', order: 70, catalogOrder: 790,
    keywords: 'emails templates confirmation reminder cancellation sender provider smtp sendgrid settings booking',
    description: 'The emails guests get about bookings: the wording and look of each one, the sender, reminders, and what was sent.',
  },
  {
    path: '/email-monitoring', label: 'Email monitor', menuLabel: 'Monitor', icon: 'Activity', module: 'email_templates',
    section: 'Brand & web', parent: '/email-templates', order: 10, catalogOrder: 800,
    keywords: 'email monitor sendgrid bounces blocks spam suppressions delivery log sent',
    description: 'Whether emails arrive: sent, bounced and blocked addresses, with the log of what was sent.',
  },
  {
    path: '/widget-test', label: 'Widget test', icon: 'LayoutTemplate', module: 'widget_test',
    section: 'Admin', order: 50, catalogOrder: 850,
    keywords: 'widget test booking widget try reservations preview',
    description: 'Try the booking widget and send a test email without making a real booking.',
  },
  {
    path: '/test-data', label: 'Test data', icon: 'FlaskConical', module: 'test_data',
    section: 'Admin', order: 60, catalogOrder: 860,
    keywords: 'test data dummy bookings generate clear qa pretend',
    description: 'Make pretend bookings and health and safety records for testing, and clear them again.',
  },
]
