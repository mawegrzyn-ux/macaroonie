// src/routes/navAi.js — mounted at /api/ai
//
// Pepper's menu search (9 Nov 2026). The sidebar's search box filters the
// menu as the person types (shared/navSearch.js, no AI); Enter or the
// Pepper button in the box asks Pepper instead, for questions in their own
// words ("where do I see what the fryer cooked", "a guest wants a refund").
//
//   POST /nav-search  { query }
//     -> { picks: [{ label, route, icon, path, why }], note }
//
// Pepper chooses only from the person's own menu (navTreeFor(): the links
// their role can open, as /api/me sends them), given as refs L1..Ln with
// each page's search words; refs that aren't on the list are dropped, so an
// answer can never send someone to a page they can't open. The everyday
// model answers (askForJson model 'fast'), counted against the group's
// monthly allowance and the person's daily share. Under /api/ai for the
// longer proxy timeout. Needs Pepper (ai_assistant view, Pepper on).

import { z } from 'zod'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { askForJson, pepperOn, obj, str, arr, clip } from '../services/aiJson.js'
import { navTreeFor, navLinksOf } from '../services/navTree.js'
import { NAV_KEYWORDS } from '../../../shared/navSearch.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'

export const MAX_PICKS = 5

// Pages only platform admins reach; they aren't in any group's menu (the
// sidebar adds them for platform admins, and the search does the same).
const PLATFORM_LINKS = [
  { label: 'Platform', route: '/platform', icon: 'Shield', path: 'Platform' },
  { label: 'Backlog', route: '/backlog', icon: 'KanbanSquare', path: 'Platform' },
]

const Body = z.object({
  query: z.string().trim().min(1, 'Type what you are looking for').max(200, 'Keep it under 200 characters'),
})

export const NAV_SEARCH_SCHEMA = obj({
  picks: arr(obj({ ref: str, why: str })),
  note: str,
})

export const SYSTEM_PROMPT = `You are ${ASSISTANT_NAME}, the assistant in Macaroonie, the app restaurant groups run their restaurants on (bookings, tills, kitchen screens, online orders, menus, staff and rota, cash reconciliation, purchasing, health and safety, website).

Someone typed into the search box at the top of the app's main menu. You get their words and the menu links they can open, each as a ref (L1, L2, ...) with its label, where it sits in the menu and the words the page covers. Pick the pages that best answer what they typed, best first, at most ${MAX_PICKS}; usually one to three. For each, say in a few words (under 12) why it fits or what to do there.

Then write a short note (one or two plain sentences, under 40 words) that helps them choose: which page to open first, and where on it to look if that is clear from the words. If none of the pages does what they asked, pick none and say so, and suggest asking ${ASSISTANT_NAME} in the chat.

Rules: only refs from the list. Never invent pages, buttons or features. Plain British English, no emojis, no markdown.`

/** One line per link for the model. */
function linkLines(links) {
  return links.map((l, i) => {
    const words = NAV_KEYWORDS[l.route] || ''
    return `L${i + 1} | ${l.label}${l.path ? ' | in: ' + l.path : ''}${words ? ' | covers: ' + words : ''}`
  }).join('\n')
}

/** The model's picks back onto the links: known refs only, each once, at most MAX_PICKS. */
export function picksFrom(raw, links) {
  const seen = new Set()
  const picks = []
  for (const p of Array.isArray(raw?.picks) ? raw.picks : []) {
    const m = /^L(\d{1,4})$/i.exec(String(p?.ref || '').trim())
    const link = m ? links[Number(m[1]) - 1] : null
    if (!link || seen.has(link.route)) continue
    seen.add(link.route)
    picks.push({ label: link.label, route: link.route, icon: link.icon, path: link.path, why: clip(p.why, 140) })
    if (picks.length >= MAX_PICKS) break
  }
  return { picks, note: clip(raw?.note, 400) }
}

export default async function navAiRoutes(app) {
  app.post('/nav-search', {
    preHandler: [requireAuth, requirePermission('ai_assistant', 'view')],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async req => {
    const { query } = Body.parse(req.body ?? {})
    if (!req.tenantId) throw httpError(400, 'Pick a restaurant first')
    await pepperOn(req.tenantId)

    const links = [...navLinksOf(await navTreeFor(req))]
    if (req.isPlatformAdmin) for (const l of PLATFORM_LINKS) if (!links.some(x => x.route === l.route)) links.push(l)
    // A link in the menu twice is offered once (its first place).
    const unique = links.filter((l, i) => links.findIndex(x => x.route === l.route) === i)
    if (!unique.length) return { picks: [], note: 'Your menu has no pages to search yet.' }

    const raw = await askForJson({
      tenantId: req.tenantId,
      person: { sub: req.user?.sub, email: req.user?.email },
      system: SYSTEM_PROMPT,
      schema: NAV_SEARCH_SCHEMA,
      content: [
        { type: 'text', text: 'Menu links they can open:\n' + linkLines(unique) },
        { type: 'text', text: 'They typed: ' + JSON.stringify(query) },
      ],
      maxTokens: 2000,
      effort: 'low',
      what: 'search',
      model: 'fast',
    })
    return picksFrom(raw, unique)
  })
}
