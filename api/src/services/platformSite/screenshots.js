// src/services/platformSite/screenshots.js
//
// The platform site's screenshots, in api/platform-site/img/: each a WebP at
// two widths (<name>-800.webp, <name>-1600.webp) and a JPEG fallback
// (<name>-1200.jpg; also the Open Graph image), taken from a local copy filled
// with an invented group, Harbour & Co (docs/claude/areas/shell.md, "Retaking
// the screenshots").
//
//   name      the file name's start
//   w, h      the -1600 file's size (big: its width when it is narrower, as
//             for the upright kiosk), for the srcset and so the page doesn't jump
//   tall      an upright shot, shown no taller than the screen allows
//   title     its name on the Screenshots page
//   alt       what it shows, for people who can't see it
//   caption   one line under it

export const SHOTS = {
  till: {
    name: 'till', w: 1600, h: 1000, title: 'The till',
    alt: 'The till on a tablet: an open order with five dishes not yet sent and its total, beside the menu sections, the drinks and the payment buttons.',
    caption: 'Table service on a tablet: the order on the left, the menu on the right.',
  },
  kitchen: {
    name: 'kitchen', w: 1600, h: 900, title: 'Kitchen screen',
    alt: 'A kitchen screen showing four order tickets with their dishes, order numbers and how long each has been waiting.',
    caption: 'Orders from the till arrive as tickets; cooks tap dishes done.',
  },
  kiosk: {
    name: 'kiosk', w: 1080, h: 1920, big: 1080, tall: true, title: 'Self-order kiosk',
    alt: 'An upright kiosk screen showing the Mains section: dishes with descriptions and prices, and the basket at the bottom.',
    caption: 'Guests choose from the published menu, with allergens on every dish.',
  },
  'office-home': {
    name: 'office-home', w: 1600, h: 1000, title: 'The office Home page',
    alt: 'The office Home page: the group\'s sites, today\'s bookings and covers, and the bar to search or ask Pepper.',
    caption: 'Every site at a glance, and Pepper one question away.',
  },
  timeline: {
    name: 'timeline', w: 1600, h: 1000, title: 'Bookings timeline',
    alt: 'The bookings timeline: tables down the side, the day across the top and each booking as a bar with the guest\'s name and covers.',
    caption: 'Every table for the day, with bookings and walk-ins.',
  },
  report: {
    name: 'report', w: 1600, h: 1000, title: 'A report',
    alt: 'The Sales by day report: a bar chart of net sales for each day and the table of checks, guests, sales and VAT below it.',
    caption: 'Sales by day, with a chart and a row to open for each day.',
  },
  'kitchen-flow': {
    name: 'kitchen-flow', w: 1600, h: 1000, title: 'Kitchen flow designer',
    alt: 'The kitchen flow designer: boxes for orders in, a prep station, a ticket printer and timers, joined by arrows.',
    caption: 'How dishes move through the kitchen, drawn as boxes and arrows.',
  },
  'kiosk-designer': {
    name: 'kiosk-designer', w: 1600, h: 1000, title: 'Kiosk designer',
    alt: 'The kiosk designer: text sizes, layout and dish picture settings on the left and a live preview of the kiosk\'s start screen on the right.',
    caption: 'The look and the steps of a kiosk, with a live preview.',
  },
  access: {
    name: 'access', w: 1600, h: 1000, title: 'Roles and permissions',
    alt: 'The Access page\'s roles: the four built-in roles, owner, admin, operator and viewer, and a role the group made itself.',
    caption: 'Built-in roles and your own, each set to view, use or manage each part.',
  },
}

/** The order of the Screenshots page. */
export const GALLERY = ['till', 'kitchen', 'kiosk', 'timeline', 'office-home', 'report', 'kitchen-flow', 'kiosk-designer', 'access']
