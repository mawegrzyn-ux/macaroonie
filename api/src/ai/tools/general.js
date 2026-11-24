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
//   what_can_i_do  what can be done with a business object (a supplier, a
//               booking, a fridge reading) and what this person can do, from
//               the object registry (shared/registry/, Pepper-first step 8A1):
//               each change tool by its own class, checks (preconditions:
//               the "why not" when a rule blocks it) and undo, and the
//               permission it needs when the person hasn't got it

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
import { findObjects } from '../../../../shared/registry/index.js'
import { FORMS } from '../../../../shared/forms.js'
import { MODULES } from '../../config/modules.js'
import { staffPermissionLevels } from '../context.js'

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
  'what_can_i_do answers "what can I do with...", "can I..." and "why can\'t I..." about a thing in the app (a ' +
    'booking, a supplier, a fridge reading, a cash day): what can change it, what the person may do, and why not.',
]

const MODULE_LABEL = Object.fromEntries(MODULES.map(m => [m.key, m.label]))
const LEVEL_WORDS = { none: 'no access', view: 'View', use: 'Use', manage: 'Manage' }
// What the Confirm card asks for, by the tool's class (tools/index.js, step 4).
const CLASS_WORDS = {
  reversible: 'a card to confirm',
  consequential: 'a card showing the change, confirmed with a tap',
  destructive: 'a card confirmed with a typed word, never by voice',
}

// Other words for a change than its tool's name uses.
const ACTION_WORDS = {
  delete: ['remove', 'cancel', 'anonymise'], remove: ['delete', 'cancel'], cancel: ['remove', 'delete'],
  add: ['create', 'log', 'new', 'record'], create: ['add', 'new'], new: ['add', 'create'], log: ['add', 'record'],
  change: ['update', 'set', 'edit'], edit: ['update', 'change', 'set'], update: ['change', 'set'],
  erase: ['anonymise'], forget: ['anonymise'], close: ['close'], open: ['remove'],
}

/** Does a change's tool fit the words asked ("delete", "submit", or its name)? */
export function actionMatches(a, text) {
  const said = searchTerms(String(text).replace(/_/g, ' '))
  const words = [...new Set(said.flatMap(w => [w, ...(ACTION_WORDS[w] || [])]))]
  if (!words.length) return true
  const have = searchWords(a.name.replace(/_/g, ' ') + ' ' + a.title)
  const same = (x, y) => x === y || wordForms(x).some(f => wordForms(y).includes(f))
  return words.some(w => have.some(h => same(h, w)))
}

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
      'Use it before guessing how the app works; if nothing matches, say so rather than making steps up. ' +
      'Not for questions about the group\'s own figures ("what was our ... last month?", even one reports may not hold): ' +
      'those go to find_fields or ask_data, which say when reports don\'t cover it.',
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
  {
    name: 'what_can_i_do',
    activity: 'Looked up what can be done',
    section: 'general',
    title: 'What can be done with something',
    description:
      'What can be done with a thing in the app (a booking, a customer, a supplier, a staff member, a fridge reading, a ' +
      'cash day, an expense, a closure, a dish, a menu, a supplier order...) and what this person may do: the changes ' +
      'Pepper can make to it (by tool name), the card each one shows, the checks each makes before it can run, whether ' +
      'it can be undone, the forms that edit it and the page that lists it. Use it for "what can I do with suppliers?", ' +
      '"can I delete a booking?" and "why can\'t I submit the cash-up?": pass the thing in object and, for one change, its ' +
      'words in action. A change the person can\'t make says which permission it needs (why_not); one a rule can block ' +
      'lists the rules (before_it_runs). Answer from what it returns; never promise a change it doesn\'t list.',
    input: z.object({
      object: z.string().trim().min(2).max(100).describe('The thing, in words: "suppliers", "a booking", "fridge temperatures"'),
      action: z.string().trim().max(100).optional().describe('One change asked about, in words ("delete", "submit", "add one"), or a tool name'),
    }),
    readOnly: true,
    async run(ctx, input) {
      if (!isStaff(ctx)) throw new ToolError('Not available here', 403)
      const found = findObjects(input.object)
      if (!found.length) {
        throw new ToolError('Nothing in the app called "' + input.object + '" is described for this. how_do_i may have the steps, ' +
          'or open_page the page.', 404)
      }
      if (found.length > 1) {
        return { choices: found.slice(0, 8).map(o => o.label), note: 'More than one thing fits: ask which, then call again with its name.' }
      }
      const o = found[0]
      // Loaded when it runs: the registry reads every tool (tools/index.js),
      // which a tool file mustn't import while the tools are being gathered.
      const { objectActions } = await import('../registry.js')
      const actions = objectActions(o)
      const forms = o.forms.map(k => ({ key: k, ...FORMS[k] }))
      const page = ROUTE_CATALOG.find(p => p.route === o.page)
      const modules = [...new Set([...actions.flatMap(a => a.modules), ...forms.map(f => f.module), page?.module].filter(Boolean))]
      const levels = modules.length ? await staffPermissionLevels(ctx, modules) : {}
      const has = (mods, need) => !mods.length || mods.some(m => levelAtLeast(levels[m], need))
      const chat = ctx.channel === 'staff_chat'
      const link = (label, path) => (chat ? { link: '[' + label + '](' + path + ')' } : { url: officeOrigin() + path })

      const asked = input.action ? actions.filter(a => actionMatches(a, input.action)) : actions
      const can = [], cant = []
      for (const a of asked) {
        const allowed = has(a.modules, a.needs)
        const line = {
          change: a.title,
          tool: a.name,
          ...(allowed ? { card: CLASS_WORDS[a.class] || CLASS_WORDS.reversible } : {}),
          ...(a.preconditions.length ? { before_it_runs: a.preconditions } : {}),
          ...(a.undo ? { undo: 'Can be undone from its card for a few minutes after it is done.' } : {}),
        }
        if (allowed) { can.push(line); continue }
        const theirs = [...new Set(a.modules.map(m => levels[m] || 'none'))]
        cant.push({
          ...line,
          why_not: 'Needs ' + LEVEL_WORDS[a.needs] + ' on ' + a.modules.map(m => MODULE_LABEL[m] || m).join(' or ') +
            ' (this person has ' + theirs.map(l => LEVEL_WORDS[l] || l).join(', ') + '). An owner or admin can change that on the Access page.',
        })
      }
      const out = {
        object: o.label,
        ...(page && has(page.module ? [page.module] : [], 'view') ? { page: page.label, ...link(page.label, o.page) } : {}),
        ...(o.open ? { opens_one: 'open_page opens its page at a ' + o.open.with.join(', ') } : {}),
        ...(can.length ? { you_can: can } : {}),
        ...(cant.length ? { you_cant: cant } : {}),
        ...(forms.length ? {
          forms: forms.map(f => ({
            form: f.key,
            title: f.title,
            you: levelAtLeast(levels[f.module], f.edit) ? 'can fill it in (open_form)'
              : levelAtLeast(levels[f.module], 'view') ? 'can only read it' : 'can\'t open it',
          })),
        } : {}),
      }
      if (!actions.length) out.note = 'Pepper has no tool that changes ' + o.plural.toLowerCase() + '; that is done on its page.'
      else if (input.action && !asked.length) {
        out.note = 'Pepper can\'t "' + input.action + '" ' + o.plural.toLowerCase() + '. What it can do: ' +
          actions.map(a => a.title).join('; ') + '. Anything else is done on the page, if at all.'
      }
      return out
    },
  },
]
