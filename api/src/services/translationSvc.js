// src/services/translationSvc.js
//
// The menu's words in other languages for self-order kiosks (migration 172,
// menu_translations; shared/kiosk.js TK has the keys). Menus > Translations
// (routes/menus.js) lists every word a kiosk can show next to its
// translation; kiosks get the translations with their config
// (services/kioskSvc.js). Kept apart from routes/menus.js (which imports
// this file) so it reads the tables itself.
//
//   translationSources()  every translatable word of the tenant (drafts, so a
//                         new dish can be translated before it is published)
//   saveTranslations()    upsert / delete one language's words
//   aiTranslate()         Claude suggests translations for words without one
//                         (the page shows them; nothing is saved until Save)

import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'
import { httpError } from '../middleware/error.js'
import { activeKey } from '../ai/apiKey.js'
import { addUsage } from '../ai/context.js'
import { chatUnitsLeft, personUnitsLeft } from '../ai/settings.js'
import { translationSources as buildSources, KIOSK_LANGUAGES, KEY_PATTERN } from '../../../shared/kiosk.js'
import { noticeOf, menuTags } from '../../../shared/menuTags.js'

export async function translationSources(tx, tenantId) {
  const [menus, sections, items, variants, groups, options, types, tags, noticeRows, designs] = await Promise.all([
    tx`SELECT id, name FROM menus WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`,
    tx`SELECT id, menu_id, title, subtitle, visibility FROM menu_sections WHERE tenant_id = ${tenantId} ORDER BY sort_order, title`,
    tx`SELECT id, section_id, name, description, kind, combo FROM menu_items WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`,
    tx`SELECT item_id, label FROM menu_item_variants WHERE tenant_id = ${tenantId} ORDER BY sort_order`,
    tx`SELECT id, name, scale_low, scale_high FROM menu_variant_groups WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`,
    tx`SELECT id, group_id, label, description FROM menu_variant_options WHERE tenant_id = ${tenantId} ORDER BY sort_order, label`,
    tx`SELECT id, name FROM order_types WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order, name`,
    tx`SELECT code, label, kind, standard_key, show_on_menu FROM menu_dietary_tags WHERE tenant_id = ${tenantId} ORDER BY kind = 'allergen', sort_order, label`,
    tx`SELECT title, body, removable_note FROM menu_allergen_notice WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, name, settings FROM kiosk_designs WHERE tenant_id = ${tenantId} ORDER BY created_at`,
  ])
  const variantsOf = new Map()
  for (const v of variants) (variantsOf.get(v.item_id) || variantsOf.set(v.item_id, []).get(v.item_id)).push(v)
  const itemsOf = new Map()
  for (const it of items) (itemsOf.get(it.section_id) || itemsOf.set(it.section_id, []).get(it.section_id)).push({ ...it, variants: variantsOf.get(it.id) || [] })
  const sectionsOf = new Map()
  for (const s of sections) (sectionsOf.get(s.menu_id) || sectionsOf.set(s.menu_id, []).get(s.menu_id)).push({ ...s, items: itemsOf.get(s.id) || [] })
  return buildSources({
    menus: menus.map(m => ({ ...m, sections: sectionsOf.get(m.id) || [] })),
    groups: groups.map(g => ({ ...g, options: options.filter(o => o.group_id === g.id) })),
    types,
    tags: menuTags(tags),
    notice: noticeOf(noticeRows[0]),
    designs,
  })
}

const LANG = new Set(KIOSK_LANGUAGES.map(l => l.code))

export function checkLang(lang) {
  if (!LANG.has(lang)) throw httpError(422, 'Pick one of the kiosk languages')
  return lang
}

/** One language's words: texts { key: text | '' } ('' removes it). Returns how many were saved and removed. */
export async function saveTranslations(tx, tenantId, lang, texts, by) {
  checkLang(lang)
  let saved = 0, removed = 0
  for (const [key, value] of Object.entries(texts)) {
    if (!KEY_PATTERN.test(key)) throw httpError(422, 'A translation key isn\'t right: ' + key.slice(0, 60))
    const t = typeof value === 'string' ? value.trim() : ''
    if (!t) {
      const r = await tx`DELETE FROM menu_translations WHERE tenant_id = ${tenantId} AND lang = ${lang} AND key = ${key}`
      removed += r.count
      continue
    }
    if (t.length > 2000) throw httpError(422, 'A translation is too long (2000 characters at most)')
    await tx`
      INSERT INTO menu_translations (tenant_id, lang, key, text, updated_by)
      VALUES (${tenantId}, ${lang}, ${key}, ${t}, ${by})
      ON CONFLICT (tenant_id, lang, key) DO UPDATE SET text = EXCLUDED.text, updated_by = EXCLUDED.updated_by, updated_at = now()`
    saved++
  }
  return { saved, removed }
}

// ── Suggestions from Claude ──────────────────────────────────────

export const AI_BATCH = 120

const SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, text: { type: 'string' } },
        required: ['key', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations'],
  additionalProperties: false,
}

let client = null, clientKey = null
async function anthropic() {
  const { key } = await activeKey()
  if (!key) throw httpError(503, 'AI isn\'t set up on this server: a platform admin adds the key on the Platform page.')
  if (key !== clientKey) {
    client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 })
    clientKey = key
  }
  return client
}

/**
 * Suggested translations for these words: items [{ key, text, context }],
 * from the source language to `lang`. Counts towards the tenant's monthly AI
 * allowance (Platform page) and the asking person's daily share of it
 * (`person` = { sub, email }). Returns { key: text } for the keys asked only.
 */
export async function aiTranslate(tenantId, { lang, source = 'en', items, person = null }) {
  checkLang(lang)
  if (!items.length) return {}
  if ((await chatUnitsLeft(tenantId)) <= 0) throw httpError(429, 'This month\'s AI allowance is used up.')
  const mine = person?.sub ? await personUnitsLeft(tenantId, person.sub) : null
  if (mine !== null && mine <= 0) throw httpError(429, 'You\'ve used your share of the AI allowance for today. It starts again tomorrow.')
  const target = KIOSK_LANGUAGES.find(l => l.code === lang)
  const from = KIOSK_LANGUAGES.find(l => l.code === source) || KIOSK_LANGUAGES[0]
  const api = await anthropic()
  let res
  try {
    res = await api.messages.create({
      model: env.AI_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: 'You translate the words on a restaurant\'s self-order kiosk from ' + from.name + ' into ' + target.name + ' (' + target.code + '). '
        + 'Keep dish and brand names that are names (Pad Thai, Coca-Cola, Lemon Pepper) as they are, unless the language has its own common name for the dish. '
        + 'Keep them short, the way a menu would say them, with the same {placeholders} as the original. '
        + 'Allergen names must be the standard names used on food labels in that language. '
        + 'Each item has a key, the text and where it shows (context); answer with every key and its translation.',
      messages: [{ role: 'user', content: JSON.stringify({ items: items.map(i => ({ key: i.key, text: i.text, context: i.context })) }) }],
    })
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw httpError(503, 'The AI key isn\'t working. A platform admin needs to update it.')
    }
    throw httpError(502, 'Claude couldn\'t translate just now: try again in a moment.')
  }
  const u = res.usage || {}
  addUsage(tenantId, 'staff_chat', {
    input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0, model: res.model, person,
  })
  const textBlock = (res.content || []).find(b => b.type === 'text')
  let parsed = null
  try { parsed = JSON.parse(textBlock?.text || '') } catch { parsed = null }
  const wanted = new Set(items.map(i => i.key))
  const out = {}
  for (const t of parsed?.translations || []) {
    if (wanted.has(t.key) && typeof t.text === 'string' && t.text.trim()) out[t.key] = t.text.trim().slice(0, 2000)
  }
  return out
}
