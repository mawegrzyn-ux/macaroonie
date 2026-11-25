// src/services/platformSite/features.js
//
// The feature tour of the platform site: six groups, each a tile on the home
// page and /features, and a page of its own at /features/<slug>.
//
//   slug, title, line   the address, the name and what it does in one line
//   icon                the inside of a 24 x 24 line icon (SVG markup)
//   points              three to five benefits, in plain words
//   parts               the pieces inside the group, each opened in place on
//                       the group's page: { id, name, text }
//   shot                the screenshot (a key of SHOTS in screenshots.js)
//   arch, fits          the part of the architecture picture it sits in (an
//                       id in architecture.js) and one or two sentences on how
//
// Describe what is built, plainly, in British English. No real business or
// person, no superlatives.

export const FEATURE_GROUPS = [
  {
    slug: 'guests',
    title: 'Guests',
    line: 'Bookings, your website, online ordering and loyalty, all from the same menus and guest records.',
    icon: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M21 20a6 6 0 0 0-4-5.6"/>',
    points: [
      'A live timeline of every table, with walk-ins and bookings side by side.',
      'A booking widget for your website, with confirmations, reminders and deposits.',
      'A website for your brand with a page for each venue, built by dragging blocks.',
      'Collection orders from your own site, paid online, with no marketplace commission.',
      'Points, stamp cards and rewards that work at every venue, online and on the till.',
    ],
    parts: [
      { id: 'bookings', name: 'Bookings and the timeline', text: 'Every table on one timeline for the day, with bookings, walk-ins and table combinations. Booking rules set when guests can book and how tables are given out.' },
      { id: 'widget', name: 'The booking widget', text: 'Guests book on your website and get an email confirmation and a reminder. They can change or cancel from the link in the email, and a deposit can be taken when you ask for one.' },
      { id: 'website', name: 'Your website', text: 'A website for the brand at your own address, with a page for each venue: menus, opening times, a gallery and booking. Built with a page builder, published when you press Publish.' },
      { id: 'ordering', name: 'Online ordering', text: 'Guests order for collection from your own site and pay online or when they collect. Orders arrive on the online orders board and in the kitchen.' },
      { id: 'loyalty', name: 'Loyalty', text: 'Points, stamp cards and rewards, collected and spent on the tills, the kiosks and online ordering. Each guest has a card on your website that they can add to Apple Wallet or Google Wallet.' },
      { id: 'customers', name: 'Guest records', text: 'One record per guest across bookings and orders, with notes and their marketing consent. A guest\'s details can be erased on request.' },
    ],
    shot: 'timeline',
    arch: 'api',
    fits: 'Bookings, the website, online ordering and loyalty all run on the one API and read the same published menus and guest records as the till.',
  },
  {
    slug: 'service',
    title: 'Service',
    line: 'The till, kitchen screens, self-order kiosks and menu screens, working together at the venue.',
    icon: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    points: [
      'Table service and counter service on a tablet or PC, still taking orders when the internet drops.',
      'Kitchen screens for each station, with flows that move a dish from prep to the pass.',
      'Self-order kiosks in your own design, with allergens on every dish.',
      'Menu screens that change price when you publish a menu, and show what has sold out.',
      'Card machines linked to the till, and receipts printed or sent by email.',
    ],
    parts: [
      { id: 'till', name: 'The till', text: 'Tables, tabs and courses for table service; order numbers and pay first for the counter. It runs in Chrome or Edge on an Android or Windows tablet or PC, and each till numbers its own orders, so it carries on alone if it has to.' },
      { id: 'kitchen-screens', name: 'Kitchen screens and flows', text: 'Orders from the till, online ordering and the kiosks reach the kitchen as they are sent. A kitchen flow says how dishes move between stations, and you can keep several (a busy night, the grill down) and switch between them from a screen.' },
      { id: 'kiosks', name: 'Self-order kiosks', text: 'Guests pick dishes and their options, see the allergens, and send the order to the kitchen and the tills. The look and the steps come from a kiosk design you make in the kiosk designer.' },
      { id: 'menu-screens', name: 'Menu screens', text: 'Boards for the screens above the counter, playlists that take turns, and walls of several screens showing one picture. Prices come from the published menu.' },
      { id: 'printers', name: 'Printers and the venue hub', text: 'Kitchen and receipt printers on the venue network print through the venue hub, a small computer that also keeps the venue trading when the internet drops.' },
      { id: 'player', name: 'The Android app', text: 'Macaroonie Player runs a till, a kitchen screen, a kiosk or a menu screen full screen on an Android tablet, TV box or smart TV, so staff and guests can\'t leave it by accident.' },
    ],
    shot: 'till',
    arch: 'hub',
    fits: 'The till, kitchen screens and kiosks send every change as an event. At a venue with a hub they go to the hub first, so service carries on with the internet down.',
  },
  {
    slug: 'menus',
    title: 'Menus',
    line: 'One menu feeds the till, the kiosks, the screens, the website, online ordering and print.',
    icon: '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    points: [
      'Edit a draft, then publish it now or at a time you set; every device picks it up.',
      'Allergens and dietary tags kept with each dish and shown wherever it appears.',
      'Options, meal deals, menu times and tax rates set once.',
      'Printed menus laid out in a print designer, from the same dishes.',
    ],
    parts: [
      { id: 'publishing', name: 'Draft and publish', text: 'Changes stay in the draft until you publish. A release can go live now or at a set time, and the tills, kiosks, screens and website all move to it together.' },
      { id: 'allergens', name: 'Allergens and dietary tags', text: 'Each dish carries its allergens and tags, shown on the kiosk, the website, online ordering and the printed menu, and flagged to the kitchen on an order.' },
      { id: 'options', name: 'Options and meal deals', text: 'Choices such as sizes, sides and extras, and meal deals with their own price, work the same way on the till, the kiosk and online.' },
      { id: 'times-tax', name: 'Menu times and tax', text: 'A breakfast menu in the morning and a lunch menu at noon, with the right tax for eating in or taking away.' },
      { id: 'print', name: 'Printed menus', text: 'A print designer lays out menus for the table and the window from the same dishes, prices and allergens.' },
      { id: 'read-in', name: 'A menu from a photo', text: 'Pepper can read an existing menu from a photo or a PDF and set it up as a draft for you to check.' },
    ],
    shot: 'kiosk',
    arch: 'database',
    fits: 'The menu tables are the draft; a published release is a frozen copy that every guest and device reads, so what a guest sees is what the till charges.',
  },
  {
    slug: 'back-office',
    title: 'Back office',
    line: 'Cash-up, rotas, purchasing, food safety and reports, on a tablet or a phone.',
    icon: '<path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6"/>',
    points: [
      'A daily cash-up that shows straight away when a day doesn\'t balance.',
      'Weekly rotas, pay, and tip pots shared out by points.',
      'Supplier prices, order lists, purchase orders, deliveries and invoices.',
      'Fridge, hot-hold and cooking checks, checklists and an action log.',
      'Reports you build yourself, sent by email on a schedule.',
    ],
    parts: [
      { id: 'cash', name: 'Cash-up', text: 'Each day\'s takings, petty cash with receipt photos, wages and expenses, with takings from linked tills filled in for you and the variance worked out.' },
      { id: 'rota', name: 'Staff and rota', text: 'The rota for the week, sickness and holidays, pay with adjustments, and tip pots shared out by points.' },
      { id: 'purchasing', name: 'Purchasing', text: 'The items you buy and each supplier\'s price, order lists with pars, purchase orders sent to suppliers, deliveries booked in and stock counted.' },
      { id: 'hs', name: 'Food safety', text: 'Temperature checks, opening and closing checklists, and an action log for anything that needs fixing, with a picture of every venue.' },
      { id: 'reports', name: 'Reports and dashboards', text: 'Sales, covers, labour, bookings and more, built from a list of fields, with drill-downs to the rows behind each figure and schedules that email them.' },
      { id: 'phone', name: 'The phone app', text: 'Cash-up, wages, supplier orders, safety checks and Pepper from a manager\'s phone.' },
    ],
    shot: 'report',
    arch: 'record',
    fits: 'Reports read the same records the till writes, so the cash-up and the sales report always agree.',
  },
  {
    slug: 'pepper',
    title: 'Pepper',
    line: 'Ask in your own words: Pepper finds the answer or does the job, within what your role allows.',
    icon: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9 11h.01M12 11h.01M15 11h.01"/>',
    points: [
      'Questions about any part of the business: tonight\'s bookings, who\'s on, yesterday\'s cash-up.',
      'Jobs done for you, shown on a card that changes nothing until you press Confirm.',
      'Reads supplier invoices, receipts and menus from a photo or a PDF.',
      'Only ever sees and does what the person asking may.',
    ],
    parts: [
      { id: 'ask', name: 'Ask Pepper', text: 'An ask bar at the top of the office and in the phone app. Ask about bookings, the rota, health and safety, cash, orders, menus or reports, and get the answer with a link to the page.' },
      { id: 'confirm', name: 'Jobs, confirmed first', text: 'A booking, a rota change, a supplier order or a price change: Pepper shows what it will do on a card, and nothing changes until you press Confirm.' },
      { id: 'readers', name: 'Reading paperwork', text: 'A photo of an invoice, a delivery note or a till receipt is read into the right place for you to check.' },
      { id: 'own-ai', name: 'Your own AI apps', text: 'A connector lets AI apps such as Claude work with Macaroonie, with each person\'s own permissions.' },
      { id: 'new-location', name: 'Opening a venue', text: 'Describe a new venue and Pepper asks the questions that are left, then sets the venue up from the plan once you agree it.' },
    ],
    shot: 'office-home',
    arch: 'pepper',
    fits: 'Pepper works through the same API as the person using it, with their permissions, and every change it makes goes through the same checks as a tap on the screen.',
  },
  {
    slug: 'one-platform',
    title: 'One platform',
    line: 'Many venues and franchisees on one system, each business in its own space.',
    icon: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z"/><path d="M9 12l2 2 4-4"/>',
    points: [
      'Each franchisee has its own space, its data walled off from every other.',
      'Roles that say who can view, use or manage each part.',
      'One brand, many venues: local hours, menus and bookings for each.',
      'Sales from other tills brought in, so reports cover every venue while you move across.',
    ],
    parts: [
      { id: 'spaces', name: 'A space for each business', text: 'Every business (a franchisee, or a group of your own) signs in to its own space. Its venues, staff, guests and figures are kept apart by the database itself.' },
      { id: 'roles', name: 'Roles and permissions', text: 'Owners, managers and staff see only what they need. Each part of the app can be off, view only, use or manage for each role, and you can make your own roles.' },
      { id: 'venues', name: 'Many venues', text: 'One brand and one menu across venues, with each venue\'s own hours, tables, prices and devices.' },
      { id: 'imports', name: 'Other tills', text: 'Venues still on Loyverse or Square have their sales brought in receipt by receipt, so reports and the cash-up cover every venue.' },
      { id: 'sign-in', name: 'Invitation-only sign-in', text: 'Staff join by invitation, and someone who works for two businesses picks which one to open after signing in.' },
    ],
    shot: 'access',
    arch: 'database',
    fits: 'Every business shares one system and one database, and row-level security in the database keeps each one\'s rows to itself.',
  },
]
