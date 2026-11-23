// src/ai/tools/general.js
//
// Tools Pepper uses in every area:
//
//   open_page   a link to an admin page (the standard menu's pages, routes/nav.js
//               ROUTE_CATALOG), only pages the person can see, found by the
//               menu search's own matcher (shared/navSearch.js searchNavTree:
//               a page's name, search words and description). In the chat the
//               link opens the page in the app; over MCP it is the full office
//               address. `about` says what the page is for. Given a venue, a
//               day or week and a tab, the link opens the page there when the
//               page's address accepts them (shared/nav/links.js pageLink()).
//               In the staff chat the result also carries nav_card, which the
//               chat draws as a nav card (display(): the page, where it sits
//               in the menu, what it opens at, Open), built from the server's
//               result, never the model's words.
//               Pages are searched in the person's own menu too (navTreeFor():
//               a page renamed there is found and shown by its own name, the
//               standard one beside it), and a page they can open that their
//               menu leaves out is still offered, marked as not in their menu
//               (the owner's choice, 23 Nov 2026: permissions decide what can
//               be opened, the menu only what is tidy for a role).
//   how_do_i    the Help page's passages that best answer a how-to question,
//               with a link to each (src/ai/helpIndex.js)

import { z } from 'zod'
import { ToolError, isStaff, staffPermissionLevel, levelAtLeast, staffReq } from '../context.js'
import { ROUTE_CATALOG } from '../../routes/nav.js'
import { DEFAULT_NAV_TREE } from '../../config/defaultNav.js'
import { NAV_DESCRIPTIONS, NAV_KEYWORDS, searchNavTree, searchTerms, searchWords, wordForms, SEARCH_WEIGHTS } from '../../../../shared/navSearch.js'
import { pageAccepts, pageLink, isDay } from '../../../../shared/nav/links.js'
import { officeOrigin } from '../../services/platformHost.js'
import { navTreeFor, navLinksOf } from '../../services/navTree.js'
import { searchHelp } from '../helpIndex.js'
import { DateStr, VenueText, venueFor, mondayOf, shortDate } from './util.js'

const LABEL = new Map(ROUTE_CATALOG.map(p => [p.route, p.label]))

// The standard menu with only the pages the person can open, each by its
// page-list name: the tree the menu search walks, so a section's name counts
// for the pages in it ("health" finds Food safety). A link under one they
// can't open moves up to its place. `own`: the person's own menu
// (navTreeFor()), each link by the name it has there, links that aren't one
// of the app's pages (a web address) left out.
export function pagesTree(nodes, canSee, { own = false } = {}) {
  return (nodes || []).flatMap(n => {
    const children = pagesTree(n.children, canSee, { own })
    if (!n.route) return children.length ? [{ kind: 'section', label: n.label, children }] : []
    if (!canSee(n) || (own && !LABEL.has(n.route))) return children
    const label = (own && n.label) || LABEL.get(n.route) || n.label
    return [{ label, route: n.route, icon: n.icon, ...(children.length ? { children } : {}) }]
  })
}

// Menu search results from more than one tree, each page once: its best
// score, the first list winning a tie (the person's own menu, so its name).
export function bestByRoute(...lists) {
  const best = new Map()
  for (const list of lists) {
    for (const r of list || []) {
      const had = best.get(r.route)
      if (!had || r.score > had.score) best.set(r.route, r)
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || b.labelHits - a.labelHits || a.label.localeCompare(b.label))
}

// Two words are the same word: as typed, or one a plural of the other.
const sameWord = (a, b) => a === b || wordForms(a).some(f => wordForms(b).includes(f))

/**
 * The page(s) open_page offers for what was asked, from the menu search's
 * ranking (searchNavTree() results, best first): a page whose whole name or
 * address was asked for; else the page(s) whose search words hold what was
 * asked word for word ("cash up", "page designer"); else the best, with any
 * close second (within the gap between a word in a page's name and in its
 * search words) offered beside it.
 */
export function pickPages(results, query) {
  if (!results?.length) return []
  const terms = searchTerms(query)
  const whole = words => words.length === terms.length && words.every(w => terms.some(t => sameWord(t, w)))
  const named = results.find(r => whole(searchWords(r.label))) || results.find(r => whole(searchWords(r.route)))
  if (named) return [named]
  // A word the search drops as filler ("up", "page") still counts when a
  // page's search words hold the whole phrase.
  const words = searchWords(query)
  if (words.length > terms.length) {
    const phrase = ' ' + words.join(' ') + ' '
    const said = results.filter(r => (' ' + searchWords(NAV_KEYWORDS[r.route]).join(' ') + ' ').includes(phrase))
    if (said.length) return said.slice(0, 6)
  }
  const gap = SEARCH_WEIGHTS.label - SEARCH_WEIGHTS.keywords
  return results.filter(r => r.score >= results[0].score - gap).slice(0, 6)
}

// What Pepper is told about this file's tools, gathered by tools/index.js:
// the place in the list (order, then the file name), the areas the tools
// belong to, and the file's lines in the system prompt (prompts.js).
export { generalTools as tools }
export const order = 130
export const sections = {
  general: { label: 'Finding your way: links to pages', open: true },
}
// The file's line(s) in the list of what Pepper can do.
export const promptLines = [
  'open_page gives a link to any page of the app the person can open; with a venue, day or week and tab it opens ' +
    'the page there (the timeline, bookings, rota, food safety, online orders and cash recon).',
  'how_do_i answers "how do I...", "where is..." and "what does... mean" questions about the app from its Help ' +
    'guide, with a link to the steps.',
]

// The tabs a link can open, by page, for the tool's description.
const TAB_TEXT = ROUTE_CATALOG
  .map(p => ({ label: p.label, tabs: pageAccepts(p.route).tabs }))
  .filter(p => p.tabs.length)
  .map(p => p.label + ': ' + p.tabs.join(', '))
  .join('; ')

export const generalTools = [
  {
    name: 'open_page',
    activity: 'Found the page',
    core: true,
    section: 'general',
    title: 'Open a page',
    description:
      'A link to a page of the app, for things best done there (a full report, setting something up, the timeline). ' +
      'Name the page the way the staff member did ("the rota", "cash up", "opening times"). Only pages they can open are offered. ' +
      'When they have a venue, a day or a week, or a part of the page in mind, pass it too and the link opens the page there ' +
      '("the rota for Ware next week": page "rota", venue "Ware", week). Pages that open at a venue and day: Timeline, Bookings, ' +
      'Food safety, Online orders, Cash recon (a day); at a venue and week: Rota, Cash recon. ' +
      'Put the link it returns in your reply as it is.',
    input: z.object({
      page: z.string().trim().min(2).max(100),
      venue: VenueText.describe('The venue the page should open at, by name. Leave out when none was named.'),
      date: DateStr.optional().describe('The day the page should open at (YYYY-MM-DD)'),
      week: DateStr.optional().describe('Any date in the week the page should open at (weeks run Monday to Sunday)'),
      tab: z.string().trim().max(40).optional().describe('The part of the page to open: ' + TAB_TEXT),
    }),
    readOnly: true,
    async run(ctx, input) {
      if (!isStaff(ctx)) throw new ToolError('Not available here', 403)
      // A page with no module of its own (Today) is open to everyone signed
      // in: there is no permission to look up for it.
      const modules = [...new Set(ROUTE_CATALOG.map(p => p.module).filter(Boolean))]
      const levels = new Map(await Promise.all(modules.map(async m => [m, await staffPermissionLevel(ctx, m)])))
      const canSee = p => !p.module || levelAtLeast(levels.get(p.module), 'view')
      const pages = ROUTE_CATALOG.filter(canSee)
      // The person's own menu: its names and places. A group with no menu of
      // its own has the standard one, and every page is in it.
      const ownTree = pagesTree(await navTreeFor(staffReq(ctx)), canSee, { own: true })
      const ownLinks = new Map(navLinksOf(ownTree).map(l => [l.route, l]))
      const hasMenu = ownLinks.size > 0
      const found = bestByRoute(searchNavTree(ownTree, input.page), searchNavTree(pagesTree(DEFAULT_NAV_TREE, canSee), input.page))
      const top = pickPages(found, input.page)
      if (!top.length) {
        throw new ToolError('No page called "' + input.page + '" that you can open. Pages: ' + pages.map(p => p.label).join(', ') + '.', 404)
      }

      // Where the page should open: only what its address accepts, the
      // venue looked up by name only when one of the pages takes it.
      const takes = key => top.some(p => pageAccepts(p.route).keys.includes(key))
      const venue = input.venue && takes('venue') ? await venueFor(ctx, input.venue) : null
      const day = isDay(input.date) ? input.date : null
      const week = isDay(input.week) ? mondayOf(input.week) : null
      const tab = input.tab ? input.tab.toLowerCase() : null
      const at = route => {
        const { keys } = pageAccepts(route)
        // A page that opens at a week but not a day opens at the day's week.
        const w = week || (day && keys.includes('week') && !keys.includes('date') ? mondayOf(day) : null)
        return { venue: venue?.id, date: day, week: w, tab }
      }
      const chat = ctx.channel === 'staff_chat'
      const cards = []
      const view = p => {
        const mine = ownLinks.get(p.route)
        const name = mine?.label || LABEL.get(p.route) || p.label
        const standard = LABEL.get(p.route)
        const inMenu = !hasMenu || !!mine
        const link = pageLink(p.route, at(p.route))
        const used = Object.fromEntries(new URLSearchParams(link.split('?')[1] || ''))
        const opensAt = [
          used.venue ? venue.name : null,
          used.date ? shortDate(used.date) : null,
          used.week ? 'week of ' + shortDate(used.week) : null,
          used.tab ? used.tab + ' tab' : null,
        ].filter(Boolean)
        if (chat) {
          cards.push({
            page: name, ...(standard && standard !== name ? { standard } : {}),
            section: inMenu ? (mine ? mine.path : p.path) || null : 'Not in your menu',
            icon: p.icon || null, link, opens_at: opensAt,
          })
        }
        return {
          page: name,
          ...(standard && standard !== name ? { standard_name: standard } : {}),
          ...(inMenu ? {} : { in_menu: false, menu_note: 'Not in their menu (hidden from their role, or never added); the link still opens it.' }),
          ...(NAV_DESCRIPTIONS[p.route] ? { about: NAV_DESCRIPTIONS[p.route] } : {}),
          ...(opensAt.length ? { opens_at: opensAt.join(', ') } : {}),
          ...(ctx.channel === 'staff_chat'
            ? { link: '[' + name + '](' + link + ')' }
            : { url: officeOrigin() + link }),
        }
      }
      const askedFor = [input.venue && 'venue', input.date && 'date', input.week && 'week', input.tab && 'tab'].filter(Boolean)
      if (top.length === 1) {
        const out = view(top[0])
        const { keys, tabs } = pageAccepts(top[0].route)
        const left = askedFor.filter(k => !keys.includes(k) && !(k === 'date' && keys.includes('week')))
        const badTab = input.tab && keys.includes('tab') && !tabs.includes(tab)
        if (left.length || badTab) {
          out.note = 'The page doesn\'t open at a ' + [...left, ...(badTab ? ['tab called "' + input.tab + '"'] : [])].join(' or ') +
            (keys.length ? '; it opens at a ' + keys.join(', ') + (tabs.length ? ' (tabs: ' + tabs.join(', ') + ')' : '') : '') +
            '. Say so if it matters.'
        }
        return chat ? { ...out, nav_card: cards } : out
      }
      const choices = top.map(view)
      return { choices, note: 'More than one page matches: offer the right one.', ...(chat ? { nav_card: cards } : {}) }
    },
    // The chat's card (chat.js): from the result the server made. Only links
    // into the app (a path), as the chat's own links.
    display(out) {
      const pages = (Array.isArray(out?.nav_card) ? out.nav_card : [])
        .filter(c => typeof c?.link === 'string' && /^\/(?!\/)/.test(c.link) && typeof c.page === 'string')
      return pages.length ? { type: 'nav', pages } : null
    },
  },
  {
    name: 'how_do_i',
    activity: 'Looked it up in Help',
    core: true,
    section: 'general',
    title: 'Look it up in Help',
    description:
      'Steps from the app\'s own Help guide: how to set something up or do a job on a page, where a setting is, what a figure means ' +
      '("how do I set up tip pots?", "where do I add a fridge?", "what does variance mean?"). Returns the best-matching Help passages, ' +
      'each with a link. Answer from them in your own words, briefly, and give the link to the most useful one. ' +
      'Use it before guessing how the app works; if nothing matches, say so rather than making steps up.',
    input: z.object({ question: z.string().trim().min(3).max(300) }),
    readOnly: true,
    async run(ctx, input) {
      if (!isStaff(ctx)) throw new ToolError('Not available here', 403)
      const found = searchHelp(input.question)
      if (found === null) throw new ToolError('The Help guide isn\'t available on this server.', 503)
      if (!found.length) return { answers: [], note: 'Nothing in the Help guide matches. Say so, and offer open_page or to ask a manager.' }
      return {
        answers: found.map(a => ({
          section: a.section,
          heading: a.heading,
          text: a.text,
          ...(ctx.channel === 'staff_chat'
            ? { link: '[Help: ' + a.heading + '](' + a.link + ')' }
            : { url: officeOrigin() + a.link }),
        })),
      }
    },
  },
]
