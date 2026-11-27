// src/services/platformSite/pages.js
//
// The pages of the platform's own public site on the apex (macaroonie.com):
// one record per page, read by the apex hook in routes/platformSite.js, the
// header's navigation and the sitemap. Adding a page is one record here and
// one view in views/platform/site/ (docs/claude/areas/shell.md, "The
// platform site").
//
//   path         the address on the apex (no trailing slash, except '/')
//   view         the Eta view under src/views
//   title        the <title> and the Open Graph title
//   description  the meta description
//   nav          the label in the header's navigation (none: not in it)
//   soon         true: a "coming next" placeholder, kept out of the sitemap
//                and marked noindex; the view is views/platform/site/soon.eta
//   shot         the screenshot used as the page's Open Graph image (a key of
//                SHOTS in screenshots.js)
//   css, script  a page's own stylesheet and module script (files in
//                api/platform-site/; the pages under /try)
//   short, open  a /try page's name on the Try it cards and its button
//   shared       the shared modules the script imports (sharedModules.js),
//                preloaded by the head
//   cta          the heading of the register-interest band at the foot;
//                false: no band (the legal pages)
//   foot         the label in the footer's legal links (LEGAL_LINKS): the
//                Terms and conditions and the Privacy policy, never in the
//                header's navigation
//   updated      the "Last updated" date a legal page shows

import { FEATURE_GROUPS } from './features.js'

const BASE = 'Macaroonie'

export const PAGES = [
  {
    path: '/', view: 'platform/landing.eta',
    title: 'Macaroonie: run every venue from one place',
    description: 'Bookings, the till, kitchen screens, kiosks and the back office in one platform for restaurant groups and franchises, with Pepper the assistant doing the busywork.',
    shot: 'office-home',
  },
  {
    path: '/features', view: 'platform/site/features.eta', nav: 'Features',
    title: 'Features: what Macaroonie does | ' + BASE,
    description: 'A tour of Macaroonie: guests, service, menus, the back office, Pepper the assistant and one platform for many venues.',
    shot: 'till',
  },
  ...FEATURE_GROUPS.map(g => ({
    path: '/features/' + g.slug, view: 'platform/site/feature.eta', group: g.slug,
    title: g.title + ' | ' + BASE,
    description: g.line,
    shot: g.shot,
  })),
  {
    path: '/architecture', view: 'platform/site/architecture.eta', nav: 'How it works',
    title: 'How it works: the architecture | ' + BASE,
    description: 'Devices at the venue, the venue hub that keeps trading when the internet drops, one cloud with each business walled off, and Pepper working within the same permissions.',
    shot: 'kitchen',
  },
  {
    path: '/screenshots', view: 'platform/site/screenshots.eta', nav: 'Screenshots',
    title: 'Screenshots | ' + BASE,
    description: 'The till, kitchen screens, kiosks, the bookings timeline, reports and the office, as they look today.',
    shot: 'timeline',
  },
  {
    path: '/try', view: 'platform/site/try.eta', nav: 'Try it',
    title: 'Try it | ' + BASE,
    description: 'Walk through a busy kitchen service, or design a kiosk with the real kiosk designer, in your browser.',
    shot: 'kitchen-flow',
  },
  {
    path: '/try/kitchen-flow', view: 'platform/site/try-kitchen-flow.eta',
    title: 'Kitchen walkthrough: a Friday night service | ' + BASE,
    short: 'Walk through a busy kitchen',
    open: 'Start the walkthrough',
    description: 'A guided walk through a busy Friday service: tables with courses, kiosk and online orders, shared grills, the pass and the packing check, on Macaroonie\'s own kitchen rules.',
    shot: 'kitchen',
    css: 'try-kitchen.css', script: 'try-kitchen.js',
    shared: ['pos/kitchenBench.js', 'pos/kitchenPrint.js', 'pos/ticketHtml.js', 'pos/kitchenTimers.js', 'pos/kitchenColours.js'],
    cta: 'Like what you see?',
  },
  {
    // The office's real kiosk designer with an invented menu (demoBuilds.js).
    path: '/try/kiosk', view: 'platform/site/try-kiosk.eta',
    title: 'Kiosk designer demo | ' + BASE,
    short: 'Design a kiosk',
    description: 'The real kiosk designer with a menu we made up: change the look and the pictures, and tap through the kiosk as a guest would.',
    shot: 'kiosk-designer',
    css: 'try.css',
    open: 'Open the designer',
    cta: 'Like what you see?',
  },
  {
    // The legal pages: linked from every page's footer, not the header.
    // Their words are in the views; the company details in company.js.
    path: '/terms', view: 'platform/site/terms.eta', foot: 'Terms and conditions',
    title: 'Terms and conditions | ' + BASE,
    description: 'The terms for using macaroonie.com and the Macaroonie platform, with the data processing schedule for business customers.',
    updated: '27 November 2026',
    cta: false,
  },
  {
    path: '/privacy', view: 'platform/site/privacy.eta', foot: 'Privacy policy',
    title: 'Privacy policy | ' + BASE,
    description: 'How Macaroonie uses personal data: visitors to this site, people who register interest, our customers and their staff, and guests of restaurants that use Macaroonie. Cookies included.',
    updated: '27 November 2026',
    cta: false,
  },
]

const BY_PATH = new Map(PAGES.map(p => [p.path, p]))

/** The page at this apex path ('/features/' and '/features' are the same), or null. */
export function sitePage(path) {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path
  return BY_PATH.get(clean) ?? null
}

/** The header's navigation: [{ path, label }] in page order. */
export const NAV = PAGES.filter(p => p.nav).map(p => ({ path: p.path, label: p.nav }))

/** The footer's legal links: the pages with a foot label, then the Privacy policy's cookies part. */
export const LEGAL_LINKS = PAGES.filter(p => p.foot).map(p => ({ path: p.path, label: p.foot }))
  .concat([{ path: '/privacy#cookies', label: 'Cookies' }])

/** The sandboxes under /try, for the Try it page. */
export const TRY_PAGES = PAGES.filter(p => p.path.startsWith('/try/'))

/** The sitemap: every page that isn't a placeholder. */
export function sitemapXml(origin) {
  const urls = PAGES.filter(p => !p.soon)
    .map(p => '  <url><loc>' + origin + (p.path === '/' ? '/' : p.path) + '</loc></url>')
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.join('\n') + '\n</urlset>\n'
}
