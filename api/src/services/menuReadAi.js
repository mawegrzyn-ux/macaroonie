// src/services/menuReadAi.js
//
// Pepper reads a menu: photos of a printed menu, screenshots or a PDF become
// sections and dishes (prices, descriptions, options, allergens as printed).
// One model call answered as JSON in a fixed shape (structured outputs).
// Nothing is saved here: the admin shows what was read for the person to
// check and change, then POST /api/ai/menus/import makes the menu with
// Pepper's own menu building (createMenuFromSections() in ai/tools/menus.js).
//
//   readMenu({ tenantId, person, files, hint, tags, groups, currency })
//     files: [{ media_type, data (base64) }] images and / or PDFs
//     Returns { menu: { name, tagline, service_times, sections }, notes }
//     with sections in create_menu's shape ({ section, subtitle, dishes }).
//
// Counts towards the tenant's monthly AI allowance and the person's daily
// share of it, like the chat.

import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'
import { httpError } from '../middleware/error.js'
import { activeKey } from '../ai/apiKey.js'
import { addUsage } from '../ai/context.js'
import { chatUnitsLeft, personUnitsLeft } from '../ai/settings.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'

// Every property is required and nothing is nullable ('' = not set).
const obj = props => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false })
const str = { type: 'string' }
const arr = items => ({ type: 'array', items })

export const MENU_SCHEMA = obj({
  name: str,
  tagline: str,
  service_times: str,
  notes: str,
  sections: arr(obj({
    title: str,
    subtitle: str,
    dishes: arr(obj({
      name: str,
      description: str,
      price: str,
      calories: str,
      allergens: arr(obj({ name: str, level: { type: 'string', enum: ['contains', 'may_contain', 'removable'] } })),
      dietary: arr(str),
      options: arr(obj({
        group: str,
        mode: { type: 'string', enum: ['base', 'extra'] },
        choices: arr(obj({ name: str, price: str })),
      })),
    })),
  })),
})

export const SYSTEM_PROMPT = `You are ${ASSISTANT_NAME}, the assistant in Macaroonie, a platform restaurant groups run their restaurants on. You read a restaurant's menu from photos, screenshots or a PDF and write it out as data. The app turns it into a menu that the person checks before anything is saved.

Read everything on the menu and copy it as printed:
- Sections in the menu's order, with their titles as printed (subtitle: a line under the title, else '').
- Dishes in each section in the menu's order. name and description exactly as printed (fix only obvious OCR mistakes); description '' when there is none. Never invent dishes, descriptions or prices.
- price: the dish's price as a plain number with two decimals ("12.50"), no currency sign; '' when the dish has no single price.
- A dish whose price depends on a choice (Chicken 12, Prawn 14; Small / Large) gets options: one group (its name, e.g. "Protein" or "Size"), mode base, a choice per option with its price, and the dish's own price ''.
- Add-ons for a dish or a section ("add cheese +1.00", "extra shot 0.50") are options with mode extra and the extra price. Put a section's add-ons on each of its dishes.
- When a group name from existing_option_groups means the same thing, use that exact name.
- calories: only when printed (kcal, a number), else ''.
- allergens and dietary: only what the menu itself states (words, or symbols explained in a key). Use the exact names from existing_allergens and existing_dietary_tags when they mean the same thing. level: may_contain when the menu says "may contain" or "traces", removable when it says it can be left out on request, else contains. Never guess allergens from ingredients.
- The same menu can span several pages or photos: join them into one menu; don't repeat a section that continues on the next page.
- name: the menu's title when printed (e.g. "Dinner", "Lunch menu"), else a short name for it. tagline: a strap line under the title, else ''. service_times: when it is served if printed ("Mon-Fri 12-3pm"), else ''.
- notes: one or two plain sentences on anything you couldn't read or weren't sure of (a blurred price, a page cut off); '' when everything was clear.

Write in plain British English.`

let client = null, clientKey = null
async function anthropic() {
  const { key } = await activeKey()
  if (!key) throw httpError(503, 'AI isn\'t set up on this server: a platform admin adds the key on the Platform page.')
  if (key !== clientKey) {
    client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 280_000 })
    clientKey = key
  }
  return client
}

async function callClaude(params) {
  const api = await anthropic()
  try {
    return await api.messages.stream(params).finalMessage()
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw httpError(503, 'The AI key isn\'t working. A platform admin needs to update it.')
    }
    if (err instanceof Anthropic.BadRequestError) throw err
    throw httpError(503, 'Claude is busy or can\'t be reached right now. Try again in a moment.')
  }
}

function jsonIn(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

const clip = (v, n) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, n) : '')

/** "12.50", "£12.50", "12,50" -> 12.5; anything else -> undefined. */
export function readPrice(v) {
  const t = String(v ?? '').replace(/[£$€\s]/g, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, '')
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return undefined
  const n = Math.round(Number(t) * 100) / 100
  return n >= 0 && n <= 10000 ? n : undefined
}

/** The model's answer as create_menu's sections (bounded, cleaned, empty parts dropped). */
export function toSections(raw) {
  const out = []
  for (const s of (Array.isArray(raw?.sections) ? raw.sections : []).slice(0, 60)) {
    const title = clip(s?.title, 120)
    const dishes = []
    for (const d of (Array.isArray(s?.dishes) ? s.dishes : []).slice(0, 150)) {
      const name = clip(d?.name, 200)
      if (!name) continue
      const price = readPrice(d?.price)
      const kcal = Number(String(d?.calories ?? '').replace(/[^\d]/g, ''))
      const options = (Array.isArray(d?.options) ? d.options : []).slice(0, 6).map(o => ({
        group: clip(o?.group, 80),
        mode: o?.mode === 'extra' ? 'extra' : 'base',
        choices: (Array.isArray(o?.choices) ? o.choices : []).slice(0, 30)
          .map(c => ({ name: clip(c?.name, 60), ...(readPrice(c?.price) !== undefined ? { price: readPrice(c.price) } : {}) }))
          .filter(c => c.name),
      })).filter(o => o.group && o.choices.length)
      dishes.push({
        name,
        ...(clip(d?.description, 2000) ? { description: clip(d.description, 2000) } : {}),
        ...(price !== undefined && !options.some(o => o.mode === 'base') ? { price } : {}),
        ...(kcal > 0 && kcal <= 10000 && String(d?.calories ?? '').trim() ? { calories: kcal } : {}),
        allergens: (Array.isArray(d?.allergens) ? d.allergens : []).slice(0, 30)
          .map(a => ({ name: clip(a?.name, 60), level: ['may_contain', 'removable'].includes(a?.level) ? a.level : 'contains' }))
          .filter(a => a.name),
        dietary: (Array.isArray(d?.dietary) ? d.dietary : []).slice(0, 20).map(t => clip(t, 60)).filter(Boolean),
        options,
      })
    }
    if (!title && !dishes.length) continue
    out.push({ section: title || 'Menu', ...(clip(s?.subtitle, 120) ? { subtitle: clip(s.subtitle, 120) } : {}), dishes })
  }
  return out
}

export async function readMenu({ tenantId, person, files, hint = '', tags = [], groups = [], currency = 'GBP' }) {
  if ((await chatUnitsLeft(tenantId)) <= 0) throw httpError(429, 'This month\'s AI allowance is used up.')
  const mine = person?.sub ? await personUnitsLeft(tenantId, person.sub) : null
  if (mine !== null && mine <= 0) throw httpError(429, 'You\'ve used your share of the AI allowance for today. It starts again tomorrow.')

  const content = files.map(f => f.media_type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } }
    : { type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } })
  content.push({
    type: 'text',
    text: (files.length === 1 ? 'The menu is above.' : 'The menu is above, ' + files.length + ' files in order.') + '\n' + JSON.stringify({
      ...(hint.trim() ? { request: hint.trim() } : {}),
      currency,
      existing_allergens: tags.filter(t => t.kind === 'allergen').map(t => t.label),
      existing_dietary_tags: tags.filter(t => t.kind !== 'allergen').map(t => t.label),
      existing_option_groups: groups.map(g => g.name),
    }),
  })

  const params = {
    model: env.AI_MODEL,
    max_tokens: 32000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: MENU_SCHEMA } },
    messages: [{ role: 'user', content }],
  }
  let res
  try {
    res = await callClaude(params)
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError) || !/schema|output_config|format/i.test(err.message || '')) {
      if (err instanceof Anthropic.BadRequestError) throw httpError(422, 'Claude couldn\'t read that file. Try clearer photos (JPEG or PNG) or a PDF.')
      throw err
    }
    res = await callClaude({
      ...params,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: SYSTEM_PROMPT + '\n\nAnswer with one JSON object only, no other text, matching this JSON schema:\n' + JSON.stringify(MENU_SCHEMA), cache_control: { type: 'ephemeral' } }],
    })
  }
  const u = res.usage || {}
  await addUsage(tenantId, 'staff_chat', {
    input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0, model: res.model, person,
  })
  if (res.stop_reason === 'refusal') throw httpError(422, ASSISTANT_NAME + ' can\'t read this one. Try other photos or a PDF of the menu.')
  if (res.stop_reason === 'max_tokens') throw httpError(422, 'That menu is too long to read in one go. Send it a few pages at a time.')

  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  const out = jsonIn(text)
  if (!out || !Array.isArray(out.sections)) throw httpError(502, ASSISTANT_NAME + '\'s answer couldn\'t be read. Try again.')
  const sections = toSections(out)
  if (!sections.some(s => s.dishes.length)) throw httpError(422, ASSISTANT_NAME + ' couldn\'t find any dishes in that. Try clearer photos or a PDF of the menu.')
  return {
    menu: { name: clip(out.name, 120) || 'Menu', tagline: clip(out.tagline, 200), service_times: clip(out.service_times, 200), sections },
    notes: clip(out.notes, 600),
  }
}
