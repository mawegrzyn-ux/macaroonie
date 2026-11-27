// shared/nav/index.js: the admin's pages for the menu, gathered from each
// area's file (docs/PARALLEL_WORK.md 3.6, 22 Nov 2026).
//
// Each area keeps its own pages in shared/nav/<area>.js (the area slugs of
// docs/claude/areas), so two features in different areas never edit the same
// list. This file builds the four lists every reader uses, in the shapes they
// had when they were written out by hand:
//   ROUTE_CATALOG     every page the Navigation designer may link to
//                     (re-exported by api/src/routes/nav.js)
//   DEFAULT_NAV_TREE  the standard menu (re-exported by api/src/config/defaultNav.js)
//   NAV_KEYWORDS, NAV_DESCRIPTIONS, EXTRA_SEARCH_ROUTES, NAV_SECTION_DESCRIPTIONS
//                     the menu search's words (re-exported by shared/navSearch.js)
//
// A page's record:
//   path          the page's address ('/rota'), also its key everywhere
//   label         its name in the page list (ROUTE_CATALOG)
//   menuLabel     its name in the standard menu, when shorter there (optional)
//   icon          a lucide icon name
//   module        the module that gates it (api/src/config/modules.js); left
//                 out = everyone signed in
//   section       the standard menu's section it sits in, by label (sections.js)
//   parent        the path of the link it sits under in that section (optional)
//   order         its place among its section's (or parent's) links, spaced by 10
//   catalogOrder  its place in ROUTE_CATALOG and the search words, spaced by 10
//   keywords      what people might type to reach it, beyond its name:
//                 lowercase nouns and doing-words, not sentences
//   description   the page in a sentence (DESCRIPTION_MAX characters at most,
//                 shared/navSearch.js): shown under its name in the search
//                 results and the Navigation designer, and searched
//   searchOnly    true for a platform-admin page that has search words but is
//                 never offered to the designer (no label, section or order)
//   accepts       what the page's address may say it opens at (optional): some
//                 of 'venue', 'date', 'week', 'tab' (shared/nav/links.js,
//                 pageLink(); the page reads them with admin useDeepLink())
//   tabs          with 'tab' in accepts: the tab keys the page knows
// Equal order numbers are broken by path, so two new pages never fight over a
// place. shared/test/navPages.test.mjs checks the records.
//
// The area files are imported by name below, not gathered from the folder:
// shared/ is plain ESM loaded by Node (the API) and by Vite (the admin), and
// only Vite has import.meta.glob, while only Node can read a folder. A new
// area adds its file to this list (the test fails while a file in this folder
// is left out).

import { SECTIONS } from './sections.js'
import { pages as bookings } from './bookings.js'
import { pages as cash } from './cash.js'
import { pages as core } from './core.js'
import { pages as dashboards } from './dashboards.js'
import { pages as hs } from './hs.js'
import { pages as hub } from './hub.js'
import { pages as kiosk } from './kiosk.js'
import { pages as kitchen } from './kitchen.js'
import { pages as localInfo } from './local-info.js'
import { pages as loyalty } from './loyalty.js'
import { pages as menus } from './menus.js'
import { pages as ordering } from './ordering.js'
import { pages as pepper } from './pepper.js'
import { pages as purchasing } from './purchasing.js'
import { pages as recipes } from './recipes.js'
import { pages as reports } from './reports.js'
import { pages as rota } from './rota.js'
import { pages as screens } from './screens.js'
import { pages as shell } from './shell.js'
import { pages as till } from './till.js'
import { pages as website } from './website.js'

/** Each area's pages, by the area's slug (its file's name). */
export const AREA_PAGES = {
  bookings, cash, core, dashboards, hs, hub, kiosk, kitchen, 'local-info': localInfo, loyalty,
  menus, ordering, pepper, purchasing, recipes, reports, rota, screens, shell, till, website,
}

export { SECTIONS }

/** Every page's record, with `area` added: the file it is in. */
export const NAV_PAGES = Object.entries(AREA_PAGES).flatMap(([area, list]) => list.map(p => ({ ...p, area })))

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
const by = key => (a, b) => (a[key] - b[key]) || byPath(a, b)
const byCatalog = NAV_PAGES.slice().sort(by('catalogOrder'))
const listed = byCatalog.filter(p => !p.searchOnly)

export const ROUTE_CATALOG = listed.map(p => ({
  route: p.path, label: p.label, icon: p.icon, ...(p.module ? { module: p.module } : {}),
}))

// A link in the standard menu, with the links that sit under it.
function menuNode(p) {
  const children = menuLinks(p.section, p.path)
  return {
    label: p.menuLabel || p.label, icon: p.icon, route: p.path,
    ...(p.module ? { module: p.module } : {}),
    ...(children.length ? { children } : {}),
  }
}
function menuLinks(section, parent) {
  return listed
    .filter(p => p.section === section && (p.parent || null) === parent)
    .sort(by('order'))
    .map(menuNode)
}

const bySection = (a, b) => (a.order - b.order) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)

export const DEFAULT_NAV_TREE = SECTIONS.slice().sort(bySection)
  .map(s => ({ label: s.label, children: menuLinks(s.label, null) }))

export const NAV_KEYWORDS = Object.fromEntries(byCatalog.map(p => [p.path, p.keywords]))
export const NAV_DESCRIPTIONS = Object.fromEntries(byCatalog.map(p => [p.path, p.description]))

// Platform-admin pages live outside ROUTE_CATALOG (they are never offered
// to the nav designer) but still want search words: the drift test allows
// exactly these beyond the catalogue.
export const EXTRA_SEARCH_ROUTES = byCatalog.filter(p => p.searchOnly).map(p => p.path)

// The standard menu's sections, by their name.
export const NAV_SECTION_DESCRIPTIONS = Object.fromEntries(
  SECTIONS.slice().sort(bySection).map(s => [s.label, s.description]))
