// src/ai/tools/general.js
//
// Tools Pepper uses in every area:
//
//   open_page   a link to an admin page (from the navigation designer's page
//               catalogue, routes/nav.js ROUTE_CATALOG), only pages the person
//               can see. In the chat the link opens the page in the app; over
//               MCP it is the full office address.
//   how_do_i    the Help page's passages that best answer a how-to question,
//               with a link to each (src/ai/helpIndex.js)

import { z } from 'zod'
import { ToolError, isStaff, staffPermissionLevel, levelAtLeast } from '../context.js'
import { ROUTE_CATALOG } from '../../routes/nav.js'
import { officeOrigin } from '../../services/platformHost.js'
import { searchHelp } from '../helpIndex.js'

// Other words staff use for a page, so "the timeline" or "wages" finds it.
const ALSO = {
  '/timeline': ['bookings today', 'floor', 'reservations'],
  '/cash-recon': ['cash up', 'cashing up', 'takings', 'wages', 'expenses', 'petty cash', 'variance'],
  '/rota': ['shifts', 'who is working', 'schedule staff'],
  '/staff': ['people', 'employees', 'leaving', 'holiday'],
  '/food-safety': ['temperatures', 'fridges', 'hot holding', 'cooking checks', 'deliveries'],
  '/orders': ['takeaway', 'collection', 'sold out'],
  '/pos/reports': ['z report', 'x report', 'till takings', 'kitchen report'],
  '/schedule': ['opening times', 'opening hours', 'sittings', 'closures', 'christmas'],
  '/rules': ['booking rules', 'party size', 'cut off'],
  '/website': ['site', 'banner', 'publish'],
  '/menus': ['dishes', 'prices', 'menu'],
  '/menus/allergens': ['allergens', 'allergy'],
  '/purchasing': ['ordering stock', 'supplier orders', 'deliveries'],
  '/screens': ['menu boards', 'tv'],
  '/ai': ['pepper', 'assistant', 'connect'],
}

export const generalTools = [
  {
    name: 'open_page',
    section: 'general',
    title: 'Open a page',
    description:
      'A link to a page of the app, for things best done there (a full report, setting something up, the timeline). ' +
      'Name the page the way the staff member did ("the rota", "cash up", "opening times"). Only pages they can open are offered. ' +
      'Put the link it returns in your reply as it is.',
    input: z.object({ page: z.string().trim().min(2).max(100) }),
    readOnly: true,
    async run(ctx, input) {
      if (!isStaff(ctx)) throw new ToolError('Not available here', 403)
      const t = input.page.toLowerCase().replace(/^the\s+/, '').replace(/\s+page$/, '').trim()
      const modules = [...new Set(ROUTE_CATALOG.map(p => p.module))]
      const levels = new Map(await Promise.all(modules.map(async m => [m, await staffPermissionLevel(ctx, m)])))
      const pages = ROUTE_CATALOG.filter(p => levelAtLeast(levels.get(p.module), 'view'))
      const words = t.split(/[^a-z0-9&]+/).filter(Boolean)
      const score = p => {
        const names = [p.label.toLowerCase(), p.route.slice(1).replace(/[-/]/g, ' '), ...(ALSO[p.route] || [])]
        if (names.some(n => n === t)) return 4
        if (names.some(n => n.startsWith(t))) return 3
        if (names.some(n => n.includes(t))) return 2
        if (words.length && names.some(n => words.every(w => n.includes(w)))) return 1
        return 0
      }
      const ranked = pages.map(p => ({ p, s: score(p) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s)
      if (!ranked.length) {
        throw new ToolError('No page called "' + input.page + '" that you can open. Pages: ' + pages.map(p => p.label).join(', ') + '.', 404)
      }
      const top = ranked.filter(x => x.s === ranked[0].s).map(x => x.p)
      const view = p => ({
        page: p.label,
        ...(ctx.channel === 'staff_chat'
          ? { link: '[' + p.label + '](' + p.route + ')' }
          : { url: officeOrigin() + p.route }),
      })
      return top.length === 1 ? view(top[0]) : { choices: top.slice(0, 6).map(view), note: 'More than one page matches: offer the right one.' }
    },
  },
  {
    name: 'how_do_i',
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
