// shared/navSearch.js — the menu search's one set of rules (8 Nov 2026).
//
// The admin's sidebar has a search box: the person types a page's name or
// what they want to do ("change staff pay", "fridge temperatures") and the
// menu narrows to the links that fit. The matching lives here so the admin
// (AppShell's NavSearch) and the tests share one implementation, and
// NAV_KEYWORDS and NAV_DESCRIPTIONS are checked against the API's
// ROUTE_CATALOG by api/test/nav-default.test.mjs, so a new page can't ship
// without search words and a description, and a renamed route can't leave
// stale ones behind.
//
// How a query matches a link:
//   - the query is split into words, common filler words dropped
//     (searchTerms(); if every word is filler, the words themselves are
//     used, so "whats new" still finds What's new);
//   - every term must prefix-match a word somewhere in the link's own
//     label, its page's keywords here or its route, its description, or an
//     ancestor's label (so "health" lists everything under Health & safety);
//   - matches rank by where the terms hit (SEARCH_WEIGHTS): the link's own
//     name first, then its keywords, then its description, then its
//     ancestors.
//
// Descriptions (12 Nov 2026): every menu entry has a very brief description
// (DESCRIPTION_MAX characters at most). A group can write its own in the
// Navigation designer (nav_items.description); one left empty uses the
// page's standard one here (navDescription()). A section's description is
// shown, never searched through its links: a word in "Store tech"'s
// description would otherwise match every page under it.

/** The longest a menu entry's description may be. */
export const DESCRIPTION_MAX = 260

// What people might type to reach each page, beyond its menu label.
// Lowercase words; keep them nouns and doing-words, not sentences.
export const NAV_KEYWORDS = {
  '/today':                 'today ops tasks due now to do day plan checks morning front door',
  '/local-info':            'local info information weather forecast traffic roadworks road closures events incidents news area calendar what is on happening nearby',
  '/':                      'overview home start tiles stats summary dashboard',
  '/dashboards':            'dashboards custom blank widgets build your own',
  '/timeline':              'timeline gantt day view tables drag reservations bookings seat move',
  '/bookings':              'bookings reservations list guests covers arrivals seated status walk in party no show',
  '/customers':             'customers guests crm database contact details gdpr export anonymise newsletter marketing',
  '/loyalty':               'loyalty points stamps stamp cards rewards members wallet programme redeem',
  '/orders':                'online orders web ordering board collection takeaway preparing ready refund pause sold out transactions',
  '/orders/settings':       'ordering setup online ordering settings collection slots hours payment methods stripe tips minimum order',
  '/promotions':            'promotions offers deals promo codes vouchers meal deal spend discount online',
  '/purchasing':            'purchasing stock ordering suppliers purchase orders deliveries receive book in goods order form approve',
  '/purchasing/lists':      'order lists pars par levels purchasing setup stock lists',
  '/inventory':             'inventory items products catalogue stock supplier prices quotes packs codes price update',
  '/suppliers':             'suppliers vendors delivery days cutoff lead time notice account numbers contacts',
  '/pos/tills':             'tills till epos devices link pair code order numbers receipt choice',
  '/pos/layouts':           'till layouts screen designer zones buttons categories grid pop ups order screen phone tablet',
  '/pos/floor':             'floor plan designer table map areas sections rooms till',
  '/pos/kiosks':            'kiosks self order self service devices link pair code',
  '/pos/kiosk-designs':     'kiosk designer designs self order look colours start screen layout choices languages preview share theme',
  '/pos/kitchen':           'kitchen screens kds stations bump expo prep pass splitter sleeper live view ticket colours test',
  '/pos/kitchen-flow':      'kitchen flow designer flows routing stations links boxes kds where dishes go splitter sleeper setter',
  '/pos/hub':               'venue hub mini pc offline printing hub first install computer',
  '/pos/printers':          'printers network usb receipt printer kitchen tickets print again',
  '/pos/printing':          'printing what prints where which design receipts bills kitchen tickets',
  '/pos/print-designs':     'print designer receipt ticket designs kitchen tickets bills layout paper words',
  '/pos/cards':             'card machines readers terminals dojo stripe sumup contactless payments',
  '/pos/types':             'order types eat in take out takeaway delivery collection',
  '/pos/discounts':         'discounts presets percent amount money off manager approval till',
  '/pos/charges':           'charges service charge cup deposit bag fee charge matrix',
  '/pos/flows':             'order flows designer prompts suggest dishes upsell add automatically bag charge ask',
  '/pos/streams':           'revenue streams channels centres recognising sales',
  '/pos/courses':           'courses starters mains desserts hold fire order',
  '/pos/staff':             'staff pins till sign in codes who can',
  '/pos/roles':             'till roles permissions switches manager supervisor approvals voids refunds',
  '/pos/receipts':          'receipts payments tenders cash drawer receipt prompts covers guests asking',
  '/pos/updates':           'device updates pull times how often devices check refresh content',
  '/pos/recon':             'cash recon link till z report fills mapping takings',
  '/pos/reports':           'till reports sales z x checks history cancelled kitchen report day',
  '/pos/kiosk-analytics':   'kiosk analytics journeys visits replay funnel behaviour watch',
  '/cash-recon':            'cash reconciliation daily takings income variance expenses petty cash wages declare submit banking count',
  '/cash-dashboard':        'cash dashboard widgets week balance import loyverse gloriafood fill',
  '/staff':                 'staff people employees pay wages rates paid by bank cash leaving dates',
  '/staff/roles':           'staff roles job titles tip points multiplier chef server',
  '/rota':                  'rota shifts week schedule staffing hours who is working holiday sick time off pay wages tips print',
  '/rota/setup':            'rota setup shifts day parts hourly slots tip pots points rounding',
  '/rota-dashboard':        'rota dashboard widgets whos on today pay tips grid',
  '/food-safety':           'food safety temperatures fridge freezer checks deliveries hold cooking logs corrective actions haccp sfbb',
  '/checklists':            'checklists opening closing cleaning tasks tick off daily weekly monthly due audits',
  '/hs-dashboard':          'health safety dashboard hs widgets temperature checks compliance',
  '/hs-action-log':         'action log health safety repairs maintenance records training facilities to do',
  '/brand':                 'brand theme colours fonts logo identity look palette tagline theme maker',
  '/website':               'website site settings pages publish staging domain seo banner header footer gallery opening hours',
  '/website/builder':       'page builder website designer pages blocks home page location pages modals pop ups layout',
  '/website/reservations-widget':   'reservations booking widget designer look colours fonts calendar embed confirmation',
  '/menus':                 'menus dishes prices sections categories options photos edit publish meal deals',
  '/menus/times':           'menu times schedules lunch dinner breakfast when menus show channels kiosks tills',
  '/menus/print-designs':   'menu print designer printed menu designs layout paper a4 pages pdf',
  '/menus/variant-groups':  'variant groups options choices modifiers extras sizes flavours toppings',
  '/menus/dietary-tags':    'allergens allergy allergies dietary tags vegan vegetarian gluten dairy nuts notice',
  '/menus/allergens':       'allergen allergy matrix allergies contains may contain free from dishes grid publish',
  '/menus/tax':             'tax rates vat exceptions order types percentages',
  '/menus/deliveroo':       'deliveroo menu file csv export delivery prices matching',
  '/menus/translations':    'menu translations languages kiosks spanish french german ai draft',
  '/screens':               'menu screens digital signage displays tv order ready link pair code',
  '/screens/boards':        'screen designer boards menu board digital signage design blocks order ready tiles video',
  '/screens/playlists':     'screen playlists boards rotation times of day transitions schedule',
  '/screens/walls':         'screen walls video wall grid side by side',
  '/media':                 'media library pictures photos images videos uploads files folders',
  '/reviews':               'reviews google tripadvisor ratings feedback stars approve record check inbox website',
  '/venues':                'venues locations restaurants sites addresses time zones currency',
  '/new-location':          'new venue location restaurant opening wizard store setup pepper',
  '/tables':                'tables combinations seats capacity sections disallowed pairs reorder',
  '/schedule':              'schedule sittings sessions opening times slots caps exceptions booking hours doors',
  '/rules':                 'booking rules deposits party size cutoff holds widget hours allocation statuses',
  '/email-templates':       'emails templates confirmation reminder cancellation sender provider smtp sendgrid settings booking',
  '/email-monitoring':      'email monitor sendgrid bounces blocks spam suppressions delivery log sent',
  '/team':                  'team users invite deactivate passwords logins people access',
  '/access':                'access permissions roles modules levels view use manage switch off',
  '/settings':              'settings theme colour timeline appearance preferences status colours',
  '/ai':                    'pepper ai assistant chat connect tokens activity usage mcp claude',
  '/widget-test':           'widget test booking widget try reservations preview',
  '/test-data':             'test data dummy bookings generate clear qa pretend',
  '/legacy-import':         'legacy import spreadsheet workbook cafe manager old data',
  '/nav-designer':          'navigation menu designer sidebar launcher links sections descriptions customise rearrange',
  '/issues':                'issues problems incidents tickets support bugs priority log',
  '/feature-requests':      'feature requests ideas wishlist upvote suggestions asks',
  '/changelog':             'whats new changelog release notes updates shipped',
  '/docs':                  'documentation technical docs developer architecture reference',
  '/help':                  'help guide how to user manual instructions',
}

// Each page in a sentence: what it is for. Shown under the page's name in
// the search results and the Navigation designer, and searched (below the
// name and the keywords). DESCRIPTION_MAX characters at most; the nav test
// checks every catalogue page has one.
export const NAV_DESCRIPTIONS = {
  '/today':                 'What needs doing at a venue today: checks due, checklists, orders to send, deliveries, the cash-up and online orders, each one tap away.',
  '/local-info':            'Weather, traffic, events and incidents around each venue on a calendar, with events you add yourself and captures that run by themselves.',
  '/':                      'The home page: tiles you arrange with today\'s bookings, your venues, shortcuts and health and safety status.',
  '/dashboards':            'Dashboards you build yourself from any widget: cash, rota, health and safety and more on one page.',
  '/ai':                    'Chat with Pepper, the assistant: ask about bookings, the rota, cash, menus and more, connect other AI apps and see what Pepper did.',
  '/timeline':              'The day\'s bookings as bars on the tables through time: drag to move or resize, seat walk-ins and spot clashes.',
  '/bookings':              'Every booking of a day in a list by time: change its status, guest details, table and notes, or add a booking.',
  '/customers':             'Guests who booked or ordered: contact details, visit history, newsletter consent, data export and erasure.',
  '/loyalty':               'The loyalty programme: points, stamp cards, rewards, members and wallet cards.',
  '/orders':                'Online orders as they come in: accept, prepare, mark ready, refund, pause ordering, mark dishes sold out and see every transaction.',
  '/pos/reports':           'Sales from the tills: the day\'s figures, checks and their history, cancelled orders, charges and the kitchen report.',
  '/pos/kiosk-analytics':   'How guests use the kiosks: where they give up, time on each screen, popular dishes, and a replay of each visit.',
  '/cash-recon':            'The daily cash-up: income, takings, expenses and wages for each day and week, with the variance.',
  '/cash-dashboard':        'Cash dashboards built from widgets: day and week balances, wages paid, petty cash, tips to pay out and imports.',
  '/food-safety':           'Food safety records: fridge and freezer temperatures, deliveries, hot and cold holding and cooking checks, with corrective actions.',
  '/checklists':            'Opening, closing, cleaning and audit checklists: tick off what is due today and set up the lists.',
  '/hs-dashboard':          'Health and safety dashboards: a day\'s checklists and temperature checks on one page, ready to fill in.',
  '/hs-action-log':         'A to-do list of repairs, records, training and cleaning at each venue, with who it is for and when it is due.',
  '/purchasing':            'Order stock from suppliers: fill in an order list, send purchase orders and book deliveries in against them.',
  '/purchasing/lists':      'The lists staff order from: which items are on each list and the usual amount (par) at each venue.',
  '/inventory':             'Everything you buy: items, the packs and prices each supplier sells them at, supplier codes and price updates.',
  '/suppliers':             'Suppliers and how they deliver: contacts, how orders are sent, cut-off times, delivery days and each venue\'s account.',
  '/staff':                 'The people who work at each venue: pay, how they are paid, roles, leaving dates and time off the rota.',
  '/staff/roles':           'Job roles shared by every venue, and how many tip points each one earns.',
  '/rota':                  'The weekly rota for a venue: who works which shift, time off, hours, pay and tips.',
  '/rota/setup':            'How the rota works: shifts or hourly slots, tip pots and how tips are shared and rounded.',
  '/rota-dashboard':        'Rota dashboards built from widgets: who is on today, the week\'s rota, pay and tips.',
  '/menus':                 'Menus, sections and dishes: prices, photos, options, allergens and meal deals, saved as a draft and published when ready.',
  '/menus/times':           'When each menu is on: its days and times, and whether the website, kiosks and tills show it.',
  '/menus/print-designs':   'Design printed menus: place sections, dishes, pictures and notes on the page by hand, with several designs for each menu.',
  '/menus/variant-groups':  'Reusable sets of options for dishes, such as sizes, flavours and extras, with their prices and how kiosks show them.',
  '/menus/dietary-tags':    'The allergen and dietary tags dishes can carry, their order and icons, and the allergen notice shown to guests.',
  '/menus/allergens':       'A grid of every dish against every allergen: set what a dish contains, may contain or can leave out, then publish.',
  '/menus/tax':             'Tax (VAT) rates and which one applies by menu, section, dish, order type and location.',
  '/menus/translations':    'Menu words in other languages for the kiosks, with a first draft from Pepper.',
  '/menus/deliveroo':       'Fill Deliveroo\'s menu file from your menus: prices, VAT, descriptions and allergens.',
  '/promotions':            'Offers for online ordering and the till: money off, free dishes, meal deals and promo codes, and when they run.',
  '/brand':                 'Your brand: name, logo, colours and fonts, with a theme maker. Used by the website, kiosks, menu screens and printed menus.',
  '/website':               'The website\'s settings: header, footer, domain, SEO, opening hours, gallery, banner and publishing.',
  '/website/builder':       'Build website pages from blocks: the home page, extra pages and pop-ups, and each location\'s page.',
  '/website/reservations-widget':   'Design the booking widget on your website: colours, fonts, the calendar, its words and the confirmation page.',
  '/media':                 'The media library: pictures, videos and files for the website, menus, kiosks and screens, in folders.',
  '/reviews':               'Customer reviews from Google and other sites: check new ones and choose which show on the website.',
  '/email-templates':       'The emails guests get about bookings: the wording and look of each one, the sender, reminders, and what was sent.',
  '/email-monitoring':      'Whether emails arrive: sent, bounced and blocked addresses, with the log of what was sent.',
  '/venues':                'Your locations: name, address, time zone and currency.',
  '/new-location':          'Set up a new venue step by step: details, brand, menu, opening hours, tables and the rest, with Pepper\'s help if you like.',
  '/schedule':              'When each venue takes bookings: sittings for each day, slot limits, one-off days and seasonal changes.',
  '/tables':                'Tables and sections at each venue, which tables can be joined, and their order on the timeline.',
  '/rules':                 'Booking rules for a venue: party sizes, how far ahead guests can book, holds, deposits and which statuses are used.',
  '/orders/settings':       'Online ordering for each venue: collection times, lead time, payment methods, tips and the minimum order.',
  '/pos/tills':             'The tills at a venue: link a till by its code, name it, and choose its revenue stream, layout and printers.',
  '/pos/layouts':           'Design the till\'s order screen: zones for the order, categories, dishes and buttons, for tablets and phones.',
  '/pos/floor':             'Draw each venue\'s floor plan for the tills: rooms and where the tables sit.',
  '/pos/kiosks':            'Self-order kiosks at a venue: link a kiosk by its code and choose its design, revenue stream and card machine.',
  '/pos/kiosk-designs':     'Design how the self-order kiosks look and work: colours, start screen, menu layout, choices, paying and the order done screen.',
  '/pos/kitchen':           'Kitchen screens at a venue: stations, the screens, ticket colours, online orders, the live view and the test kitchen.',
  '/pos/kitchen-flow':      'Draw the way dishes travel through the kitchen: from orders in to prep stations, the pass, runners, printers and order ready boards.',
  '/screens':               'Menu screens and order ready boards at each venue: link a screen by its code and choose what it shows.',
  '/screens/boards':        'Design the boards that menu screens show: menus, prices, pictures, video and order numbers, placed by hand.',
  '/screens/playlists':     'Playlists of boards for menu screens: how long each board shows, the times of day and the transitions.',
  '/screens/walls':         'Several screens side by side as one wall: the grid, each screen\'s place and what the wall shows.',
  '/pos/hub':               'The venue hub: a small computer that keeps tills, kitchen screens and printers working when the internet is down.',
  '/pos/printers':          'Receipt and kitchen printers at a venue: network printers and ones plugged into a till or the hub.',
  '/pos/printing':          'Which design each kind of ticket prints with: kitchen tickets, till receipts and kiosk receipts, for the company and each venue.',
  '/pos/print-designs':     'Design printed kitchen tickets and receipts: their parts, the order they come in and the words, with a preview.',
  '/pos/cards':             'Card machines for tills and kiosks: accounts with Stripe, Dojo or SumUp, the machines and recent payments.',
  '/pos/updates':           'How often tills, kiosks, kitchen screens and menu screens check for new menus, prices and settings.',
  '/pos/types':             'Order types such as Eat in, Take out and Delivery, used by tills, kiosks and online ordering.',
  '/pos/discounts':         'The discounts staff can give on the till, and which of them need a manager.',
  '/pos/charges':           'Service charges and fees: the list, what each is charged on, and which order types and revenue streams get them.',
  '/pos/flows':             'Design order flows: prompts that suggest dishes, and dishes or charges added by themselves, on tills, kiosks and online.',
  '/pos/streams':           'Revenue streams: where sales are counted, the order types each one offers, and whether they ask for guests and use courses.',
  '/pos/courses':           'Courses such as starters, mains and desserts, used to hold dishes and fire them to the kitchen.',
  '/pos/staff':             'Who can sign in to the tills, their PINs and their till role.',
  '/pos/roles':             'Till roles and what each may do: discounts, voids, refunds and approvals.',
  '/pos/receipts':          'Till settings for receipts and payments: ways to pay, the receipt choice, the order prompt and what needs a manager.',
  '/pos/recon':             'Which Cash Recon fields the till\'s end of day fills in.',
  '/team':                  'People with a login: invite someone, set their role, reset a password or switch them off.',
  '/access':                'What each role can see and change, area by area, and which parts of the app are switched on.',
  '/settings':              'Your own settings: colours, the timeline view and booking status colours.',
  '/nav-designer':          'Arrange this menu: sections, links, names, descriptions and who sees what, or switch to quick-access tiles.',
  '/widget-test':           'Try the booking widget and send a test email without making a real booking.',
  '/test-data':             'Make pretend bookings and health and safety records for testing, and clear them again.',
  '/legacy-import':         'Bring in checklists and food safety records from the old spreadsheet.',
  '/help':                  'How to do things in the app, page by page.',
  '/docs':                  'Technical notes on how the app is built, for developers.',
  '/changelog':             'What has changed in the app lately.',
  '/issues':                'Report a problem and follow what happens to it.',
  '/feature-requests':      'Suggest something new and vote for other people\'s ideas.',
}

// The standard menu's sections, by their name. A renamed section has no
// standard description (the group can write one).
export const NAV_SECTION_DESCRIPTIONS = {
  'Home':            'Start here: today\'s jobs, local information, the overview and your dashboards.',
  'Service':         'Day-to-day service: bookings, customers, loyalty and online orders.',
  'Money':           'Sales reports and the daily cash-up.',
  'Health & safety': 'Food safety records, checklists and the action log.',
  'Stock':           'Ordering from suppliers, and what you buy.',
  'People':          'Staff, the rota, pay and tips.',
  'Menus':           'Menus, dishes, allergens, tax and promotions.',
  'Brand & web':     'Your brand, the website, media, reviews and emails.',
  'Venues':          'Your locations and how each one takes bookings and orders.',
  'Store tech':      'Tills, kiosks, kitchen screens, menu screens, printers and their designers.',
  'Admin':           'Logins, access, settings and this menu.',
  'Help':            'Guides, what is new and support.',
}

// Platform-admin pages live outside ROUTE_CATALOG (they are never offered
// to the nav designer) but still want search words — the drift test allows
// exactly these beyond the catalogue.
export const EXTRA_SEARCH_ROUTES = ['/platform', '/backlog']
NAV_KEYWORDS['/platform'] = 'platform tenants groups stripe keys ai usage limits android app interest admin'
NAV_KEYWORDS['/backlog'] = 'backlog kanban dev board epics stories bugs'
NAV_DESCRIPTIONS['/platform'] = 'For platform admins: restaurant groups, Stripe keys, Pepper usage and the Android app.'
NAV_DESCRIPTIONS['/backlog'] = 'For platform admins: the development board.'

/**
 * A menu entry's description: the one written for it (nav_items.description),
 * else the standard one for its page, or for a section of the standard menu
 * by its name. '' when there is none.
 */
export function navDescription(node) {
  const own = String(node?.description || '').trim()
  if (own) return own.slice(0, DESCRIPTION_MAX)
  if (node?.route) return NAV_DESCRIPTIONS[node.route] || ''
  return NAV_SECTION_DESCRIPTIONS[String(node?.label || '').trim()] || ''
}

/**
 * The links that only count as "the page you are on" at their exact address:
 * those whose address another link's begins with (/website beside
 * /website/builder, /screens beside /screens/boards), and the home page.
 * Without it both links would light up on the longer address. Every other
 * link keeps prefix matching, so a page opened from it (a designer at
 * /pos/layouts/<id>) keeps its menu link lit.
 */
export function exactRoutes(tree) {
  const routes = []
  const walk = list => {
    for (const n of list || []) {
      if (n.kind !== 'section' && n.route) routes.push(n.route)
      walk(n.children)
    }
  }
  walk(tree)
  const out = new Set()
  for (const r of routes) {
    if (r === '/' || routes.some(o => o !== r && o.startsWith(r + '/'))) out.add(r)
  }
  return out
}

// Filler words dropped from a query so "how do I change staff pay" searches
// as [staff, pay]. Doing-words that name no page (change, edit, find...)
// count as filler too — the nouns are what place a page.
export const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'change', 'do',
  'does', 'edit', 'find', 'for', 'from', 'get', 'go', 'how', 'i', 'in',
  'is', 'it', 'make', 'my', 'need', 'of', 'on', 'open', 'or', 'our',
  'page', 'see', 'set', 'show', 'that', 'the', 'their', 'them', 'this',
  'to', 'up', 'update', 'view', 'want', 'we', 'what', 'where', 'which',
  'who', 'with', 'you',
])

// Lowercase words of a label, query or route; apostrophes removed first so
// "What's new" and a typed "whats" meet.
export function searchWords(s) {
  return String(s || '').toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean)
}

// The query's terms: its words minus the filler, or all of them when
// nothing else is left. [] = not searching (empty or separators only).
export function searchTerms(q) {
  const all = searchWords(q)
  const kept = all.filter(w => !STOP_WORDS.has(w))
  return kept.length ? kept : all
}

/**
 * A word's simple forms: itself, and itself without a plural ending
 * (designers -> designer, dishes -> dish, allergies -> allergy), so a
 * plural typed finds the singular in a name, and the other way round. A
 * form is never shorter than three letters, and a word ending in "ss"
 * keeps its s.
 */
export function wordForms(w) {
  const out = [w]
  const n = w.length
  if (n > 3 && w.endsWith('s') && !w.endsWith('ss')) out.push(w.slice(0, -1))
  if (n > 4 && w.endsWith('es')) out.push(w.slice(0, -2))
  if (n > 4 && w.endsWith('ies')) out.push(w.slice(0, -3) + 'y')
  return out
}

// How a term hits a list of words: 2 = a word starts with it (as typed),
// 1 = a word is the same word in another form (wordForms()), 0 = no hit.
// "times" is the same word as "time", never the start of "timeline".
function hitKind(term, list) {
  if (!list?.length) return 0
  if (list.some(w => w.startsWith(term))) return 2
  const forms = wordForms(term)
  return list.some(w => wordForms(w).some(f => forms.includes(f))) ? 1 : 0
}

// What a term is worth by where it hits: the link's own name counts most,
// then its keywords (and its route's own words), then its description, then
// an ancestor's name.
export const SEARCH_WEIGHTS = { label: 4, keywords: 3, description: 2, path: 1 }

// A hit by another form of the word (hitKind() 1) is worth this much less
// than the word as typed, so "menus" puts Menus before Menu times, and a
// form in a name (3.5) still beats the word itself in the search words (3).
export const FORM_PENALTY = 0.5

/**
 * How a link matches the terms: every term must hit somewhere, else null.
 * { score, labelHits } - the score sums each term's weight; labelHits (how
 * many terms are in the link's own name) breaks ties.
 */
export function matchLink(terms, { labelWords, keywordWords, descriptionWords, pathWords }) {
  const places = [
    [labelWords, SEARCH_WEIGHTS.label],
    [keywordWords, SEARCH_WEIGHTS.keywords],
    [descriptionWords, SEARCH_WEIGHTS.description],
    [pathWords, SEARCH_WEIGHTS.path],
  ]
  let score = 0
  let labelHits = 0
  for (const t of terms) {
    let found = false
    for (let i = 0; i < places.length && !found; i++) {
      const kind = hitKind(t, places[i][0])
      if (!kind) continue
      score += places[i][1] - (kind === 1 ? FORM_PENALTY : 0)
      if (i === 0) labelHits++
      found = true
    }
    if (!found) return null
  }
  return { score, labelHits }
}

/** matchLink()'s score, 0 = no match. */
export function scoreLink(terms, parts) {
  return matchLink(terms, parts)?.score || 0
}

// Where a link sits, in words: its ancestors' names joined, a name said once
// when a section and the link under it share it ("Menus · Menus" -> "Menus").
export function placeText(path) {
  const out = []
  for (const name of path || []) {
    const last = out[out.length - 1]
    if (!name || (last && last.toLowerCase() === String(name).toLowerCase())) continue
    out.push(name)
  }
  return out.join(' · ')
}

// Search a nav tree (the shape /api/me's nav_tree has: { kind, label,
// route, icon, description, children }). Returns matched links best first
// ({ key, label, route, icon, path, description, score }), or null when the
// query isn't a search. A link that is in the menu twice is listed each
// time, with the path saying where.
export function searchNavTree(nodes, query) {
  const terms = searchTerms(query)
  if (!terms.length) return null
  const out = []
  const walk = (list, path, pathWords) => {
    for (const n of list || []) {
      const label = n.label || ''
      const labelWords = searchWords(label)
      if (n.kind !== 'section' && n.route) {
        const description = navDescription(n)
        const keywordWords = searchWords(NAV_KEYWORDS[n.route] || '').concat(searchWords(n.route))
        const hit = matchLink(terms, { labelWords, keywordWords, descriptionWords: searchWords(description), pathWords })
        if (hit) {
          out.push({
            key: (n.id || n.route) + '@' + path.join('/'),
            label, route: n.route, icon: n.icon,
            path: placeText(path),
            description,
            score: hit.score,
            labelHits: hit.labelHits,
          })
        }
      }
      if (n.children?.length) walk(n.children, [...path, label], [...pathWords, ...labelWords])
    }
  }
  walk(nodes, [], [])
  out.sort((a, b) => b.score - a.score || b.labelHits - a.labelHits || a.label.localeCompare(b.label))
  return out
}
