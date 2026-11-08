// shared/navSearch.js — the menu search's one set of rules (8 Nov 2026).
//
// The admin's sidebar has a search box: the person types a page's name or
// what they want to do ("change staff pay", "fridge temperatures") and the
// menu narrows to the links that fit. The matching lives here so the admin
// (AppShell's NavSearch) and the tests share one implementation, and
// NAV_KEYWORDS is checked against the API's ROUTE_CATALOG by
// api/test/nav-default.test.mjs, so a new page can't ship without search
// words and a renamed route can't leave stale ones behind.
//
// How a query matches a link:
//   - the query is split into words, common filler words dropped
//     (searchTerms(); if every word is filler, the words themselves are
//     used, so "whats new" still finds What's new);
//   - every term must prefix-match a word somewhere in the link's own
//     label, its route, its page's keywords here, or an ancestor's label
//     (so "health" lists everything under Health & safety);
//   - matches rank by where the terms hit: the link's own label first,
//     then its keywords, then its ancestors.

// What people might type to reach each page, beyond its menu label.
// Lowercase words; keep them nouns and doing-words, not sentences.
export const NAV_KEYWORDS = {
  '/today':                 'today ops tasks due now to do day plan checks morning front door',
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
  '/pos/layouts':           'till layouts screen designer zones buttons categories grid pop ups order screen',
  '/pos/floor':             'floor plan table map areas sections till',
  '/pos/kiosks':            'kiosks self order self service kiosk designs designer',
  '/pos/kitchen':           'kitchen screens kds flows stations bump expo prep pass splitter sleeper live view ticket colours',
  '/pos/hub':               'venue hub mini pc offline printing hub first install computer',
  '/pos/printers':          'printers network usb receipt printer kitchen tickets print again',
  '/pos/printing':          'printing print designs receipts bills kitchen tickets paper layouts',
  '/pos/cards':             'card machines readers terminals dojo stripe sumup contactless payments',
  '/pos/types':             'order types eat in take out takeaway delivery collection',
  '/pos/discounts':         'discounts presets percent amount money off manager approval till',
  '/pos/charges':           'charges service charge cup deposit bag fee charge matrix',
  '/pos/flows':             'order flows prompts suggest dishes upsell add automatically bag charge ask',
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
  '/brand':                 'brand theme colours fonts logo identity look palette tagline',
  '/website':               'website site builder pages blocks publish staging domain seo banner header footer gallery',
  '/menus':                 'menus dishes prices sections categories options photos edit publish print designs',
  '/menus/times':           'menu times schedules lunch dinner breakfast when menus show channels kiosks tills',
  '/menus/variant-groups':  'variant groups options choices modifiers extras sizes flavours toppings',
  '/menus/dietary-tags':    'allergens allergy allergies dietary tags vegan vegetarian gluten dairy nuts notice',
  '/menus/allergens':       'allergen allergy matrix allergies contains may contain free from dishes grid publish',
  '/menus/tax':             'tax rates vat exceptions order types percentages',
  '/menus/deliveroo':       'deliveroo menu file csv export delivery prices matching',
  '/menus/translations':    'menu translations languages kiosks spanish french german ai draft',
  '/screens':               'menu screens boards digital signage displays tv playlists walls order ready',
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
  '/nav-designer':          'navigation menu designer sidebar launcher links sections customise rearrange',
  '/issues':                'issues problems incidents tickets support bugs priority log',
  '/feature-requests':      'feature requests ideas wishlist upvote suggestions asks',
  '/changelog':             'whats new changelog release notes updates shipped',
  '/docs':                  'documentation technical docs developer architecture reference',
  '/help':                  'help guide how to user manual instructions',
}

// Platform-admin pages live outside ROUTE_CATALOG (they are never offered
// to the nav designer) but still want search words — the drift test allows
// exactly these beyond the catalogue.
export const EXTRA_SEARCH_ROUTES = ['/platform', '/backlog']
NAV_KEYWORDS['/platform'] = 'platform tenants groups stripe keys ai usage limits android app interest admin'
NAV_KEYWORDS['/backlog'] = 'backlog kanban dev board epics stories bugs'

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

const hits = (term, list) => list.some(w => w.startsWith(term))

// Every term must hit somewhere; the score says where (own label 3,
// keywords or the route's own words 2, an ancestor's label 1), summed over
// the terms, 0 = no match.
export function scoreLink(terms, { labelWords, keywordWords, pathWords }) {
  let score = 0
  for (const t of terms) {
    if (hits(t, labelWords)) score += 3
    else if (hits(t, keywordWords)) score += 2
    else if (hits(t, pathWords || [])) score += 1
    else return 0
  }
  return score
}

// Search a nav tree (the shape /api/me's nav_tree has: { kind, label,
// route, icon, children }). Returns matched links best first
// ({ key, label, route, icon, path }), or null when the query isn't a
// search. A link that is in the menu twice is listed each time, with the
// path saying where.
export function searchNavTree(nodes, query) {
  const terms = searchTerms(query)
  if (!terms.length) return null
  const out = []
  const walk = (list, path, pathWords) => {
    for (const n of list || []) {
      const label = n.label || ''
      const labelWords = searchWords(label)
      if (n.kind !== 'section' && n.route) {
        const keywordWords = searchWords(NAV_KEYWORDS[n.route] || '').concat(searchWords(n.route))
        const score = scoreLink(terms, { labelWords, keywordWords, pathWords })
        if (score) {
          out.push({
            key: (n.id || n.route) + '@' + path.join('/'),
            label, route: n.route, icon: n.icon,
            path: path.join(' · '),
            score,
          })
        }
      }
      if (n.children?.length) walk(n.children, [...path, label], [...pathWords, ...labelWords])
    }
  }
  walk(nodes, [], [])
  out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
  return out
}
