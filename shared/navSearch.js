// shared/navSearch.js — the menu search's one set of rules (8 Nov 2026).
//
// The admin's sidebar has a search box: the person types a page's name or
// what they want to do ("change staff pay", "fridge temperatures") and the
// menu narrows to the links that fit. The matching lives here so the admin
// (AppShell's NavSearch) and the tests share one implementation, and
// NAV_KEYWORDS and NAV_DESCRIPTIONS are checked against the API's
// ROUTE_CATALOG by api/test/nav-default.test.mjs, so a new page can't ship
// without search words and a description, and a renamed route can't leave
// stale ones behind. Since 22 Nov 2026 they are built from each area's pages
// (shared/nav/<area>.js: a page's keywords and description sit in its record),
// gathered by shared/nav/index.js, and re-exported here.
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

// What people might type to reach each page, beyond its menu label, each
// page in a sentence, the standard menu's sections' descriptions, and the
// platform-admin pages that have search words but are not in ROUTE_CATALOG:
// all from the pages' records (shared/nav/index.js).
import { NAV_KEYWORDS, NAV_DESCRIPTIONS, NAV_SECTION_DESCRIPTIONS, EXTRA_SEARCH_ROUTES } from './nav/index.js'
export { NAV_KEYWORDS, NAV_DESCRIPTIONS, NAV_SECTION_DESCRIPTIONS, EXTRA_SEARCH_ROUTES }

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

/**
 * Saved reports the menu search lists below the menu's links (phase 5,
 * docs/REPORTS.md 15): every term must hit the report's name or its
 * description, a name hit counting more; starred reports first among equals.
 * `list` is GET /api/reports' rows (only what the person may open). [] when
 * not searching.
 */
export const REPORT_RESULTS_MAX = 5
export function searchReports(list, query, max = REPORT_RESULTS_MAX) {
  const terms = searchTerms(query)
  if (!terms.length) return []
  const out = []
  for (const r of list || []) {
    const name = searchWords(r.name)
    const about = searchWords(r.description)
    let score = 0
    let ok = true
    for (const t of terms) {
      const n = hitKind(t, name)
      const d = n ? 0 : hitKind(t, about)
      if (!n && !d) { ok = false; break }
      score += n ? (n === 2 ? 2 : 2 - FORM_PENALTY) : (d === 2 ? 1 : 1 - FORM_PENALTY)
    }
    if (ok) out.push({ report: r, score: score + (r.starred ? 0.25 : 0) })
  }
  out.sort((a, b) => b.score - a.score || String(a.report.name).localeCompare(String(b.report.name)))
  return out.slice(0, max).map(x => x.report)
}
