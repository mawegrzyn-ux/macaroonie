// src/ai/tools/menus.js
//
// Menu tools for staff: the Ask AI chat and the staff MCP connector, next to
// the booking, H&S and purchasing tools. Permissions as on the Menus pages:
//
//   list_menus       menus, where they show, how many sections and dishes     menus, view
//   get_menu         one menu: sections and dishes with prices, options,
//                    allergens and dietary tags                               menus, view
//   find_dishes      dishes by name across menus, or by allergen / dietary
//                    tag (has it, or free from it)                            menus, view
//
//   create_menu      a new menu, optionally with sections and dishes (a menu
//                    read from a photo or PDF goes in here)                   menus, manage
//   update_menu      name, venue, published, tagline, service times, intro
//   duplicate_menu   a copy, not published
//   add_dishes       dishes into existing or new sections
//   update_dish      one dish: name, description, price, options, allergens,
//                    dietary tags, calories, orderable, featured, move
//   remove_dishes
//   update_section   rename, subtitle, where it shows, VAT, move
//   remove_section   a section and its dishes
//   change_prices    raise / lower / set prices by % or an amount, rounded
//   publish_menu     put the draft live now or at a set time                  menus, manage
//   cancel_menu_publish  withdraw a scheduled publish                          menus, manage
//
// Publishing (migration 165): the change tools edit the DRAFT, the same as
// the Menus page. Guests, the till, Deliveroo and cooking checks see the
// live version, which only changes when the menu is published. get_menu
// shows the draft unless asked for the live version; find_dishes (allergy
// questions) searches the live versions, which is what guests are served.
//
// A change edits the menu's whole tree: the tool loads the menu with
// GET /api/menus/:id, turns it into the save body with menuSaveBody()
// (routes/menus.js, which keeps every field and every id), changes that and
// saves it with the same PATCH the Menus page uses, so the route's checks,
// the till refresh and the print designs' links to sections and dishes are
// the page's. describe() and run() call the same plan function, and run()
// loads the menu again first: a save made by someone else between the card
// and Confirm is built on, not undone.
//
// Dish options are option groups (the Variant groups page: Protein, Size).
// A group named that doesn't exist yet is made with the choices and prices
// given; an existing group is never changed: a dish's own prices for its
// choices are kept on the dish (the same per-dish prices the dish panel sets).
// No one-off options are made: the Menus page no longer keeps them.

import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { withTenant } from '../../config/db.js'
import { ToolError, callApi, audit, requireStaffPermission } from '../context.js'
import { menuSaveBody } from '../../routes/menus.js'
import { pickByName, DateStr, TimeStr, localParts, whenText, zonedInstant } from './util.js'

const Name = z.string().min(1).max(200)
const Price = z.number().min(0).max(10000).describe('Pounds, e.g. 12.5')
const Level = z.enum(['contains', 'may_contain', 'removable'])
const Visibility = z.enum(['show', 'website_hidden', 'hidden'])

const AllergenIn = z.union([
  z.string().min(1).max(60),
  z.object({
    name:  z.string().min(1).max(60),
    level: Level.default('contains').describe('contains, may_contain, or removable (can be left out on request)'),
  }),
])
const ChoiceIn = z.object({
  name:  z.string().min(1).max(60),
  price: Price.optional().describe('Price of this choice for this dish'),
})
const OptionsIn = z.object({
  group:   z.string().min(1).max(80).describe('Option group, e.g. Protein or Size. A new name makes a new group'),
  mode:    z.enum(['base', 'extra']).optional().describe('New groups only: base = the choice is the dish price; extra = added on top'),
  choices: z.array(ChoiceIn).max(30).default([]).describe('This dish\'s prices; an existing group\'s choices left out keep their usual price'),
})
const DishFields = {
  native_name: z.string().max(200).nullable().optional().describe('Name in the original language'),
  description: z.string().max(2000).nullable().optional(),
  price:       Price.nullable().optional().describe('Dish price; leave out for dishes priced only by their options'),
  calories:    z.number().int().min(0).max(10000).nullable().optional().describe('kcal'),
  notes:       z.string().max(200).nullable().optional().describe('Short note shown with the dish, e.g. "Hot"'),
  orderable:   z.boolean().optional().describe('Can be ordered online (default yes)'),
  featured:    z.boolean().optional().describe('House favourite'),
}
const DishIn = z.object({
  name: Name,
  ...DishFields,
  allergens: z.array(AllergenIn).max(30).optional().describe('Allergen tags, e.g. ["Peanuts", {"name": "Gluten", "level": "may_contain"}]'),
  dietary:   z.array(z.string().min(1).max(60)).max(20).optional().describe('Dietary tags, e.g. ["Vegan"]'),
  options:   z.array(OptionsIn).max(6).optional(),
})
const SectionIn = z.object({
  section:  z.string().min(1).max(120).describe('Section title: one already on the menu, or a new one'),
  subtitle: z.string().max(120).optional(),
  dishes:   z.array(DishIn).max(150).default([]),
})
const Rounding = {
  round_to: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(50), z.literal(100)]).optional()
    .describe('Round new prices to 1, 5, 10, 50 or 100 pence'),
  round:    z.enum(['up', 'nearest', 'down']).optional(),
}

const VIS_TEXT = { show: 'everywhere', website_hidden: 'printed menus only (hidden on the website and online ordering)', hidden: 'nowhere (hidden on the website and in print)' }
const LEVEL_TEXT = { may_contain: 'may contain', removable: 'can be removed' }
const MAX_LINES = 40

const pence = p => (p == null ? null : Math.round(Number(p) * 100))
const money = p => (p == null ? 'no price' : '£' + (Number(p) / 100).toFixed(2))
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many)
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
const sameName = (a, b) => norm(a) === norm(b) || norm(a).replace(/s$/, '') === norm(b).replace(/s$/, '')
const show = v => (v === null || v === undefined || v === '' ? 'none' : String(v))

function cut(lines, max = MAX_LINES) {
  return lines.length > max ? [...lines.slice(0, max), '... and ' + (lines.length - max) + ' more'] : lines
}

// ── Access ─────────────────────────────────────────────────

const requireRead = ctx => requireStaffPermission(ctx, 'menus', 'view')

/** Menus manage: the menu routes' own rule. */
const requireEdit = ctx => requireStaffPermission(ctx, 'menus', 'manage')

async function audited(ctx, tool, input, fn) {
  try {
    const result = await fn()
    await audit(ctx, { tool, input, ok: true, result })
    return result
  } catch (err) {
    await audit(ctx, { tool, input, ok: false, result: { error: err.message } })
    throw err
  }
}

// ── Loading ────────────────────────────────────────────────

async function tenantVenues(ctx) {
  return withTenant(ctx.tenantId, tx => tx`
    SELECT id, name FROM venues WHERE tenant_id = ${ctx.tenantId} AND is_active = true ORDER BY name
  `)
}

const menuLabel = m => m.name + (m.venue_name ? ' (' + m.venue_name + ')' : '')
const loadMenus = ctx => callApi(ctx, 'GET', '/api/menus')
const loadMenu = (ctx, id, version = 'draft') => callApi(ctx, 'GET', '/api/menus/' + id + (version === 'live' ? '?version=live' : ''))

/** The live version of a menu, or null when it has never been published. */
async function loadLive(ctx, id) {
  try {
    return await loadMenu(ctx, id, 'live')
  } catch (err) {
    if (err.status === 404 || err.statusCode === 404) return null
    throw err
  }
}

const SAVED = 'Saved to the draft. Guests, the till and Deliveroo see it once the menu is published (publish_menu, or Publish on the Menus page).'
const REMOVED = 'Removed from the draft. It stays on the live menu until the menu is published (publish_menu, or Publish on the Menus page).'

/** The time zone menus are published in: the menu's venue, else the first venue's. */
async function menuTz(ctx, venueId = null) {
  const rows = await withTenant(ctx.tenantId, tx => tx`
    SELECT id, timezone FROM venues WHERE tenant_id = ${ctx.tenantId} AND is_active = true ORDER BY name
  `)
  return (rows.find(v => v.id === venueId) || rows[0])?.timezone || 'Europe/London'
}

/** "live, matches the draft" etc. from GET /api/menus?status=1's publish field. */
function publishText(st, tz) {
  if (!st) return 'unknown'
  const parts = []
  if (!st.live_at) parts.push('never published: not live anywhere')
  else parts.push(st.changed ? 'live, with draft changes not published yet' : 'live, matches the draft')
  if (st.scheduled_at) parts.push('a publish is scheduled for ' + whenText(st.scheduled_at, tz))
  return parts.join('; ')
}

/** A menu by id or name; "Dinner (Ware)" picks between menus of the same name. */
function pickMenu(menus, text) {
  const exact = menus.filter(m => sameName(m.name, text))
  if (exact.length === 1) return exact[0]
  return pickByName(menus, text, menuLabel, 'menu', 'There are no menus yet. Make one with create_menu.')
}

/** Everything a plan needs: the menu loaded fresh, its save body, tags and option groups. */
async function loadForEdit(ctx, menuText) {
  const [menus, tags, groups] = await Promise.all([
    loadMenus(ctx),
    callApi(ctx, 'GET', '/api/menus/dietary/all'),
    callApi(ctx, 'GET', '/api/menus/variant-groups'),
  ])
  const m = pickMenu(menus, menuText)
  const full = await loadMenu(ctx, m.id)
  return { menus, menu: { ...m, ...full }, body: menuSaveBody(full), tags, groups }
}

function pickVenue(venues, text) {
  if (text == null) return null
  if (/^(all|company|every|none|no venue|all venues|company[- ]wide)$/i.test(String(text).trim())) return null
  return pickByName(venues, text, v => v.name, 'venue')
}

// ── Tags ───────────────────────────────────────────────────

// Words people use for the 14 allergens (shared/menuTags.js standard keys).
const ALLERGEN_WORDS = {
  soy: 'soya', soybean: 'soya', soybeans: 'soya', 'tree nut': 'nuts', 'tree nuts': 'nuts', nut: 'nuts',
  shellfish: 'crustaceans', crustacean: 'crustaceans', prawn: 'crustaceans', prawns: 'crustaceans',
  'sulphur dioxide': 'sulphites', sulfites: 'sulphites', sulphite: 'sulphites', sulfite: 'sulphites',
  wheat: 'gluten', dairy: 'milk', lactose: 'milk', 'sesame seeds': 'sesame', egg: 'eggs', peanut: 'peanuts',
  mollusc: 'molluscs', mollusk: 'molluscs', molluscs: 'molluscs', lupine: 'lupin',
}

/** The tag a name means, of the given kind (allergen | dietary), or null. */
function findTag(tags, text, kind) {
  const pool = tags.filter(t => (kind === 'allergen' ? t.kind === 'allergen' : t.kind !== 'allergen'))
  const raw = String(text ?? '').trim()
  const t = norm(raw)
  const key = kind === 'allergen' ? (ALLERGEN_WORDS[t] || t) : t
  return pool.find(g => g.code.toLowerCase() === raw.toLowerCase())
    ?? pool.find(g => g.standard_key && g.standard_key === key)
    ?? pool.find(g => sameName(g.label, raw) || sameName(g.label.replace(/\(.*?\)/g, ''), raw) || norm(g.label) === key)
    ?? null
}

function tagName(tags, code, level) {
  const t = tags.find(x => x.code === code)
  const name = t ? t.label : code
  return level && level !== 'contains' ? name + ' (' + LEVEL_TEXT[level] + ')' : name
}

/** A dish's tags as words: allergens with their level, then dietary. */
function dishTags(tags, item) {
  const allergens = [], dietary = []
  for (const code of item.dietary || []) {
    const t = tags.find(x => x.code === code)
    if (t?.kind === 'allergen') allergens.push(tagName(tags, code, item.allergen_levels?.[code]))
    else dietary.push(tagName(tags, code))
  }
  return { allergens, dietary }
}

/**
 * Applies allergen / dietary changes to a dish body. `set` replaces all of
 * that kind, `add` adds or changes a level, `remove` takes off. Unknown names
 * go to `unknown` (listed on the card; nothing is guessed).
 */
function applyTags(item, tags, kind, { set, add, remove }, unknown) {
  const isKind = code => {
    const t = tags.find(x => x.code === code)
    return kind === 'allergen' ? t?.kind === 'allergen' : t?.kind !== 'allergen'
  }
  let codes = [...(item.dietary || [])]
  const levels = { ...(item.allergen_levels || {}) }
  const resolve = entry => {
    const name = typeof entry === 'string' ? entry : entry.name
    const tag = findTag(tags, name, kind)
    if (!tag) { unknown.push(name); return null }
    return { tag, level: typeof entry === 'string' ? 'contains' : (entry.level || 'contains') }
  }
  if (set) {
    for (const c of codes.filter(isKind)) delete levels[c]
    codes = codes.filter(c => !isKind(c))
  }
  for (const entry of [...(set || []), ...(add || [])]) {
    const r = resolve(entry)
    if (!r) continue
    if (!codes.includes(r.tag.code)) codes.push(r.tag.code)
    if (kind === 'allergen' && r.level !== 'contains') levels[r.tag.code] = r.level
    else delete levels[r.tag.code]
  }
  for (const name of remove || []) {
    const tag = findTag(tags, name, kind)
    if (!tag) { unknown.push(name); continue }
    codes = codes.filter(c => c !== tag.code)
    delete levels[tag.code]
  }
  item.dietary = codes
  item.allergen_levels = levels
}

// ── Option groups ──────────────────────────────────────────

/**
 * Option groups for one plan. Existing groups come from the Variant groups
 * page; new ones are collected here (first prices given = the group's usual
 * prices) and made by run() before the menu is saved.
 */
function groupBook(groups) {
  const fresh = new Map() // norm name -> { id: 'new:...', name, price_mode, options: [{ id, label, price_pence }] }
  return {
    fresh,
    find(name) {
      return groups.find(g => sameName(g.name, name)) ?? fresh.get(norm(name)) ?? null
    },
    byId(id) {
      return groups.find(g => g.id === id) ?? [...fresh.values()].find(g => g.id === id) ?? null
    },
    make(name, mode) {
      const g = { id: 'new:' + randomUUID(), name: name.trim(), price_mode: mode || 'base', options: [], isNew: true }
      fresh.set(norm(name), g)
      return g
    },
  }
}

/**
 * Attaches / updates the dish's option groups from OptionsIn entries.
 * Returns words for the card.
 */
function applyOptions(item, entries, book, notes) {
  for (const o of entries) {
    let g = book.find(o.group)
    if (!g) g = book.make(o.group, o.mode)
    const isNewGroup = !!g.isNew
    let att = item.variant_groups.find(v => v.group_id === g.id)
    if (!att) {
      att = { group_id: g.id, sort_order: item.variant_groups.length, overrides: [] }
      item.variant_groups.push(att)
    }
    for (const c of o.choices || []) {
      let opt = g.options.find(x => sameName(x.label, c.name))
      if (!opt) {
        if (!isNewGroup) {
          throw new ToolError('The option group ' + g.name + ' has no "' + c.name + '" choice. It has: ' +
            (g.options.map(x => x.label).join(', ') || 'no choices') + '. Add it on the Variant groups page, or use one of those.', 422)
        }
        opt = { id: 'new:' + randomUUID(), label: c.name.trim(), price_pence: pence(c.price ?? 0) }
        g.options.push(opt)
      }
      if (c.price === undefined) continue
      const want = pence(c.price)
      att.overrides = att.overrides.filter(v => v.option_id !== opt.id)
      if (want !== opt.price_pence) att.overrides.push({ option_id: opt.id, price_pence: want })
    }
    notes.push(g.name + ': ' + optionText(g, att))
  }
}

/** "Chicken £12.50, Prawn £13.95" for a dish's attached group. */
function optionText(g, att) {
  if (!g) return 'unknown group'
  const over = new Map((att.overrides || []).map(o => [o.option_id, o.price_pence]))
  return g.options.map(o => o.label + ' ' + money(over.has(o.id) ? over.get(o.id) : o.price_pence)).join(', ') || 'no choices'
}

/** Groups attached to a loaded dish (loadMenuFull(): each option has this dish's price), in words. */
function dishOptions(item) {
  const out = (item.variant_groups || []).map(g => (g.name || 'Options') + ' (' + (g.price_mode === 'extra' ? 'extra' : 'choice') + '): ' +
    ((g.options || []).map(o => o.label + ' ' + money(o.price_pence)).join(', ') || 'no choices'))
  if (item.variants?.length) out.push('Options: ' + item.variants.map(v => v.label + ' ' + money(v.price_pence)).join(', '))
  return out
}

/** Makes the plan's new groups (run() only) and swaps their ids into the body. */
async function makeGroups(ctx, book, body) {
  if (!book.fresh.size) return []
  const ids = new Map()
  const made = []
  for (const g of book.fresh.values()) {
    const row = await callApi(ctx, 'POST', '/api/menus/variant-groups', {
      body: {
        name: g.name, price_mode: g.price_mode, min_select: g.price_mode === 'extra' ? 0 : 1,
        max_select: g.price_mode === 'extra' ? Math.max(1, g.options.length) : 1,
        options: g.options.map((o, i) => ({ label: o.label, price_pence: o.price_pence, sort_order: i })),
      },
    })
    ids.set(g.id, row.id)
    for (const o of g.options) {
      const real = row.options.find(x => x.label === o.label)
      if (real) ids.set(o.id, real.id)
    }
    made.push(g.name)
  }
  for (const s of body.sections) {
    for (const it of s.items) {
      for (const v of it.variant_groups) {
        if (ids.has(v.group_id)) v.group_id = ids.get(v.group_id)
        v.overrides = v.overrides.map(o => ({ ...o, option_id: ids.get(o.option_id) ?? o.option_id }))
      }
    }
  }
  return made
}

function newGroupWarnings(book, groups) {
  if (!book.fresh.size) return []
  return [...book.fresh.values()].map(g => 'New option group ' + g.name + ' (' +
    g.options.map(o => o.label + ' ' + money(o.price_pence)).join(', ') + ')' +
    (groups.length ? '. Existing groups: ' + groups.map(x => x.name).join(', ') : ''))
}

// ── Dishes and sections in a body ──────────────────────────

function newItem(name) {
  return {
    id: randomUUID(), kind: 'dish', kitchen_name: null, pos_course_id: null, pos_colour: null, combo: null,
    name: name.trim(), native_name: null, description: null, price_pence: null, calories: null, notes: null,
    is_featured: false, image_url: null, sort_order: 0, is_orderable: true,
    tax: { rate: null, rules: [] }, min_order_qty: null,
    variants: [], variant_groups: [], dietary: [], allergen_levels: {},
  }
}

function newSection(title, subtitle) {
  return {
    id: randomUUID(), title: title.trim(), subtitle: subtitle || null, highlight: false, image_url: null, sort_order: 0,
    print_break_before: 'none', print_keep_together: false, tax: { rate: null, rules: [] },
    visibility: 'show', pos_course_id: null, pos_colour: null, items: [],
  }
}

function findSection(body, text) {
  return body.sections.find(s => sameName(s.title, text)) ?? null
}

function pickSection(body, text) {
  return findSection(body, text) ?? pickByName(body.sections, text, s => s.title, 'section', 'This menu has no sections yet.')
}

/** A dish by name: exact name first (any section, or `sectionText`), then pickByName. */
function pickDish(body, text, sectionText) {
  const sections = sectionText ? [pickSection(body, sectionText)] : body.sections
  const all = sections.flatMap(s => s.items.map(it => ({ it, s })))
  const exact = all.filter(x => sameName(x.it.name, text))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) {
    throw new ToolError('"' + text + '" is in more than one section: ' + exact.map(x => x.s.title).join(', ') + '. Which section?', 409)
  }
  const rows = all.map(x => ({ id: x.it.id, x, label: x.it.name + ' (' + x.s.title + ')' }))
  return pickByName(rows, text, r => r.label, 'dish', 'This menu has no dishes yet.').x
}

/** Applies DishFields to a dish body; returns "Field: before → after" lines. */
function applyFields(item, input) {
  const lines = []
  const set = (key, field, label, fmt = show) => {
    if (input[key] === undefined) return
    const before = item[field]
    const after = key === 'price' ? pence(input[key]) : input[key]
    if (before === after || (before == null && after == null)) return
    item[field] = after
    lines.push(label + ': ' + fmt(before) + ' → ' + fmt(after))
  }
  set('native_name', 'native_name', 'Original name')
  set('description', 'description', 'Description', v => (v ? '"' + String(v).slice(0, 80) + (String(v).length > 80 ? '...' : '') + '"' : 'none'))
  set('price', 'price_pence', 'Price', money)
  set('calories', 'calories', 'Calories', v => (v == null ? 'none' : v + ' kcal'))
  set('notes', 'notes', 'Note')
  set('orderable', 'is_orderable', 'Online ordering', v => (v === false ? 'off' : 'on'))
  set('featured', 'is_featured', 'House favourite', v => (v ? 'yes' : 'no'))
  return lines
}

/** Builds a new dish body from DishIn. */
function buildDish(d, { tags, book, unknown }) {
  const item = newItem(d.name)
  applyFields(item, d)
  const notes = []
  applyTags(item, tags, 'allergen', { set: d.allergens || [] }, unknown)
  applyTags(item, tags, 'dietary', { set: d.dietary || [] }, unknown)
  applyOptions(item, d.options || [], book, notes)
  return { item, notes }
}

function dishLine(item, tags, book) {
  const { allergens, dietary } = dishTags(tags, item)
  const opts = item.variant_groups.map(v => {
    const g = book.byId(v.group_id)
    return g ? optionText(g, v) : null
  }).filter(Boolean)
  return item.name + ', ' + (item.price_pence != null ? money(item.price_pence) : opts.length ? opts.join('; ') : 'no price') +
    (allergens.length ? '; allergens: ' + allergens.join(', ') : '') + (dietary.length ? '; ' + dietary.join(', ') : '')
}

/** Every dish id still on the menu, for meal deals that point at removed ones. */
function comboRefs(body, goneIds) {
  const out = []
  for (const s of body.sections) {
    for (const it of s.items) {
      if (it.kind !== 'combo' || !it.combo?.slots) continue
      if (it.combo.slots.some(sl => (sl.item_ids || []).some(id => goneIds.has(id)) || (sl.section_ids || []).some(id => goneIds.has(id)))) out.push(it.name)
    }
  }
  return out
}

/** Saves a body; sections and dishes are numbered in the order they are in (new ones were added at 0). */
async function saveBody(ctx, menuId, body) {
  const sections = body.sections.map((s, si) => ({ ...s, sort_order: si, items: s.items.map((it, ii) => ({ ...it, sort_order: ii })) }))
  return callApi(ctx, 'PATCH', '/api/menus/' + menuId, { body: { ...body, sections } })
}

function slugify(name, taken) {
  const base = norm(name).replace(/ /g, '-').slice(0, 55).replace(/-+$/, '') || 'menu'
  let slug = base
  for (let n = 2; taken.has(slug); n++) slug = base + '-' + n
  return slug
}

// ── Price rules ────────────────────────────────────────────

function priceRule(p, { mode, value }, { round_to = 1, round = 'nearest' } = {}) {
  if (p == null) return null
  let raw
  if (mode === 'percent') raw = p * (1 + value / 100)
  else if (mode === 'amount') raw = p + value * 100
  else raw = value * 100
  raw = Math.round(raw * 10000) / 10000
  const step = round_to || 1
  const f = round === 'up' ? Math.ceil : round === 'down' ? Math.floor : Math.round
  return Math.max(0, f(raw / step) * step)
}

// ── Plans ──────────────────────────────────────────────────

/** add_dishes / create_menu sections: returns card lines and the counts. */
function planAddSections(body, sectionsIn, { tags, book, unknown, updateExisting }) {
  const lines = []
  let added = 0, updated = 0, skipped = 0, newSections = 0
  const skippedNames = []
  for (const sIn of sectionsIn) {
    let sec = findSection(body, sIn.section)
    const isNew = !sec
    if (isNew) {
      sec = newSection(sIn.section, sIn.subtitle)
      body.sections.push(sec)
      newSections++
    } else if (sIn.subtitle !== undefined && sIn.subtitle !== sec.subtitle) {
      sec.subtitle = sIn.subtitle || null
    }
    lines.push(sec.title + (isNew ? ' (new section)' : '') + ':')
    if (!sIn.dishes.length) lines.push('  (no dishes)')
    for (const d of sIn.dishes) {
      const existing = sec.items.find(it => sameName(it.name, d.name))
      if (existing) {
        if (!updateExisting) { skipped++; skippedNames.push(d.name + ' (' + sec.title + ')'); continue }
        const notes = applyFields(existing, d)
        if (d.allergens) applyTags(existing, tags, 'allergen', { set: d.allergens }, unknown)
        if (d.dietary) applyTags(existing, tags, 'dietary', { set: d.dietary }, unknown)
        if (d.options) applyOptions(existing, d.options, book, [])
        updated++
        lines.push('  ~ ' + dishLine(existing, tags, book) + (notes.length ? ' (' + notes.join('; ') + ')' : ''))
        continue
      }
      const { item } = buildDish(d, { tags, book, unknown })
      sec.items.push(item)
      added++
      lines.push('  + ' + dishLine(item, tags, book))
    }
  }
  return { lines, added, updated, skipped, skippedNames, newSections }
}

function addWarnings({ unknown, book, groups, skippedNames, body }) {
  const w = []
  if (unknown.length) w.push('Not recognised, so left off: ' + [...new Set(unknown)].join(', ') + '. Check the tag names (get_menu lists them) or add them on Menus > Allergens & dietary.')
  w.push(...newGroupWarnings(book, groups))
  if (skippedNames.length) w.push('Already on the menu, left as they are: ' + skippedNames.slice(0, 15).join(', ') + (skippedNames.length > 15 ? ' and more' : '') + ' (update_existing: true changes them).')
  const noPrice = body.sections.flatMap(s => s.items.filter(it => it.price_pence == null && !it.variant_groups.length && it.kind !== 'combo').map(it => it.name))
  if (noPrice.length) w.push('No price: ' + noPrice.slice(0, 15).join(', ') + (noPrice.length > 15 ? ' and more' : ''))
  return w
}

// ── Tools ──────────────────────────────────────────────────

export const menuTools = [
  {
    name: 'list_menus',
    title: 'List menus',
    description:
      'Lists the menus (from the Menus page) with the venue they belong to (or all venues), whether they are shown to ' +
      'guests, whether their latest changes are published (live) or still in the draft, any scheduled publish, and ' +
      'how many sections and dishes the draft has.',
    input: z.object({ venue: z.string().max(200).optional().describe('Venue name or id; leave out for all') }),
    readOnly: true,
    async run(ctx, input) {
      await requireRead(ctx)
      const venues = await tenantVenues(ctx)
      const venue = input.venue ? pickVenue(venues, input.venue) : null
      const counts = await withTenant(ctx.tenantId, tx => tx`
        SELECT m.id, count(DISTINCT s.id)::int AS sections, count(i.id)::int AS dishes
          FROM menus m
          LEFT JOIN menu_sections s ON s.menu_id = m.id
          LEFT JOIN menu_items i ON i.section_id = s.id
         WHERE m.tenant_id = ${ctx.tenantId}
         GROUP BY m.id
      `)
      const byId = new Map(counts.map(c => [c.id, c]))
      const menus = (await callApi(ctx, 'GET', '/api/menus?status=1')).filter(m => !venue || !m.venue_id || m.venue_id === venue.id)
      const tz = await menuTz(ctx, venue?.id)
      return {
        menus: menus.map(m => ({
          menu_id: m.id, name: m.name, venue: m.venue_name || 'all venues',
          shown_to_guests: !!m.is_published, publish: publishText(m.publish, tz),
          sections: byId.get(m.id)?.sections ?? 0, dishes: byId.get(m.id)?.dishes ?? 0,
          ...(m.tagline ? { tagline: m.tagline } : {}), ...(m.service_times ? { service_times: m.service_times } : {}),
        })),
      }
    },
  },

  {
    name: 'get_menu',
    title: 'Show a menu',
    description:
      'One menu in full: its sections (and where each shows) and dishes with price or option prices, allergens with ' +
      'their level (contains, may contain, can be removed), dietary tags, calories, and whether they can be ordered ' +
      'online. Descriptions come with details: true or when one section is asked for. Also lists the tags and option ' +
      'groups that exist, to use with the change tools. Shows the draft (what the change tools edit) unless ' +
      'version: "live" (what guests and the till see now).',
    input: z.object({
      menu:    z.string().min(1).max(200).describe('Menu name or id'),
      section: z.string().max(120).optional().describe('Only this section'),
      details: z.boolean().optional().describe('Include descriptions and notes'),
      version: z.enum(['draft', 'live']).optional().describe('draft (default) or live'),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireRead(ctx)
      const [menus, groups] = await Promise.all([callApi(ctx, 'GET', '/api/menus?status=1'), callApi(ctx, 'GET', '/api/menus/variant-groups')])
      const m = pickMenu(menus, input.menu)
      const live = input.version === 'live'
      const full = live ? await loadLive(ctx, m.id) : await loadMenu(ctx, m.id)
      if (!full) throw new ToolError(menuLabel(m) + ' has never been published, so nothing is live. Leave version out to see the draft.', 404)
      const tz = await menuTz(ctx, m.venue_id)
      const tags = full.dietary_tags || []
      let sections = full.sections || []
      if (input.section) {
        const s = findSection({ sections }, input.section) ?? pickByName(sections, input.section, x => x.title, 'section')
        sections = [s]
      }
      const details = input.details || !!input.section
      return {
        menu_id: full.id, name: full.name, venue: m.venue_name || 'all venues',
        version: live ? 'live (what guests see)' : 'draft (what the change tools edit)',
        publish: publishText(m.publish, tz), shown_to_guests: !!full.is_published,
        ...(full.tagline ? { tagline: full.tagline } : {}), ...(full.service_times ? { service_times: full.service_times } : {}),
        sections: sections.map(s => ({
          section: s.title, ...(s.subtitle ? { subtitle: s.subtitle } : {}),
          ...(s.visibility && s.visibility !== 'show' ? { shows: VIS_TEXT[s.visibility] } : {}),
          dishes: (s.items || []).map(it => {
            const t = dishTags(tags, it)
            const opts = dishOptions(it)
            return {
              name: it.name,
              ...(it.kind === 'combo' ? { meal_deal: true } : {}),
              price: it.price_pence != null ? money(it.price_pence) : (opts.length ? 'by option' : 'no price'),
              ...(opts.length ? { options: opts } : {}),
              ...(t.allergens.length ? { allergens: t.allergens } : {}),
              ...(t.dietary.length ? { dietary: t.dietary } : {}),
              ...(it.calories != null ? { calories: it.calories } : {}),
              ...(it.is_orderable === false ? { online_ordering: 'off' } : {}),
              ...(it.is_featured ? { featured: true } : {}),
              ...(details && it.description ? { description: it.description } : {}),
              ...(details && it.notes ? { note: it.notes } : {}),
              ...(details && it.native_name ? { original_name: it.native_name } : {}),
            }
          }),
        })),
        allergen_tags: tags.filter(t => t.kind === 'allergen').map(t => t.label),
        dietary_tags: tags.filter(t => t.kind !== 'allergen').map(t => t.label),
        option_groups: groups.map(g => g.name + ' (' + (g.price_mode === 'extra' ? 'extra' : 'choice') + ': ' +
          (g.options || []).map(o => o.label + ' ' + money(o.price_pence)).join(', ') + ')'),
      }
    },
  },

  {
    name: 'find_dishes',
    title: 'Find dishes',
    description:
      'Finds dishes across menus by name (search), and/or by tags: has (dishes with all of these allergens or dietary ' +
      'tags) and free_from (dishes without these allergens; a dish where the allergen can be removed on request is ' +
      'included, marked "ask for it without"; "may contain" counts as having it). Searches the live menus (what ' +
      'guests are served) shown to guests, unless include_unpublished (also menus hidden from guests, and drafts of ' +
      'menus never published) or version: "draft". Use it for allergy questions.',
    input: z.object({
      search:    z.string().max(200).optional(),
      has:       z.array(z.string().min(1).max(60)).max(10).optional(),
      free_from: z.array(z.string().min(1).max(60)).max(14).optional(),
      menu:      z.string().max(200).optional().describe('Only this menu'),
      include_unpublished: z.boolean().optional(),
      version:   z.enum(['live', 'draft']).optional().describe('live (default) or draft'),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireRead(ctx)
      if (!input.search && !input.has?.length && !input.free_from?.length) {
        throw new ToolError('Give a search, has or free_from.', 400)
      }
      const [menus, tags] = await Promise.all([loadMenus(ctx), callApi(ctx, 'GET', '/api/menus/dietary/all')])
      const pool = input.menu ? [pickMenu(menus, input.menu)] : menus
      const useDraft = input.version === 'draft'
      const want = name => findTag(tags, name, 'allergen') ?? findTag(tags, name, 'dietary')
      const unknown = []
      const has = (input.has || []).map(n => want(n) ?? (unknown.push(n), null)).filter(Boolean)
      const free = (input.free_from || []).map(n => findTag(tags, n, 'allergen') ?? (unknown.push(n), null)).filter(Boolean)
      if (unknown.length) {
        throw new ToolError('No tag called ' + unknown.join(', ') + '. Tags: ' + tags.map(t => t.label).join(', ') + '.', 404)
      }
      const words = norm(input.search || '').split(' ').filter(Boolean)
      const hits = []
      let looked = 0
      for (const m of pool) {
        if (looked >= 20) break
        let full = useDraft ? await loadMenu(ctx, m.id) : await loadLive(ctx, m.id)
        if (!full && (input.menu || input.include_unpublished)) full = await loadMenu(ctx, m.id)
        if (!full) continue
        if (!full.is_published && !input.menu && !input.include_unpublished) continue
        looked++
        for (const s of full.sections || []) {
          for (const it of s.items || []) {
            const hay = norm(it.name + ' ' + (it.native_name || '') + ' ' + (it.description || ''))
            if (words.length && !words.every(w => hay.includes(w))) continue
            const codes = it.dietary || []
            if (!has.every(t => codes.includes(t.code))) continue
            let ask = []
            const blocked = free.some(t => {
              if (!codes.includes(t.code)) return false
              if (it.allergen_levels?.[t.code] === 'removable') { ask.push(t.label); return false }
              return true
            })
            if (blocked) continue
            const tg = dishTags(tags, it)
            hits.push({
              name: it.name, menu: menuLabel(m), section: s.title,
              price: it.price_pence != null ? money(it.price_pence) : (it.variant_groups?.length || it.variants?.length) ? 'by option' : 'no price',
              ...(tg.allergens.length ? { allergens: tg.allergens } : {}),
              ...(tg.dietary.length ? { dietary: tg.dietary } : {}),
              ...(ask.length ? { ask_for_it_without: ask } : {}),
              ...(s.visibility === 'hidden' ? { section_hidden: true } : {}),
              ...(full.version === 'draft' && !useDraft ? { not_published: true } : {}),
            })
          }
        }
      }
      return {
        matched: hits.length,
        ...(hits.length > 60 ? { showing: 60, note: 'Narrow the search to see the rest.' } : {}),
        dishes: hits.slice(0, 60),
        searched: useDraft ? 'drafts' : 'live menus',
        note_on_allergens: 'From the allergen tags on the ' + (useDraft ? 'draft' : 'live') + ' menus. Always check with the kitchen for a serious allergy.',
      }
    },
  },

  // ── Changes ──
  {
    name: 'create_menu',
    title: 'Create a menu',
    description:
      'Makes a new menu, for one venue or all venues, optionally with its sections and dishes in the same call: use ' +
      'this to build a menu from a photo, PDF or list the staff member gives you (up to 400 dishes). Dishes take a ' +
      'price, or options (an option group with a price per choice), allergens with their level, dietary tags, ' +
      'calories and a description. The new menu is a draft: not live anywhere until published with publish_menu. ' +
      'shown_to_guests (default off) is whether it shows to guests once published.',
    input: z.object({
      name:          z.string().min(1).max(120),
      venue:         z.string().max(200).optional().describe('Venue name or id; leave out for all venues'),
      published:     z.boolean().optional(),
      tagline:       z.string().max(200).optional(),
      service_times: z.string().max(200).optional().describe('e.g. "Tue-Sat 6pm-10.30pm"'),
      intro_line:    z.string().max(2000).optional(),
      sections:      z.array(SectionIn).max(40).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireEdit(ctx)
      const p = await planCreate(ctx, input)
      return {
        title: 'Create the menu ' + input.name + '?',
        lines: cut([
          (p.venue ? p.venue.name : 'All venues') + ', ' + (input.published ? 'shown to guests once published' : 'hidden from guests') + '; not live until published',
          ...(input.tagline ? ['Tagline: ' + input.tagline] : []),
          ...(input.service_times ? ['Served: ' + input.service_times] : []),
          ...(p.add ? [plural(p.add.added, 'dish', 'dishes') + ' in ' + plural(p.body.sections.length, 'section'), ...p.add.lines] : ['No sections yet']),
        ]),
        ...warn(p.warnings),
        confirmLabel: 'Create menu',
      }
    },
    async run(ctx, input) {
      await requireEdit(ctx)
      const p = await planCreate(ctx, input)
      return audited(ctx, 'create_menu', summariseInput(input), async () => {
        const groups = await makeGroups(ctx, p.book, p.body)
        const row = await callApi(ctx, 'POST', '/api/menus', { body: p.meta })
        try {
          if (p.body.sections.length) await saveBody(ctx, row.id, { ...p.meta, sections: p.body.sections, callouts: [] })
        } catch (err) {
          await callApi(ctx, 'DELETE', '/api/menus/' + row.id).catch(() => {})
          throw err
        }
        return {
          menu_id: row.id, name: row.name, venue: p.venue?.name ?? 'all venues', shown_to_guests: !!row.is_published, live: false,
          sections: p.body.sections.length, dishes: p.add?.added ?? 0,
          ...(groups.length ? { new_option_groups: groups } : {}),
          message: 'Menu made as a draft. It isn\'t live anywhere until it is published: check it on the Menus page, then publish it (publish_menu, or Publish on the Menus page).',
        }
      })
    },
  },

  {
    name: 'update_menu',
    title: 'Change a menu',
    description: 'Renames a menu, moves it to a venue (or all venues), shows it to guests or hides it (published), or ' +
      'changes its tagline, service times or intro line. Saved to the draft: it reaches guests when the menu is published (publish_menu).',
    input: z.object({
      menu:          z.string().min(1).max(200),
      name:          z.string().min(1).max(120).optional(),
      venue:         z.string().max(200).optional().describe('Venue name, or "all venues"'),
      published:     z.boolean().optional().describe('Shown to guests (website, online ordering, the till) once published'),
      tagline:       z.string().max(200).nullable().optional(),
      service_times: z.string().max(200).nullable().optional(),
      intro_line:    z.string().max(2000).nullable().optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireEdit(ctx)
      const p = await planUpdateMenu(ctx, input)
      return {
        title: 'Change the menu ' + menuLabel(p.menu) + '?',
        lines: p.lines,
        ...(input.published === false ? warn(['Once published, it comes off the website, online ordering and the till.']) : {}),
        confirmLabel: 'Save',
      }
    },
    async run(ctx, input) {
      await requireEdit(ctx)
      const p = await planUpdateMenu(ctx, input)
      return audited(ctx, 'update_menu', input, async () => {
        const saved = await saveBody(ctx, p.menu.id, p.body)
        return { menu_id: saved.id, name: saved.name, shown_to_guests: !!saved.is_published, changes: p.lines, message: SAVED }
      })
    },
  },

  {
    name: 'duplicate_menu',
    title: 'Copy a menu',
    description: 'Copies a menu (its draft) with all its sections, dishes, footer notes and print designs. The copy is hidden from guests and not live until published.',
    input: z.object({
      menu: z.string().min(1).max(200),
      name: z.string().min(1).max(120).optional().describe('Name for the copy (default "<name> (copy)")'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireEdit(ctx)
      const m = pickMenu(await loadMenus(ctx), input.menu)
      return {
        title: 'Copy ' + menuLabel(m) + '?',
        lines: ['The copy: ' + (input.name || m.name + ' (copy)') + ', hidden from guests, not live until published'],
        confirmLabel: 'Copy',
      }
    },
    async run(ctx, input) {
      await requireEdit(ctx)
      const m = pickMenu(await loadMenus(ctx), input.menu)
      return audited(ctx, 'duplicate_menu', input, async () => {
        let copy = await callApi(ctx, 'POST', '/api/menus/' + m.id + '/duplicate')
        if (input.name) {
          const full = await loadMenu(ctx, copy.id)
          copy = await saveBody(ctx, copy.id, { ...menuSaveBody(full), name: input.name })
        }
        return { menu_id: copy.id, name: copy.name, shown_to_guests: false, live: false, message: 'Copied. The copy is a draft, not live until published.' }
      })
    },
  },

  {
    name: 'add_dishes',
    title: 'Add dishes',
    description:
      'Adds dishes to a menu, in sections already on it or new ones (a section with no dishes just adds the section). ' +
      'Each dish: name, price or options (option group + a price per choice), allergens with level, dietary tags, ' +
      'calories, description. A dish with the same name already in that section is left alone unless update_existing.',
    input: z.object({
      menu:            z.string().min(1).max(200),
      sections:        z.array(SectionIn).min(1).max(40),
      update_existing: z.boolean().optional().describe('Change dishes already there with the details given'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireEdit(ctx)
      const p = await planAdd(ctx, input)
      if (!p.add.added && !p.add.updated && !p.add.newSections) throw new ToolError('Nothing to add: every dish is already on the menu.', 422)
      return {
        title: 'Add to ' + menuLabel(p.menu) + '?',
        lines: cut([
          [p.add.added && plural(p.add.added, 'new dish', 'new dishes'), p.add.updated && plural(p.add.updated, 'dish', 'dishes') + ' changed',
            p.add.newSections && plural(p.add.newSections, 'new section')].filter(Boolean).join(', '),
          ...p.add.lines,
        ]),
        ...warn(p.warnings),
        confirmLabel: 'Add',
      }
    },
    async run(ctx, input) {
      await requireEdit(ctx)
      const p = await planAdd(ctx, input)
      return audited(ctx, 'add_dishes', summariseInput(input), async () => {
        const groups = await makeGroups(ctx, p.book, p.body)
        await saveBody(ctx, p.menu.id, p.body)
        return {
          menu: menuLabel(p.menu), added: p.add.added, changed: p.add.updated, skipped: p.add.skipped, new_sections: p.add.newSections,
          ...(groups.length ? { new_option_groups: groups } : {}), message: SAVED,
        }
      })
    },
  },

  {
    name: 'update_dish',
    title: 'Change a dish',
    description:
      'Changes one dish: name, original name, description, price, calories, note, online ordering on/off, house ' +
      'favourite; allergens (allergens replaces them all; add_allergens adds or changes a level; remove_allergens), ' +
      'dietary tags the same way; options (attach or reprice an option group: a price per choice for this dish; ' +
      'remove_options takes groups off); move to another section. Name the section when the dish is in more than one.',
    input: z.object({
      menu:             z.string().min(1).max(200),
      dish:             Name,
      section:          z.string().max(120).optional().describe('The section it is in'),
      name:             z.string().min(1).max(200).optional().describe('New name'),
      ...DishFields,
      allergens:        z.array(AllergenIn).max(30).optional(),
      add_allergens:    z.array(AllergenIn).max(30).optional(),
      remove_allergens: z.array(z.string().min(1).max(60)).max(30).optional(),
      dietary:          z.array(z.string().min(1).max(60)).max(20).optional(),
      add_dietary:      z.array(z.string().min(1).max(60)).max(20).optional(),
      remove_dietary:   z.array(z.string().min(1).max(60)).max(20).optional(),
      options:          z.array(OptionsIn).max(6).optional(),
      remove_options:   z.array(z.string().min(1).max(80)).max(6).optional(),
      move_to_section:  z.string().max(120).optional().describe('Another section of the same menu (a new title makes it)'),
      position:         z.enum(['first', 'last']).optional().describe('Where in its section'),
      after_dish:       z.string().max(200).optional().describe('Put it after this dish'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireEdit(ctx)
      const p = await planUpdateDish(ctx, input)
      if (!p.lines.length) throw new ToolError('Nothing to change: the dish already has those details.', 422)
      return {
        title: 'Change ' + p.label + '?',
        lines: p.lines,
        ...warn([
          ...(p.allergensChanged ? ['Allergens change: this shows on the website, printed menus, online ordering, the allergen lookup and the till. Check it is right.'] : []),
          ...(p.bigPrice ? ['The price changes by more than half: check it is right.'] : []),
          ...(p.unknown.length ? ['Not recognised, so left off: ' + [...new Set(p.unknown)].join(', ') + '.'] : []),
          ...newGroupWarnings(p.book, p.groups),
        ]),
        confirmLabel: 'Save',
      }
    },
    async run(ctx, input) {
      await requireEdit(ctx)
      const p = await planUpdateDish(ctx, input)
      return audited(ctx, 'update_dish', input, async () => {
        const groups = await makeGroups(ctx, p.book, p.body)
        await saveBody(ctx, p.menu.id, p.body)
        return { menu: menuLabel(p.menu), dish: p.item.name, changes: p.lines, ...(groups.length ? { new_option_groups: groups } : {}), message: SAVED }
      })
    },
  },

  {
    name: 'remove_dishes',
    title: 'Remove dishes',
    description: 'Takes dishes off a menu for good. To stop selling one online for now, use update_dish with orderable: false instead.',
    input: z.object({
      menu:    z.string().min(1).max(200),
      dishes:  z.array(Name).min(1).max(100),
      section: z.string().max(120).optional().describe('The section they are in, when a name is in more than one'),
    }),
    confirm: true,
    destructive: true,
    async describe(ctx, input) {
      await requireEdit(ctx)
      const p = await planRemoveDishes(ctx, input)
      return {
        title: 'Remove ' + plural(p.gone.length, 'dish', 'dishes') + ' from ' + menuLabel(p.menu) + '?',
        lines: cut(p.gone.map(x => x.it.name + ' (' + x.s.title + ')')),
        ...warn([
          'Gone from the website, online ordering, printed menus and the till.',
          ...(p.combos.length ? ['Meal deals that offer them: ' + p.combos.join(', ') + '. Change those on the Menus page.'] : []),
        ]),
        confirmLabel: 'Remove',
      }
    },
    async run(ctx, input) {
      await requireEdit(ctx)
      const p = await planRemoveDishes(ctx, input)
      return audited(ctx, 'remove_dishes', input, async () => {
        await saveBody(ctx, p.menu.id, p.body)
        return { menu: menuLabel(p.menu), removed: p.gone.map(x => x.it.name), message: REMOVED }
      })
    },
  },

  {
    name: 'update_section',
    title: 'Change a section',
    description:
      'Renames a section or changes its subtitle, where it shows (show = everywhere; website_hidden = printed menus ' +
      'only; hidden = nowhere), its tax rate (by name, e.g. Standard or Zero; used for dishes without their own; ' +
      'exceptions for order types are set on the Menus page), or moves it (position first/last, or after_section). ' +
      'New sections are made with add_dishes.',
    input: z.object({
      menu:          z.string().min(1).max(200),
      section:       z.string().min(1).max(120),
      title:         z.string().min(1).max(120).optional(),
      subtitle:      z.string().max(120).nullable().optional(),
      visibility:    Visibility.optional(),
      tax_rate:      z.string().max(60).nullable().optional().describe('A tax rate by name (Menus > Tax rates); null = the menu\'s'),
      position:      z.enum(['first', 'last']).optional(),
      after_section: z.string().max(120).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireEdit(ctx)
      const p = await planUpdateSection(ctx, input)
      if (!p.lines.length) throw new ToolError('Nothing to change.', 422)
      return {
        title: 'Change the section ' + p.title + ' in ' + menuLabel(p.menu) + '?',
        lines: p.lines,
        ...(input.visibility && input.visibility !== 'show' ? warn(['Its ' + plural(p.sec.items.length, 'dish', 'dishes') + ' won\'t show on the website or online ordering' + (input.visibility === 'hidden' ? ', or in print' : '') + '.']) : {}),
        confirmLabel: 'Save',
      }
    },
    async run(ctx, input) {
      await requireEdit(ctx)
      const p = await planUpdateSection(ctx, input)
      return audited(ctx, 'update_section', input, async () => {
        await saveBody(ctx, p.menu.id, p.body)
        return { menu: menuLabel(p.menu), section: p.sec.title, changes: p.lines, message: SAVED }
      })
    },
  },

  {
    name: 'remove_section',
    title: 'Remove a section',
    description: 'Takes a section and all its dishes off a menu for good. To hide it instead, use update_section with visibility.',
    input: z.object({ menu: z.string().min(1).max(200), section: z.string().min(1).max(120) }),
    confirm: true,
    destructive: true,
    async describe(ctx, input) {
      await requireEdit(ctx)
      const p = await planRemoveSection(ctx, input)
      return {
        title: 'Remove ' + p.sec.title + ' from ' + menuLabel(p.menu) + '?',
        lines: cut([plural(p.sec.items.length, 'dish', 'dishes') + ' go with it:', ...p.sec.items.map(it => '  ' + it.name)]),
        ...warn([
          'Gone from the website, online ordering, printed menus and the till.',
          ...(p.combos.length ? ['Meal deals that offer them: ' + p.combos.join(', ') + '.'] : []),
        ]),
        confirmLabel: 'Remove',
      }
    },
    async run(ctx, input) {
      await requireEdit(ctx)
      const p = await planRemoveSection(ctx, input)
      return audited(ctx, 'remove_section', input, async () => {
        await saveBody(ctx, p.menu.id, p.body)
        return { menu: menuLabel(p.menu), removed_section: p.sec.title, removed_dishes: p.sec.items.length, message: REMOVED }
      })
    },
  },

  {
    name: 'change_prices',
    title: 'Change prices',
    description:
      'Changes prices on a menu: the whole menu, some sections, or named dishes. change: percent (e.g. 5 = up 5%, -10 ' +
      '= down 10%), amount (pounds added, e.g. 0.5 or -0.25) or set (one price for every dish named). Rounds to ' +
      'round_to pence (up, nearest or down). With include_options (default on) the dishes\' option prices change ' +
      'too, as this dish\'s own prices: the option groups themselves are not changed. set changes dish prices only.',
    input: z.object({
      menu:     z.string().min(1).max(200),
      sections: z.array(z.string().min(1).max(120)).max(40).optional(),
      dishes:   z.array(Name).max(200).optional(),
      change:   z.object({ mode: z.enum(['percent', 'amount', 'set']), value: z.number().min(-100).max(10000) }),
      ...Rounding,
      include_options: z.boolean().optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireEdit(ctx)
      const p = await planPrices(ctx, input)
      if (!p.changes.length) throw new ToolError('No prices change' + (p.skipped.length ? ' (' + p.skipped.join(', ') + ' have no dish price)' : '') + '.', 422)
      return {
        title: 'Change the prices of ' + plural(p.changes.length, 'dish', 'dishes') + ' on ' + menuLabel(p.menu) + '?',
        lines: cut(p.changes),
        ...warn(p.skipped.length ? ['No dish price, so not changed: ' + p.skipped.slice(0, 15).join(', ') + (p.skipped.length > 15 ? ' and more' : '')] : []),
        confirmLabel: 'Change prices',
      }
    },
    async run(ctx, input) {
      await requireEdit(ctx)
      const p = await planPrices(ctx, input)
      return audited(ctx, 'change_prices', input, async () => {
        await saveBody(ctx, p.menu.id, p.body)
        return { menu: menuLabel(p.menu), prices_changed: p.changes.length, message: SAVED }
      })
    },
  },

  // ── Publishing ──
  {
    name: 'publish_menu',
    title: 'Publish a menu',
    description:
      'Puts a menu\'s draft live: the website, online ordering, the till, Deliveroo and cooking checks switch to it. ' +
      'Now, or at a set date and time (venue local) for a planned price or menu change. The card lists what changes ' +
      'compared with the live menu. Ask before publishing: changes are only published when the staff member wants.',
    input: z.object({
      menu: z.string().min(1).max(200).describe('Menu name or id'),
      date: DateStr.optional().describe('Go live on this date (YYYY-MM-DD); leave date and time out for now'),
      time: TimeStr.optional().describe('Go live at this time (HH:MM); with no date, today'),
      note: z.string().max(200).optional().describe('What this publish is, e.g. "New prices from April"'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireEdit(ctx)
      const p = await planPublish(ctx, input)
      return {
        title: 'Publish ' + menuLabel(p.menu) + (p.at ? ' on ' + whenText(p.at, p.tz) : ' now') + '?',
        lines: cut([
          p.status.live ? 'Changes from the live menu:' : 'Not published before: the whole menu goes live.',
          ...(p.status.live ? p.status.changes.map(c => c.text) : []),
          ...(input.note ? ['Note: ' + input.note] : []),
        ]),
        ...warn(p.warnings),
        confirmLabel: p.at ? 'Schedule' : 'Publish now',
      }
    },
    async run(ctx, input) {
      await requireEdit(ctx)
      const p = await planPublish(ctx, input)
      return audited(ctx, 'publish_menu', input, async () => {
        const r = await callApi(ctx, 'POST', '/api/menus/' + p.menu.id + '/publish', {
          body: { at: p.at ? new Date(p.at).toISOString() : null, note: input.note || null },
        })
        const when = whenText(r.release.goes_live_at, p.tz)
        return {
          menu: menuLabel(p.menu), goes_live: r.immediate ? 'now' : when, changes: p.status.live ? p.status.changes.length : null,
          message: r.immediate
            ? 'Published. Guests, the till and Deliveroo now get this version (open tills update within a few seconds).'
            : 'Scheduled for ' + when + '. Until then the live menu stays as it is; later draft changes are not included unless published again.',
        }
      })
    },
  },

  {
    name: 'cancel_menu_publish',
    title: 'Cancel a scheduled publish',
    description: 'Withdraws a menu publish scheduled for later, before it goes live. The draft is not changed.',
    input: z.object({
      menu: z.string().min(1).max(200),
      date: DateStr.optional().describe('The date of the scheduled publish, when there is more than one'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireEdit(ctx)
      const p = await planCancelPublish(ctx, input)
      return {
        title: 'Cancel the publish of ' + menuLabel(p.menu) + ' on ' + whenText(p.release.goes_live_at, p.tz) + '?',
        lines: [p.release.note ? 'Note: ' + p.release.note : 'The live menu stays as it is.'],
        confirmLabel: 'Cancel publish',
      }
    },
    async run(ctx, input) {
      await requireEdit(ctx)
      const p = await planCancelPublish(ctx, input)
      return audited(ctx, 'cancel_menu_publish', input, async () => {
        await callApi(ctx, 'DELETE', '/api/menus/' + p.menu.id + '/releases/' + p.release.id)
        return { menu: menuLabel(p.menu), cancelled: whenText(p.release.goes_live_at, p.tz), message: 'Cancelled. The live menu stays as it is.' }
      })
    },
  },
]

async function planPublish(ctx, input) {
  if (input.date && !input.time) throw new ToolError('Give a time to go live as well as the date.', 400)
  const m = pickMenu(await loadMenus(ctx), input.menu)
  const tz = await menuTz(ctx, m.venue_id)
  let at = null
  if (input.time) {
    const date = input.date || localParts(new Date(), tz).date
    at = await zonedInstant(date, input.time, tz)
    if (new Date(at) <= new Date(Date.now() + 30_000)) {
      if (input.date) throw new ToolError(whenText(at, tz) + ' has passed. Leave date and time out to publish now.', 422)
      throw new ToolError(input.time + ' today has passed. Give a date, or leave the time out to publish now.', 422)
    }
    if (new Date(at) - Date.now() > 400 * 86_400_000) throw new ToolError('Pick a time within the next year.', 422)
  }
  const status = await callApi(ctx, 'GET', '/api/menus/' + m.id + '/publish')
  if (status.in_sync) throw new ToolError('Nothing to publish: the live menu already matches the draft.', 422)
  const warnings = []
  const full = await loadMenu(ctx, m.id)
  if (!full.is_published) warnings.push('Shown to guests is off, so it stays hidden from guests (the till and the website); turn it on with update_menu first if it should show.')
  for (const s of status.scheduled || []) {
    if (!at || new Date(s.goes_live_at) > new Date(at)) {
      warnings.push('A publish is already scheduled for ' + whenText(s.goes_live_at, tz) + '. It still goes live then and replaces this one (cancel it with cancel_menu_publish if it is out of date).')
    }
  }
  const prices = status.changes.filter(c => c.kind === 'price' || c.kind === 'options').length
  if (prices) warnings.push(plural(prices, 'price change') + ': check them before guests see them.')
  return { menu: m, tz, at, status, warnings }
}

async function planCancelPublish(ctx, input) {
  const m = pickMenu(await loadMenus(ctx), input.menu)
  const tz = await menuTz(ctx, m.venue_id)
  const status = await callApi(ctx, 'GET', '/api/menus/' + m.id + '/publish')
  let list = status.scheduled || []
  if (!list.length) throw new ToolError(menuLabel(m) + ' has no scheduled publish.', 404)
  if (input.date) list = list.filter(r => localParts(r.goes_live_at, tz).date === input.date)
  if (!list.length) throw new ToolError('No publish of ' + menuLabel(m) + ' is scheduled on ' + input.date + '.', 404)
  if (list.length > 1) {
    throw new ToolError('Several publishes are scheduled: ' + list.map(r => whenText(r.goes_live_at, tz)).join('; ') + '. Say which date.', 409)
  }
  return { menu: m, tz, release: list[0] }
}

const warn = list => (list.length ? { warningTitle: 'Check', warnings: list } : {})

/** Big inputs (a whole menu read from a photo) are audited as counts. */
function summariseInput(input) {
  const sections = input.sections || []
  return {
    ...Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'sections')),
    sections: sections.map(s => ({ section: s.section, dishes: s.dishes.length })),
  }
}

// ── Plan functions (shared by describe and run) ────────────

async function planCreate(ctx, input) {
  const [menus, venues, tags, groups] = await Promise.all([
    loadMenus(ctx), tenantVenues(ctx), callApi(ctx, 'GET', '/api/menus/dietary/all'), callApi(ctx, 'GET', '/api/menus/variant-groups'),
  ])
  const venue = input.venue ? pickVenue(venues, input.venue) : null
  const scope = menus.filter(m => (m.venue_id ?? null) === (venue?.id ?? null))
  if (scope.some(m => sameName(m.name, input.name))) {
    throw new ToolError('There is already a menu called ' + input.name + (venue ? ' for ' + venue.name : '') + '. Add to it with add_dishes, or pick another name.', 409)
  }
  const meta = {
    name: input.name.trim(), slug: slugify(input.name, new Set(scope.map(m => m.slug))), venue_id: venue?.id ?? null,
    tagline: input.tagline ?? null, service_times: input.service_times ?? null, intro_line: input.intro_line ?? null,
    is_published: !!input.published, sort_order: menus.length,
  }
  const body = { sections: [] }
  const book = groupBook(groups)
  const unknown = []
  const total = (input.sections || []).reduce((n, s) => n + s.dishes.length, 0)
  if (total > 400) throw new ToolError('That is ' + total + ' dishes: send up to 400, then add the rest with add_dishes.', 422)
  const add = input.sections?.length ? planAddSections(body, input.sections, { tags, book, unknown }) : null
  const warnings = add ? addWarnings({ unknown, book, groups, skippedNames: add.skippedNames, body }) : []
  return { meta, venue, body, book, add, warnings }
}

async function planUpdateMenu(ctx, input) {
  const { menu, body } = await loadForEdit(ctx, input.menu)
  const lines = []
  const set = (key, label, value) => {
    if (value === undefined) return
    const v = value === '' ? null : value
    if ((body[key] ?? null) === (v ?? null)) return
    lines.push(label + ': ' + show(body[key]) + ' → ' + show(v))
    body[key] = v
  }
  set('name', 'Name', input.name)
  set('tagline', 'Tagline', input.tagline)
  set('service_times', 'Served', input.service_times)
  set('intro_line', 'Intro line', input.intro_line)
  if (input.published !== undefined && input.published !== body.is_published) {
    lines.push(input.published ? 'Show it to guests (website, online ordering, the till) once published' : 'Hide it from guests once published')
    body.is_published = input.published
  }
  if (input.venue !== undefined) {
    const venue = pickVenue(await tenantVenues(ctx), input.venue)
    if ((venue?.id ?? null) !== (body.venue_id ?? null)) {
      lines.push('Venue: ' + (menu.venue_name || 'all venues') + ' → ' + (venue?.name || 'all venues'))
      body.venue_id = venue?.id ?? null
    }
  }
  if (!lines.length) throw new ToolError('Nothing to change.', 422)
  return { menu, body, lines }
}

async function planAdd(ctx, input) {
  const { menu, body, tags, groups } = await loadForEdit(ctx, input.menu)
  const total = input.sections.reduce((n, s) => n + s.dishes.length, 0)
  if (total > 400) throw new ToolError('That is ' + total + ' dishes: send up to 400 at a time.', 422)
  const book = groupBook(groups)
  const unknown = []
  const add = planAddSections(body, input.sections, { tags, book, unknown, updateExisting: !!input.update_existing })
  return { menu, body, book, add, warnings: addWarnings({ unknown, book, groups, skippedNames: add.skippedNames, body: { sections: body.sections.filter(s => input.sections.some(x => sameName(x.section, s.title))) } }) }
}

async function planUpdateDish(ctx, input) {
  const { menu, body, tags, groups } = await loadForEdit(ctx, input.menu)
  const { it: item, s: from } = pickDish(body, input.dish, input.section)
  const label = item.name + ' (' + from.title + ')'
  const book = groupBook(groups)
  const lines = []
  const unknown = []
  if (input.name && input.name.trim() !== item.name) {
    if (from.items.some(x => x !== item && sameName(x.name, input.name))) throw new ToolError(from.title + ' already has a dish called ' + input.name + '.', 409)
    lines.push('Name: ' + item.name + ' → ' + input.name.trim())
    item.name = input.name.trim()
  }
  const oldPrice = item.price_pence
  lines.push(...applyFields(item, input))
  const bigPrice = oldPrice > 0 && item.price_pence != null && Math.abs(item.price_pence - oldPrice) / oldPrice > 0.5
  const before = dishTags(tags, item)
  applyTags(item, tags, 'allergen', { set: input.allergens, add: input.add_allergens, remove: input.remove_allergens }, unknown)
  applyTags(item, tags, 'dietary', { set: input.dietary, add: input.add_dietary, remove: input.remove_dietary }, unknown)
  const after = dishTags(tags, item)
  const allergensChanged = before.allergens.join('|') !== after.allergens.join('|')
  if (allergensChanged) lines.push('Allergens: ' + (before.allergens.join(', ') || 'none') + ' → ' + (after.allergens.join(', ') || 'none'))
  if (before.dietary.join('|') !== after.dietary.join('|')) lines.push('Dietary: ' + (before.dietary.join(', ') || 'none') + ' → ' + (after.dietary.join(', ') || 'none'))
  if (input.options?.length) {
    const beforeOpts = item.variant_groups.map(v => JSON.stringify(v)).join('|')
    const notes = []
    applyOptions(item, input.options, book, notes)
    if (item.variant_groups.map(v => JSON.stringify(v)).join('|') !== beforeOpts) lines.push(...notes.map(n => 'Options ' + n))
  }
  for (const name of input.remove_options || []) {
    const g = book.find(name)
    const had = g && item.variant_groups.some(v => v.group_id === g.id)
    if (!had) throw new ToolError(item.name + ' has no ' + name + ' options.', 404)
    item.variant_groups = item.variant_groups.filter(v => v.group_id !== g.id)
    lines.push('Options: ' + g.name + ' taken off')
  }
  // Move
  let to = from
  if (input.move_to_section && !sameName(input.move_to_section, from.title)) {
    to = findSection(body, input.move_to_section)
    if (!to) { to = newSection(input.move_to_section); body.sections.push(to); lines.push('New section ' + to.title) }
    if (to.items.some(x => sameName(x.name, item.name))) throw new ToolError(to.title + ' already has a dish called ' + item.name + '.', 409)
    lines.push('Moves from ' + from.title + ' to ' + to.title)
  }
  if (to !== from || input.position || input.after_dish) {
    const oldIndex = from.items.indexOf(item)
    from.items.splice(oldIndex, 1)
    let at = to.items.length
    if (input.position === 'first') at = 0
    if (input.after_dish) {
      const ref = to.items.find(x => sameName(x.name, input.after_dish)) ?? pickByName(to.items, input.after_dish, x => x.name, 'dish in ' + to.title)
      at = to.items.indexOf(ref) + 1
    }
    to.items.splice(at, 0, item)
    if (to === from && at !== oldIndex) lines.push('Moves to ' + (at === 0 ? 'the top' : at >= to.items.length - 1 ? 'the bottom' : 'after ' + to.items[at - 1].name) + ' of ' + to.title)
  }
  return { menu, body, item, label, lines, unknown, book, groups, allergensChanged, bigPrice }
}

async function planRemoveDishes(ctx, input) {
  const { menu, body } = await loadForEdit(ctx, input.menu)
  const gone = []
  for (const name of input.dishes) {
    const x = pickDish(body, name, input.section)
    if (!gone.some(g => g.it === x.it)) gone.push(x)
  }
  const ids = new Set(gone.map(x => x.it.id))
  for (const s of body.sections) s.items = s.items.filter(it => !ids.has(it.id))
  return { menu, body, gone, combos: comboRefs(body, ids) }
}

async function planUpdateSection(ctx, input) {
  const { menu, body } = await loadForEdit(ctx, input.menu)
  const sec = pickSection(body, input.section)
  const title = sec.title
  const lines = []
  if (input.title && input.title.trim() !== sec.title) {
    if (body.sections.some(s => s !== sec && sameName(s.title, input.title))) throw new ToolError('There is already a section called ' + input.title + '.', 409)
    lines.push('Title: ' + sec.title + ' → ' + input.title.trim())
    sec.title = input.title.trim()
  }
  if (input.subtitle !== undefined && (input.subtitle || null) !== (sec.subtitle || null)) {
    lines.push('Subtitle: ' + show(sec.subtitle) + ' → ' + show(input.subtitle))
    sec.subtitle = input.subtitle || null
  }
  if (input.visibility && input.visibility !== sec.visibility) {
    lines.push('Shows: ' + VIS_TEXT[sec.visibility] + ' → ' + VIS_TEXT[input.visibility])
    sec.visibility = input.visibility
  }
  if (input.tax_rate !== undefined) {
    const { rates } = await callApi(ctx, 'GET', '/api/tax-rates')
    const active = rates.filter(r => r.is_active)
    const rate = input.tax_rate == null ? null : pickByName(active, input.tax_rate, r => r.name, 'tax rate')
    const tax = { rate: sec.tax?.rate ?? null, rules: sec.tax?.rules || [] }
    if ((rate?.id ?? null) !== tax.rate) {
      const label = id => (id ? (rates.find(r => r.id === id)?.name || 'a removed rate') + ' ' + (rates.find(r => r.id === id)?.rate ?? '') + '%' : 'the menu\'s rate')
      lines.push('Tax: ' + label(tax.rate) + ' → ' + label(rate?.id ?? null))
      sec.tax = { ...tax, rate: rate?.id ?? null }
    }
  }
  if (input.position || input.after_section) {
    const old = body.sections.indexOf(sec)
    body.sections.splice(old, 1)
    let at = input.position === 'first' ? 0 : body.sections.length
    if (input.after_section) {
      const ref = pickSection(body, input.after_section)
      at = body.sections.indexOf(ref) + 1
    }
    body.sections.splice(at, 0, sec)
    if (at !== old) lines.push('Moves to ' + (at === 0 ? 'the top of the menu' : at === body.sections.length - 1 ? 'the end of the menu' : 'after ' + body.sections[at - 1].title))
  }
  return { menu, body, sec, title, lines }
}

async function planRemoveSection(ctx, input) {
  const { menu, body } = await loadForEdit(ctx, input.menu)
  const sec = pickSection(body, input.section)
  body.sections = body.sections.filter(s => s !== sec)
  const ids = new Set([sec.id, ...sec.items.map(it => it.id)])
  return { menu, body, sec, combos: comboRefs(body, ids) }
}

async function planPrices(ctx, input) {
  const { menu, body, groups } = await loadForEdit(ctx, input.menu)
  let targets
  if (input.dishes?.length) {
    targets = input.dishes.map(n => pickDish(body, n))
  } else {
    const secs = input.sections?.length ? input.sections.map(t => pickSection(body, t)) : body.sections
    targets = secs.flatMap(s => s.items.map(it => ({ it, s })))
  }
  if (input.change.mode === 'set' && input.change.value < 0) throw new ToolError('A price can\'t be below zero.', 422)
  const withOptions = input.change.mode !== 'set' && input.include_options !== false
  const changes = [], skipped = []
  const seen = new Set()
  for (const { it } of targets) {
    if (seen.has(it.id) || it.kind === 'combo' && it.price_pence == null) continue
    seen.add(it.id)
    const parts = []
    if (it.price_pence != null) {
      const np = priceRule(it.price_pence, input.change, input)
      if (np !== it.price_pence) { parts.push(money(it.price_pence) + ' → ' + money(np)); it.price_pence = np }
    } else if (!withOptions || !it.variant_groups.length) {
      skipped.push(it.name)
    }
    if (withOptions) {
      for (const v of it.variant_groups) {
        const g = groups.find(x => x.id === v.group_id)
        if (!g) continue
        for (const o of g.options || []) {
          const cur = v.overrides.find(x => x.option_id === o.id)?.price_pence ?? o.price_pence
          if (!cur) continue
          const np = priceRule(cur, input.change, input)
          if (np === cur) continue
          v.overrides = v.overrides.filter(x => x.option_id !== o.id)
          if (np !== o.price_pence) v.overrides.push({ option_id: o.id, price_pence: np })
          parts.push(o.label + ' ' + money(cur) + ' → ' + money(np))
        }
      }
      for (const v of it.variants || []) {
        if (!v.price_pence) continue
        const np = priceRule(v.price_pence, input.change, input)
        if (np !== v.price_pence) { parts.push(v.label + ' ' + money(v.price_pence) + ' → ' + money(np)); v.price_pence = np }
      }
    }
    if (parts.length) changes.push(it.name + ': ' + parts.join(', '))
  }
  return { menu, body, changes, skipped }
}

