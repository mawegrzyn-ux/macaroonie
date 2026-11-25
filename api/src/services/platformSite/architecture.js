// src/services/platformSite/architecture.js
//
// The architecture picture on /architecture: layers of parts, each part a
// button that opens its detail. Ids are the anchors (/architecture#hub opens
// the hub) and what features.js points at with `arch`.
//
//   layer: id, name, note (one line under the name), row (layers with the
//          same row sit side by side on a wide screen), link (what passes
//          between this row and the one above, shown on the connector)
//   part:  id, name, icon (inside of a 24 x 24 line icon), text (two or
//          three plain sentences), why (one line)
//
// Checked against the code and docs/POS.md (hub-first trading, the
// sequencer), CLAUDE.md (row-level security forced, one deploy) and
// docs/PEPPER_FIRST.md. Describe what is built; no internal host names.

export const ARCH_LAYERS = [
  {
    id: 'venue', name: 'At the venue', note: 'Tablets, screens and printers you can buy anywhere', row: 1,
    parts: [
      {
        id: 'tills', name: 'Tills',
        icon: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
        text: 'The till runs in Chrome or Edge on an Android or Windows tablet or PC, or full screen in the Macaroonie Player app. Each till numbers its own orders, so two tills never hand out the same number, even with no connection at all.',
        why: 'A dropped line never stops service: the till keeps taking orders and payments and catches up afterwards.',
      },
      {
        id: 'kitchen-screens', name: 'Kitchen screens',
        icon: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M6 7h4M6 11h4M14 7h4M14 11h4M8 21h8"/>',
        text: 'A screen for each station shows what to cook. Cooks tap a dish done and the pass marks the order ready. A kitchen flow says which station sees which dish, and in what order.',
        why: 'Every station sees the same order at the same moment, with nothing to read off a paper ticket.',
      },
      {
        id: 'kiosks', name: 'Kiosks',
        icon: '<rect x="6" y="2" width="12" height="16" rx="2"/><path d="M9 22h6M12 18v4M9 6h6M9 10h6"/>',
        text: 'Touch screens guests order on by themselves, from the same published menu as the till, with the allergens on every dish. Their orders go to the kitchen and the tills like any counter order.',
        why: 'Shorter queues, without a second menu to keep up to date.',
      },
      {
        id: 'menu-screens', name: 'Menu screens',
        icon: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M7 21h10M6 8h5M6 12h8M15 8h3"/>',
        text: 'TVs and screens showing menu boards, playlists and order ready boards. Prices come from the published menu, and a dish marked sold out shows as sold out within seconds.',
        why: 'Change a price once and every board follows.',
      },
      {
        id: 'printers', name: 'Printers',
        icon: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>',
        text: 'Receipt and kitchen printers on the venue network print through the venue hub. A printer plugged into a till or a kitchen screen prints from that device.',
        why: 'Tickets keep printing in the kitchen whatever the internet is doing.',
      },
      {
        id: 'phones', name: 'Phones',
        icon: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
        text: 'Managers use the phone app for the cash-up, wages, supplier orders, safety checks and Pepper. Guests use their own phones to book, order and keep their loyalty card.',
        why: 'The back office goes where the manager goes.',
      },
    ],
  },
  {
    id: 'hub', name: 'The venue hub', note: 'A small computer on the venue network (optional)', row: 2,
    link: 'On the venue network: orders, kitchen taps and print jobs',
    parts: [
      {
        id: 'hub', name: 'Venue hub',
        icon: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M7 14h.01M11 10h6M11 14h6"/>',
        text: 'Tills, kiosks and kitchen screens send their changes to the hub first. It decides them with the same rules as the cloud, tells the other devices, prints the tickets and keeps the venue trading if the internet drops. When the line is back it sends everything up, and the cloud confirms it. Without a hub, the devices talk to the cloud directly.',
        why: 'Service carries on at the speed of the venue network, internet or not, and money is never merged quietly: anything that no longer fits goes to a manager.',
      },
    ],
  },
  {
    id: 'cloud', name: 'The cloud', note: 'One system for every venue and every business', row: 3,
    link: 'Over the internet, with live updates both ways',
    parts: [
      {
        id: 'api', name: 'One API',
        icon: '<path d="M4 7h16M4 12h16M4 17h10"/><circle cx="19" cy="17" r="2"/>',
        text: 'The office, the phone app, the tills, the kiosks, the screens, guests\' booking and ordering pages, and Pepper all use the same API. A rule such as a price, a tax or a meal deal is written once and shared by the cloud, the hub and the devices.',
        why: 'The till, the kiosk and the website always work a price out the same way.',
      },
      {
        id: 'database', name: 'Each business walled off',
        icon: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
        text: 'Each business, such as a franchisee, has its own space in one database. Row-level security is switched on and enforced on every table that holds a business\'s data, so a request only ever sees that business\'s rows.',
        why: 'Franchisees on one system never see each other\'s figures, because the database itself won\'t show them.',
      },
      {
        id: 'record', name: 'One record of every order',
        icon: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
        text: 'Every change to an order (a dish added, a payment, a refund) is an event. One sequencer puts each venue\'s events in order and checks each one against the rules; orders, payments and reports are worked out from them.',
        why: 'Nothing is lost or counted twice, and every figure traces back to what happened.',
      },
      {
        id: 'live', name: 'Live updates',
        icon: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
        text: 'Open tills, kitchen screens, menu screens and office pages hold a live connection, so a change reaches them within a second or two rather than at their next check.',
        why: 'Sold out on the till is sold out on the kiosk and the menu screens moments later.',
      },
      {
        id: 'release', name: 'One version for everyone',
        icon: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
        text: 'Every venue and business runs the same version. A change is tested, then goes out to everyone at once, and the devices pick it up on their own.',
        why: 'No upgrades to book, and no venue left behind on an old version.',
      },
    ],
  },
  {
    id: 'pepper', name: 'Pepper', note: 'The assistant, inside the same rules', row: 4,
    link: 'Through the same API, with the same permissions',
    parts: [
      {
        id: 'pepper', name: 'Pepper',
        icon: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9 11h.01M12 11h.01M15 11h.01"/>',
        text: 'Pepper answers from the business\'s own data and does jobs through the same API as the person asking, with that person\'s permissions. It shows a card first, and nothing changes until they press Confirm.',
        why: 'An assistant that can\'t see or do more than the person using it.',
      },
      {
        id: 'connectors', name: 'Your own AI apps',
        icon: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5"/>',
        text: 'A connector lets AI apps such as Claude work with Macaroonie on a person\'s behalf, again with their own permissions.',
        why: 'Use the AI tools you already have, without opening a back door.',
      },
    ],
  },
  {
    id: 'outside', name: 'Outside services', note: 'Specialists for the jobs they do best', row: 4,
    parts: [
      {
        id: 'payments', name: 'Online payments',
        icon: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
        text: 'Online orders and booking deposits are paid through Stripe, into each business\'s own Stripe account.',
        why: 'Money goes straight to the business that earned it.',
      },
      {
        id: 'card-machines', name: 'Card machines',
        icon: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8v4H8zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
        text: 'Dojo, Stripe and SumUp card machines link to the till, so the amount is sent from the till and the payment comes back to it.',
        why: 'No typing amounts twice, and no mismatches at the cash-up.',
      },
      {
        id: 'sign-in', name: 'Sign-in',
        icon: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
        text: 'Staff sign in through Auth0, by invitation only, and then pick which business to open if they work for more than one.',
        why: 'No shared logins, and nobody gets in without an invitation.',
      },
      {
        id: 'email', name: 'Email',
        icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
        text: 'Booking confirmations, reminders, receipts and scheduled reports go out by email, and every send is logged.',
        why: 'You can see whether a guest\'s confirmation actually went.',
      },
      {
        id: 'other-tills', name: 'Other tills and partners',
        icon: '<path d="M7 17L17 7M7 7h10v10"/>',
        text: 'Sales from Loyverse and Square tills are brought in receipt by receipt. GloriaFood orders arrive in the kitchen like any other order, and menus fill in a Deliveroo menu file.',
        why: 'Move venues across at your own pace, with every venue in the reports from day one.',
      },
    ],
  },
]
