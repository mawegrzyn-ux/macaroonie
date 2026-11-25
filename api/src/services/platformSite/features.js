// src/services/platformSite/features.js
//
// The feature tour of the platform site: six groups, each a tile on the home
// page and a page of its own at /features/<slug>.
//
//   slug, title, line   the address, the name and what it does in one line
//   points              three to five benefits, in plain words
//   parts               the pieces inside the group, each opened in place on
//                       the group's page: { id, name, text }
//   shot                the screenshot (a key of SHOTS in screenshots.js)
//   arch                the part of the architecture picture it sits in (an
//                       id in architecture.js), for "How it fits"
//
// Describe what is built, plainly. Never name a real business or person.

export const FEATURE_GROUPS = [
  { slug: 'guests', title: 'Guests', line: 'Bookings, your website, online ordering and loyalty.', points: [], parts: [], shot: 'timeline', arch: 'api' },
  { slug: 'service', title: 'Service', line: 'The till, kitchen screens, kiosks and menu screens.', points: [], parts: [], shot: 'till', arch: 'hub' },
  { slug: 'menus', title: 'Menus', line: 'One menu for every till, screen and page.', points: [], parts: [], shot: 'kiosk', arch: 'database' },
  { slug: 'back-office', title: 'Back office', line: 'Cash, rotas, purchasing, food safety and reports.', points: [], parts: [], shot: 'report', arch: 'api' },
  { slug: 'pepper', title: 'Pepper', line: 'The assistant that does the busywork.', points: [], parts: [], shot: 'office-home', arch: 'pepper' },
  { slug: 'one-platform', title: 'One platform', line: 'Many venues and franchisees, each in its own space.', points: [], parts: [], shot: 'access', arch: 'database' },
]
