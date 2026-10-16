// shared/menuDiff.js
//
// Menu publishing (migration 165): what a release holds, and what changed
// between the live version of a menu and its draft. Plain ESM, no
// dependencies; used by the API (services/menuReleases.js) and the admin.
//
//   releaseContent(full)  the part of a loaded menu (routes/menus.js
//                         loadMenuFull()) that a release keeps. Tenant-wide
//                         things stay live and are left out: the tag list,
//                         the allergen notice, print designs and which one
//                         prints, timestamps.
//   contentKey(content)   a stable string of that content, so two versions
//                         can be compared (key order, tag order and
//                         null-vs-missing don't count as changes).
//   diffMenus(live, draft) the changes, as short lines a person can read:
//                         [{ kind, text }], kind one of menu | section |
//                         added | removed | price | options | dish | notes.

const MENU_DROP = new Set([
  'dietary_tags', 'allergen_notice', 'design_count', 'designs', 'print_design_id',
  'created_at', 'updated_at', 'needs_first_release', 'venue_name',
  // print page extras (loadPrintMenu)
  'tenant_name', 'logo_url', 'primary_colour', 'site_fonts', 'address_line1', 'postcode', 'phone',
  // added by the live loader
  'release_id', 'release_goes_live_at', 'version',
])
const ROW_DROP = new Set(['created_at', 'updated_at'])
const SORT_DROP = new Set(['sort_order'])
const VARIANT_DROP = new Set(['id', 'item_id', 'tenant_id', 'created_at', 'updated_at'])

function dropKeys(obj, drop) {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) if (!drop.has(k)) out[k] = v
  return out
}

/** The release part of a loaded menu (see the file comment). */
export function releaseContent(full) {
  if (!full) return null
  const menu = dropKeys(full, MENU_DROP)
  menu.sections = (full.sections || []).map(s => ({
    ...dropKeys(s, ROW_DROP),
    items: (s.items || []).map(i => ({
      ...dropKeys(i, ROW_DROP),
      // One-off options get new ids on every save (upsertMenuTree), so
      // their ids aren't content; label, price and order are.
      ...(i.variants ? { variants: i.variants.map(v => dropKeys(v, VARIANT_DROP)) } : {}),
    })),
  }))
  menu.callouts = (full.callouts || []).map(c => dropKeys(c, ROW_DROP))
  return menu
}

// Rows in these lists are compared by position: their sort_order numbers
// only say the same thing again (a save renumbers them 0, 1, 2...).
const ORDERED_LISTS = new Set(['sections', 'items', 'callouts', 'variants', 'options', 'variant_groups'])

function canon(v, key) {
  if (v === null || v === undefined) return undefined
  if (Array.isArray(v)) {
    const rows = ORDERED_LISTS.has(key)
      ? v.map(x => (x && typeof x === 'object' && !Array.isArray(x) ? dropKeys(x, SORT_DROP) : x))
      : v
    const arr = rows.map(x => canon(x)).filter(x => x !== undefined)
    // A dish's tag codes follow the tenant's tag order, which isn't menu content.
    return key === 'dietary' ? [...arr].sort() : arr
  }
  if (typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) {
      const c = canon(v[k], k)
      if (c !== undefined) out[k] = c
    }
    return out
  }
  // numeric columns come back as strings from postgres; '20.00' and 20 are the same rate
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && /(vat_rate|price|calories|qty)/.test(key || '')) return Number(v)
  return v
}

/** A stable string of release content: equal strings = nothing to publish. */
export function contentKey(content) {
  return JSON.stringify(canon(releaseContent(content)))
}

const money = p => (p == null ? 'no price' : '£' + (Number(p) / 100).toFixed(2))

const MENU_FIELDS = {
  name: 'Name', slug: 'Web address', venue_id: 'Venue', tagline: 'Tagline', service_times: 'Service times',
  intro_line: 'Intro', is_published: 'Shown to guests', sort_order: 'Order',
  hide_zero_priced_variants: 'Hide £0 options', hide_unpriced_variants: 'Hide unpriced options',
  print_columns: 'Print columns', print_orientation: 'Print orientation', print_paper_size: 'Paper size',
  print_hide_variant_group_headers: 'Print option headers', print_settings: 'Print settings',
}
const SECTION_FIELDS = {
  subtitle: 'subtitle', highlight: 'highlight', image_url: 'image', visibility: 'where it shows',
  print_break_before: 'print break', print_keep_together: 'keep together',
  vat_rate_takeaway: 'takeaway VAT', vat_rate_eat_in: 'eat-in VAT', pos_course_id: 'till course', pos_colour: 'till colour',
}
const DISH_FIELDS = {
  native_name: 'second name', description: 'description', calories: 'calories', notes: 'notes',
  is_featured: 'house favourite', image_url: 'photo', is_orderable: 'online ordering',
  vat_rate_takeaway: 'takeaway VAT', vat_rate_eat_in: 'eat-in VAT', min_order_qty: 'minimum quantity',
  kind: 'meal deal', kitchen_name: 'kitchen name', pos_course_id: 'till course', pos_colour: 'till colour',
  combo: 'meal deal choices', dietary: 'allergens and dietary', allergen_levels: 'allergen levels',
}
const VISIBILITY = { show: 'everywhere', website_hidden: 'print only', hidden: 'nowhere' }

const same = (a, b, key) => JSON.stringify(canon(a, key) ?? null) === JSON.stringify(canon(b, key) ?? null)

function optionPrices(item) {
  const out = {}
  for (const v of item.variants || []) out['v:' + v.label] = v.price_pence
  for (const g of item.variant_groups || []) {
    for (const o of g.options || []) out[g.group_id + ':' + o.option_id] = o.price_pence
  }
  return out
}

/**
 * What changed from `live` to `draft` (both loadMenuFull()-shaped, or
 * release content). `live` null = never published: one line saying so.
 */
export function diffMenus(live, draft, { limit = 300 } = {}) {
  const changes = []
  const add = (kind, text) => { if (changes.length < limit) changes.push({ kind, text }) }
  if (!draft) return [{ kind: 'removed', text: 'Menu deleted' }]
  if (!live) return [{ kind: 'menu', text: 'Not published yet: the whole menu goes live' }]

  for (const [k, label] of Object.entries(MENU_FIELDS)) {
    if (same(live[k], draft[k], k)) continue
    if (k === 'is_published') add('menu', draft.is_published ? 'Menu shown to guests' : 'Menu hidden from guests')
    else if (k === 'name') add('menu', `Name: ${live.name} → ${draft.name}`)
    else add('menu', `${label} changed`)
  }

  const liveSections = new Map((live.sections || []).map(s => [s.id, s]))
  const draftSections = new Map((draft.sections || []).map(s => [s.id, s]))
  const liveItems = new Map()
  const draftItems = new Map()
  for (const s of live.sections || []) for (const i of s.items || []) liveItems.set(i.id, { ...i, _section: s.title })
  for (const s of draft.sections || []) for (const i of s.items || []) draftItems.set(i.id, { ...i, _section: s.title })

  for (const s of draft.sections || []) {
    const was = liveSections.get(s.id)
    if (!was) { add('section', `Section added: ${s.title}`); continue }
    if (was.title !== s.title) add('section', `Section renamed: ${was.title} → ${s.title}`)
    const fields = Object.entries(SECTION_FIELDS).filter(([k]) => !same(was[k], s[k], k))
    if (fields.some(([k]) => k === 'visibility')) add('section', `${s.title}: shows ${VISIBILITY[s.visibility] || s.visibility}`)
    const rest = fields.filter(([k]) => k !== 'visibility').map(([, l]) => l)
    if (rest.length) add('section', `${s.title}: ${rest.join(', ')} changed`)
  }
  for (const s of live.sections || []) if (!draftSections.has(s.id)) add('section', `Section removed: ${s.title}`)
  const liveOrder = (live.sections || []).filter(s => draftSections.has(s.id)).map(s => s.id).join()
  const draftOrder = (draft.sections || []).filter(s => liveSections.has(s.id)).map(s => s.id).join()
  if (liveOrder !== draftOrder) add('section', 'Sections reordered')

  for (const [id, it] of draftItems) {
    const was = liveItems.get(id)
    if (!was) { add('added', `Added ${it.name} (${it._section})${it.price_pence != null ? ' ' + money(it.price_pence) : ''}`); continue }
    if (was.name !== it.name) add('dish', `Renamed: ${was.name} → ${it.name}`)
    if (!same(was.price_pence, it.price_pence, 'price_pence')) add('price', `${it.name}: ${money(was.price_pence)} → ${money(it.price_pence)}`)
    if (!same(optionPrices(was), optionPrices(it), 'price_pence') ||
        !same((was.variant_groups || []).map(g => g.group_id), (it.variant_groups || []).map(g => g.group_id))) {
      add('options', `${it.name}: options or option prices changed`)
    }
    if (was._section !== it._section) add('dish', `${it.name}: moved to ${it._section}`)
    const fields = Object.entries(DISH_FIELDS).filter(([k]) => !same(was[k], it[k], k)).map(([, l]) => l)
    if (fields.length) add('dish', `${it.name}: ${[...new Set(fields)].join(', ')} changed`)
  }
  for (const [id, it] of liveItems) if (!draftItems.has(id)) add('removed', `Removed ${it.name} (${it._section})`)

  if (!same((live.callouts || []).map(c => [c.kind, c.title, c.body]), (draft.callouts || []).map(c => [c.kind, c.title, c.body]))) {
    add('notes', 'Footer notes changed')
  }
  // Anything else (e.g. dish order inside a section)
  if (!changes.length && contentKey(live) !== contentKey(draft)) add('dish', 'Dish order or other details changed')
  return changes
}
