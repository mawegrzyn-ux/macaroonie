// shared/combos.js
//
// Combos (meal deals, migration 171). ONE set of rules, used by:
//   - the till (shared/pos/pricing.js priceItem, the till's step flow,
//     automatic combos on a check);
//   - online ordering (shared/orderPricing.js priceBasket on the server
//     and on the guest page, served as /order-api/combos.js);
//   - the website menu, printed menus and menu screens (the "from" price
//     and the steps shown on a screen).
// Plain ESM, no dependencies, no DOM.
//
// A combo is a menu item with kind 'combo'. Its price (menu_items.price_pence,
// may be 0) is the deal's price; menu_items.combo holds the steps:
//
//   { mode: 'manual' | 'auto',
//     steps: [{
//       id, name,
//       min, max,         // how many to choose; min 0 = optional
//       repeat,           // the same choice may be picked more than once
//       auto,             // only one choice: it is picked for the guest
//       ask,              // 'always' | 'button': an optional step waits behind a button
//       when,             // null, or { step_id, option_ids }: shown only when that
//                         // earlier step has one of these picked (empty = anything)
//       display,          // kiosks (migration 172): 'grid' | 'list' | 'slider' |
//                         // 'wheel', null = the kiosk design's default
//       pick_photo,       // kiosks (migration 201): 'split' | 'corner', where the
//                         // picks' pictures go on the combo's photo (stored only when set)
//       pick_scale,       // kiosks (migration 205): corner pictures' size, a share
//                         // of the photo's width (stored only when set; null = automatic)
//       options: [{
//         id, type: 'item' | 'section' | 'custom',
//         item_id,        // type item: a menu item
//         section_id,     // type section: every item of that section
//         label, kitchen_name,   // type custom: typed in for this combo
//         image_url, description, // type custom: shown on kiosks (a dish shows its own)
//         photo_url,      // kiosks, any type: the picture on the combo's split
//                         // photo (none = image_url / the dish's photo; stored only when set)
//         groups,         // types item and section: the picked dish's option groups
//                         // in this deal, one group at a time (stored only when set):
//                         // { [groupKey]: { use, option_ids, group_id, min, max } },
//                         // see dealChoices()
//         price_pence,    // extra charge for this choice (0 = included)
//       }],
//     }] }
//
// A guest's / staff member's picks (selection.combo):
//   { [stepId]: [{ option_id, item_id, choices }] }
// item_id is the menu item picked (a section option's dish), null for a
// custom choice; choices are that item's own options, in the shape of the
// engine pricing it (the till's priceChoices or online's priceLine), as the
// deal asks them (dealChoices()).
//
// Manual combos start from the combo's own button. Automatic ones are also
// found among separate items on an order (findAutoCombos): the items stay
// as they were entered and the order is repriced as the combo.

export const COMBO_MODES = ['manual', 'auto']
export const STEP_ASK = ['always', 'button']
export const OPTION_TYPES = ['item', 'section', 'custom']
// How a kiosk shows a step's choices or an option group (shared/kiosk.js).
export const STEP_DISPLAYS = ['grid', 'list', 'slider', 'wheel']
// How big a pick's picture is small in the corner of the dish's photo on
// kiosks: a share of the photo's width, in %. Option groups
// (menu_variant_groups.kiosk_pick_scale) and combo steps (pick_scale) set it;
// null = automatic (about a quarter, smaller when several share the corner).
export const PICK_SCALE_MIN = 10
export const PICK_SCALE_MAX = 70
/** A corner picture size as stored (a whole % in range), or null. */
export const pickScale = v => {
  const n = Number(v)
  return v != null && v !== '' && Number.isInteger(n) && n >= PICK_SCALE_MIN && n <= PICK_SCALE_MAX ? n : null
}
export const MAX_STEPS = 12
export const MAX_PICKS = 20
// How a deal asks a picked dish's option group (dealChoices()): as on the
// dish ('all', perhaps with its own how many), not at all ('off'), only some
// options ('only'), or another group from the library instead ('swap').
export const DEAL_USES = ['all', 'off', 'only', 'swap']
export const DEAL_GROUPS_MAX = 20

const asList = v => (Array.isArray(v) ? v : [])
const int = (v, d) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d)
const pence = v => Math.max(0, int(v, 0))

/** A combo with every default filled in and limits clamped. */
export function normaliseCombo(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const steps = asList(c.steps).slice(0, MAX_STEPS).map((s, i) => {
    const max = Math.max(1, Math.min(MAX_PICKS, int(s.max, 1)))
    const min = Math.max(0, Math.min(max, int(s.min, 1)))
    const when = s.when && s.when.step_id ? { step_id: String(s.when.step_id), option_ids: asList(s.when.option_ids).map(String) } : null
    return {
      id: String(s.id || 'step-' + i),
      name: String(s.name || '').trim() || 'Choice ' + (i + 1),
      min, max,
      repeat: !!s.repeat,
      auto: s.auto !== false,
      ask: s.ask === 'button' && min === 0 ? 'button' : 'always',
      when,
      display: STEP_DISPLAYS.includes(s.display) ? s.display : null,
      pick_photo: s.pick_photo === 'split' || s.pick_photo === 'corner' ? s.pick_photo : null,
      pick_scale: pickScale(s.pick_scale),
      options: asList(s.options).map((o, j) => {
        const type = OPTION_TYPES.includes(o.type) ? o.type : 'item'
        const groups = type === 'custom' ? null : normaliseDealGroups(o.groups)
        return {
          id: String(o.id || 'opt-' + i + '-' + j),
          type,
          item_id: o.item_id || null,
          section_id: o.section_id || null,
          label: o.label ? String(o.label) : null,
          kitchen_name: o.kitchen_name ? String(o.kitchen_name) : null,
          image_url: o.image_url ? String(o.image_url).slice(0, 2000) : null,
          ...(o.photo_url ? { photo_url: String(o.photo_url).slice(0, 2000) } : {}),
          ...(groups ? { groups } : {}),
          description: o.description ? String(o.description).slice(0, 300) : null,
          price_pence: pence(o.price_pence),
        }
      }).filter(o => (o.type === 'item' ? o.item_id : o.type === 'section' ? o.section_id : o.label)),
    }
  })
  // A condition can only look back at an earlier step.
  const seen = new Set()
  for (const s of steps) {
    if (s.when && !seen.has(s.when.step_id)) s.when = null
    seen.add(s.id)
  }
  return { mode: c.mode === 'auto' ? 'auto' : 'manual', steps }
}

export function isCombo(item) {
  return !!item && item.kind === 'combo'
}

/** The normalised combo of an item (cached on the object). */
export function comboOf(item) {
  if (!isCombo(item)) return null
  if (!item._combo) Object.defineProperty(item, '_combo', { value: normaliseCombo(item.combo), enumerable: false, configurable: true })
  return item._combo
}

/**
 * Sections' items: { sectionId: [itemId, ...] } from menus
 * ([{ sections: [{ id, items: [{ id }] | item_ids }] }]).
 */
export function sectionItemsOf(menus) {
  const out = {}
  for (const m of asList(menus)) {
    for (const s of asList(m.sections)) {
      const ids = s.item_ids ? asList(s.item_ids) : asList(s.items).map(i => i.id)
      out[s.id] = [...new Set([...(out[s.id] || []), ...ids])]
    }
  }
  return out
}

/** A menu's dishes for combo lookups: { itemsById, sectionItems } (menu = { sections: [{ id, items }] }). */
export function menuCtx(menu) {
  const itemsById = {}
  for (const s of asList(menu && menu.sections)) for (const i of asList(s.items)) itemsById[i.id] = i.section_id ? i : { ...i, section_id: s.id }
  return { itemsById, sectionItems: sectionItemsOf([menu]) }
}

/**
 * The choices a step offers, one per pickable thing:
 *   [{ key, option_id, item_id, section_id, label, kitchen_name, price_pence,
 *      image_url, photo_url, description, item, sold_out, groups }]
 * groups: the changes the deal makes to the dish's option groups (null = as
 * on the dish), for dealChoices().
 * ctx: { itemsById, sectionItems, soldOut(itemId), selfId }. A dish that
 * isn't in itemsById (not on this till / not offered) is left out, and so
 * are combos (a combo can't be part of a combo).
 */
export function stepChoices(step, ctx = {}) {
  const items = ctx.itemsById || {}
  const out = []
  const seen = new Set()
  const addItem = (o, id) => {
    const it = items[id]
    if (!it || isCombo(it) || id === ctx.selfId) return
    const key = o.type === 'section' ? o.id + ':' + id : o.id
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      key, option_id: o.id, item_id: id, section_id: it.section_id ?? null,
      label: it.name, kitchen_name: it.kitchen_name || null, price_pence: o.price_pence,
      image_url: it.image_url || null, photo_url: o.photo_url || null, description: it.description || null,
      item: it, sold_out: !!(it.sold_out || (ctx.soldOut && ctx.soldOut(id))), groups: o.groups || null,
    })
  }
  for (const o of step.options) {
    if (o.type === 'item') addItem(o, o.item_id)
    else if (o.type === 'section') for (const id of asList(ctx.sectionItems?.[o.section_id])) addItem(o, id)
    else {
      out.push({
        key: o.id, option_id: o.id, item_id: null, section_id: null, label: o.label, kitchen_name: o.kitchen_name || null,
        price_pence: o.price_pence, image_url: o.image_url || null, photo_url: o.photo_url || null, description: o.description || null, item: null, sold_out: false,
        groups: null,
      })
    }
  }
  return out
}

/**
 * Every dish a combo can hold, over all its steps whatever is picked (sold
 * out ones too): what an allergen list must cover for the combo.
 */
export function comboItemIds(item, ctx = {}) {
  const combo = comboOf(item)
  if (!combo) return []
  const ids = new Set()
  for (const step of combo.steps) for (const c of stepChoices(step, { ...ctx, soldOut: null, selfId: item.id })) if (c.item_id) ids.add(c.item_id)
  return [...ids]
}

const choiceFor = (choices, e) => choices.find(c => c.option_id === e.option_id && (c.item_id || null) === (e.item_id || null))

/** Is a step shown, given the picks so far? */
function stepShown(step, picks, shown) {
  if (!step.when) return true
  if (!shown.has(step.when.step_id)) return false
  const got = asList(picks[step.when.step_id])
  if (!got.length) return false
  const want = step.when.option_ids
  return !want.length || got.some(e => want.includes(e.option_id))
}

/**
 * Walk the steps in order with the picks: drops picks on hidden steps and
 * fills steps that pick themselves (one choice, at least one needed, auto
 * on). Returns { picks, steps: [{ step, choices, shown, auto }] }.
 */
export function resolveSteps(item, picks = {}, ctx = {}) {
  const combo = comboOf(item)
  const out = {}
  const shown = new Set()
  const steps = []
  for (const step of combo ? combo.steps : []) {
    const choices = stepChoices(step, { ...ctx, selfId: item.id })
    if (!stepShown(step, out, shown)) { steps.push({ step, choices, shown: false, auto: false }); continue }
    shown.add(step.id)
    let got = asList(picks[step.id]).filter(e => e && choiceFor(choices, e))
    const open = choices.filter(c => !c.sold_out)
    const auto = step.auto && step.min > 0 && open.length === 1 && (step.repeat || step.min === 1)
    if (auto && got.length < step.min) {
      const c = open[0]
      const keep = got.filter(e => e.option_id === c.option_id && (e.item_id || null) === c.item_id)
      while (keep.length < step.min) keep.push({ option_id: c.option_id, item_id: c.item_id, choices: {} })
      got = keep
    }
    out[step.id] = got
    steps.push({ step, choices, shown: true, auto })
  }
  return { picks: out, steps }
}

// ── A picked dish's options in the deal ─────────────────────────
// A dish offered in a step (a dish choice, or every dish of a section) may
// be asked differently in the deal than on its own. The choice's `groups`
// change the dish's option groups one group at a time, keyed by the group
// (its library id, or 'variants' for a dish's own ad-hoc options):
//   'off'   the group isn't asked in this deal (the deal has its own Dips
//           step, so the wings' dip question goes)
//   'only'  just these options (option_ids): the flavours in the deal
//   'swap'  another group from the library is asked instead (group_id),
//           typically a copy edited for the deal (fewer options, deal prices)
//   'all'   as on the dish, with the deal's own how many
// min / max (null = the group's own) say how many to choose, for every use
// but 'off' ("2 flavours in the meal"). prices (option id -> pence) are the
// deal's own extra charges for the options it asks ("Large +£2.00 in the
// meal", "Atomic +£0.50"): with any set the group is asked as extras, each
// option at its deal price, an option without one at its own extra charge
// (an extra group) or free (a group whose options set the dish's price,
// which the deal's price replaces). A group with no entry is as on the
// dish. The picked dish stays the menu's dish: the kitchen, recipes and
// stock, allergens, photos and sold out follow it; only what is asked
// changes. Stored only when set, so deals without changes aren't changes to
// publish.

const countOf = (v, lo) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(lo, Math.min(MAX_PICKS, Math.trunc(Number(v)))))
// The most a deal's extra charge for one option can be, in pence (a combo choice's own charge has the same cap).
export const DEAL_PRICE_MAX = 100000

/** A deal's extra charges as stored: whole pence in range, for these option ids when given; null when none. */
function dealPrices(raw, ids = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  for (const [id, v] of Object.entries(raw).slice(0, 100)) {
    if (!id || v == null || v === '' || (ids && !ids.includes(id))) continue
    const n = Number(v)
    if (Number.isInteger(n) && n >= 0 && n <= DEAL_PRICE_MAX) out[id] = n
  }
  return Object.keys(out).length ? out : null
}

/** A choice's changes to its dishes' groups as stored: only real changes, or null when there are none. */
export function normaliseDealGroups(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  for (const [key, v] of Object.entries(raw).slice(0, DEAL_GROUPS_MAX)) {
    if (!key || !v || typeof v !== 'object') continue
    let use = DEAL_USES.includes(v.use) ? v.use : 'all'
    const e = {}
    if (use === 'only') {
      e.option_ids = [...new Set(asList(v.option_ids).filter(x => x != null && x !== '').map(String))].slice(0, 100)
      // None ticked asks nothing: the same as leaving the group out.
      if (!e.option_ids.length) { use = 'off'; delete e.option_ids }
    }
    if (use === 'swap') {
      if (!v.group_id || String(v.group_id) === key) continue
      e.group_id = String(v.group_id)
    }
    if (use !== 'off') {
      const max = countOf(v.max, 1)
      const min = countOf(v.min, 0)
      if (max != null) e.max = max
      if (min != null) e.min = max != null ? Math.min(min, max) : min
      const prices = dealPrices(v.prices, use === 'only' ? e.option_ids : null)
      if (prices) e.prices = prices
    }
    if (use === 'all' && e.min == null && e.max == null && !e.prices) continue
    out[key] = { use, ...e }
  }
  return Object.keys(out).length ? out : null
}

/**
 * A choice's deal changes moved from one group key to another, its picked
 * option ids mapped (optionIds: old id -> new id; ids with no new one go).
 * Used when a dish's own options become an option group ('variants' ->
 * the group's id, 'v:<label>' -> the group's option ids), so a deal that
 * changed them changes the group instead. keepOld keeps the old entry too
 * (a section choice: the section's other dishes may still have their own
 * options). Returns the changes as stored (null = none).
 */
export function moveDealGroup(groups, from, to, optionIds = {}, { keepOld = false } = {}) {
  const changes = normaliseDealGroups(groups)
  if (!changes || !changes[from] || changes[to] || from === to) return changes
  const ch = changes[from]
  const moved = ch.use === 'only'
    ? { ...ch, option_ids: ch.option_ids.map(id => optionIds[id]).filter(Boolean) }
    : { ...ch }
  if (ch.prices) {
    moved.prices = Object.fromEntries(Object.entries(ch.prices).filter(([id]) => optionIds[id]).map(([id, p]) => [optionIds[id], p]))
  }
  const out = { ...changes, [to]: moved }
  if (!keepOld) delete out[from]
  return normaliseDealGroups(out)
}

/** A group's how many with a deal's change, and no more than its options (unless a pick can repeat). */
function dealLimits(c, ch) {
  let max = Number(ch.max ?? c.max) || 1
  if (!c.repeat) max = Math.min(max, c.options.length)
  max = Math.max(1, max)
  const min = Math.max(0, Math.min(max, Number(ch.min ?? c.min) || 0))
  return { ...c, min, max, on_request: min === 0 && !!c.on_request }
}

/**
 * A group with the deal's own extra charges (prices: option id -> pence):
 * asked as extras, each option at its deal price, else at its own extra
 * charge (an extra group) or free (a base group's prices are dish prices,
 * which the deal's price replaces).
 */
function withDealPrices(c, prices) {
  const extra = c.mode === 'extra'
  return {
    ...c, mode: 'extra',
    options: asList(c.options).map(o => {
      const p = prices[String(o.id)]
      return p != null ? { ...o, price_pence: p } : extra ? o : { ...o, price_pence: 0 }
    }),
  }
}

/**
 * What a deal picks for the guest instead of asking: a group the deal
 * changed that is left with one option and needs a pick (at least one; with
 * repeats, a set number) has nothing to choose, so that option is picked
 * (fixed, the picks as option ids). Not an option that opens a group of its
 * own (Steak, then how it's cooked): that is still asked. An optional group
 * left with one option is still asked (yes or no).
 */
function fixedPicks(c) {
  const opts = asList(c.options)
  if (opts.length !== 1 || !(Number(c.min) >= 1) || opts[0].child_group_id) return null
  if (c.repeat && c.min !== c.max) return null
  return Array.from({ length: c.repeat ? c.min : 1 }, () => opts[0].id)
}

/**
 * A part's picks with what the deal picks filled in (dealChoices() fixed):
 * the guest's own picks for the groups they are asked, the deal's for the
 * rest. Pricing goes through this, so a line never lacks them; the same
 * picks object comes back when nothing is fixed.
 */
export function withDealPicks(choices, picks) {
  let out = picks || {}
  for (const c of asList(choices)) if (c.fixed) out = { ...out, [c.key]: c.fixed }
  return out
}

/** The groups a deal still asks the guest (the others it picks itself). */
export const askedChoices = choices => asList(choices).filter(c => !c.fixed)

/**
 * A picked dish's options in a deal: its own choices, in the caller's shape
 * ({ key, name, mode, min, max, repeat, on_request, options: [{ id, ... }] }:
 * the till's posChoices(), online's itemChoices()), with a combo choice's
 * changes (groups, from stepChoices()). swap(groupId, choice) gives another
 * group as a choice in the same shape (null: unknown, the group is left out).
 * A group left with no options goes; a key that comes twice (a swap to a
 * group the dish has too) is asked once; a group with deal prices is asked
 * as extras at those prices (withDealPrices()); a changed group left with
 * nothing to choose carries fixed (fixedPicks()): show askedChoices(), price
 * with withDealPicks().
 */
export function dealChoices(choices, groups, swap = null) {
  const list = asList(choices)
  if (!groups || typeof groups !== 'object') return list
  const out = []
  const keys = new Set()
  for (const c of list) {
    const ch = groups[c.key]
    let next = c
    if (ch && typeof ch === 'object') {
      const use = DEAL_USES.includes(ch.use) ? ch.use : 'all'
      if (use === 'off') continue
      if (use === 'only') {
        const ids = asList(ch.option_ids).map(String)
        next = { ...c, options: asList(c.options).filter(o => ids.includes(String(o.id))) }
      } else if (use === 'swap') {
        next = swap && ch.group_id ? swap(String(ch.group_id), c) : null
        if (!next) continue
      }
      next = dealLimits(next, ch)
      if (!asList(next.options).length) continue
      if (ch.prices && Object.keys(ch.prices).length) next = withDealPrices(next, ch.prices)
      const fixed = fixedPicks(next)
      if (fixed) next = { ...next, fixed }
    }
    if (keys.has(next.key)) continue
    keys.add(next.key)
    out.push(next)
  }
  return out
}

/** The library groups a combo's choices ask instead of a dish's own ('swap'). */
export function dealSwapIds(item) {
  const ids = new Set()
  for (const st of comboOf(item)?.steps || []) {
    for (const o of st.options) for (const g of Object.values(o.groups || {})) if (g.use === 'swap' && g.group_id) ids.add(g.group_id)
  }
  return [...ids]
}

/**
 * Could the deal have asked a dish ordered on its own this way? picks are
 * the dish's own picks as { groupKey: [optionId] } (repeats listed again,
 * "No" picks left out). A group the deal narrows must hold only its options
 * and stay within the deal's how many; groups it leaves out or swaps don't
 * count (those picks stay on the dish at their own price). No picks known:
 * fits. An automatic combo only takes dishes that fit (findAutoCombos()).
 */
export function dealFits(groups, picks) {
  if (!groups || !picks) return true
  for (const [key, ch] of Object.entries(groups)) {
    if (ch.use === 'off' || ch.use === 'swap') continue
    const got = asList(picks[key])
    if (ch.use === 'only' && got.some(id => !asList(ch.option_ids).includes(String(id)))) return false
    if (ch.max != null && got.length > ch.max) return false
  }
  return true
}

/** "Choose 1", "Choose 2 to 3", "Optional, up to 2". */
export function stepRule(step) {
  if (step.min === 0) return step.max === 1 ? 'Optional' : 'Optional, up to ' + step.max
  if (step.min === step.max) return 'Choose ' + step.min
  return 'Choose ' + step.min + ' to ' + step.max
}

/**
 * Price a combo's picks. partPrice(partItem, choices, groups) prices a
 * part's own options with the caller's engine, as the deal asks them (groups:
 * the choice's changes, for dealChoices()), and returns
 * { ok, extras, detail } or { ok: false, error }; a part's base options don't
 * change the deal's price, its extras do.
 * Returns { ok, parts, upcharge, extras, picks } or { ok: false, error }.
 * parts: [{ step_id, step, option_id, item_id, section_id, name,
 *           kitchen_name, upcharge, extras, detail, custom }]
 */
export function priceCombo(item, selection = {}, ctx = {}, partPrice = null) {
  const { picks, steps } = resolveSteps(item, selection.combo || {}, ctx)
  const parts = []
  let upcharge = 0
  let extras = 0
  for (const { step, choices, shown } of steps) {
    if (!shown) continue
    const got = picks[step.id]
    if (got.length < step.min) {
      return { ok: false, error: step.min === 1 ? 'Choose ' + step.name.toLowerCase() : 'Choose ' + step.min + ' for ' + step.name.toLowerCase(), step_id: step.id }
    }
    if (got.length > step.max) return { ok: false, error: 'Choose up to ' + step.max + ' for ' + step.name.toLowerCase(), step_id: step.id }
    if (!step.repeat) {
      const keys = got.map(e => e.option_id + ':' + (e.item_id || ''))
      if (new Set(keys).size !== keys.length) return { ok: false, error: step.name + ': choose each one once', step_id: step.id }
    }
    for (const e of got) {
      const c = choiceFor(choices, e)
      if (c.sold_out) return { ok: false, error: c.label + ' is sold out', step_id: step.id }
      let partExtras = 0
      let detail = null
      if (c.item && partPrice) {
        const pp = partPrice(c.item, e.choices || {}, c.groups || null)
        if (!pp.ok) return { ok: false, error: c.label + ': ' + pp.error, step_id: step.id }
        partExtras = pp.extras || 0
        detail = pp.detail ?? null
      }
      upcharge += c.price_pence
      extras += partExtras
      parts.push({
        step_id: step.id, step: step.name, option_id: c.option_id, item_id: c.item_id,
        section_id: c.section_id, name: c.label, kitchen_name: c.kitchen_name,
        upcharge: c.price_pence, extras: partExtras, detail, custom: !c.item_id,
      })
    }
  }
  return { ok: true, parts, upcharge, extras, picks }
}

/**
 * A combo line's parts for showing: the same pick more than once in a step
 * (Ketchup pot, Ketchup pot) as one entry with a count, in the order first
 * picked. Works on a till line's parts (modifiers, upcharge), an online
 * order's (options, upcharge_pence) and a kitchen item's (mods).
 * Returns [{ part, count }].
 */
export function countParts(parts) {
  const keyOf = p => JSON.stringify([
    p.step_id || p.step || '', p.option_id || '', p.item_id || '', p.name || '',
    asList(p.modifiers || p.options || p.mods).map(o => [o.label ?? o.text, o.prefix || o.kind || null]),
    p.upcharge ?? p.upcharge_pence ?? 0,
  ])
  const out = new Map()
  for (const p of asList(parts)) {
    const k = keyOf(p)
    if (out.has(k)) out.get(k).count++
    else out.set(k, { part: p, count: 1 })
  }
  return [...out.values()]
}

/**
 * The least a combo can cost and whether the guest's choices can change
 * it: { pence, varies }. base is the combo's own price (its own options'
 * cheapest when it has some). Each step shown without conditions adds its
 * cheapest picks; any choice with an extra charge makes it vary.
 */
export function comboFromPrice(item, base, ctx = {}) {
  const combo = comboOf(item)
  let total = Number(base ?? item.price_pence ?? 0) || 0
  let varies = false
  if (!combo) return { pence: total, varies }
  for (const step of combo.steps) {
    const choices = stepChoices(step, { ...ctx, selfId: item.id })
    const prices = choices.map(c => c.price_pence)
    if (prices.some(p => p > 0)) varies = true
    // A dish's option that costs extra in the deal can make it dearer too.
    if (choices.some(c => Object.values(c.groups || {}).some(g => Object.values(g.prices || {}).some(p => p > 0)))) varies = true
    if (step.when || step.min === 0 || !prices.length) continue
    const sorted = [...prices].sort((a, b) => a - b)
    const need = step.repeat ? Array(step.min).fill(sorted[0]) : sorted.slice(0, step.min)
    total += need.reduce((s, p) => s + p, 0)
  }
  return { pence: total, varies }
}

/**
 * The steps as a guest would see them, for a menu screen's "how to order"
 * view: [{ name, rule, options: [{ label, price_pence }], when }].
 */
export function comboGuide(item, ctx = {}) {
  const combo = comboOf(item)
  if (!combo) return []
  const byId = Object.fromEntries(combo.steps.map(s => [s.id, s]))
  return combo.steps.map(step => {
    const choices = stepChoices(step, { ...ctx, selfId: item.id })
    let when = null
    if (step.when) {
      const ref = byId[step.when.step_id]
      const labels = ref ? stepChoices(ref, { ...ctx, selfId: item.id })
        .filter(c => !step.when.option_ids.length || step.when.option_ids.includes(c.option_id)).map(c => c.label) : []
      when = ref ? (step.when.option_ids.length ? 'With ' + [...new Set(labels)].join(' or ') : 'If you choose a ' + ref.name.toLowerCase()) : null
    }
    return {
      id: step.id, name: step.name, rule: stepRule(step), when,
      options: choices.map(c => ({ label: c.label, price_pence: c.price_pence, sold_out: c.sold_out })),
    }
  })
}

// ── Automatic combos ───────────────────────────────────────────

/** Split `total` pence over `weights` (whole pence, adds up exactly). */
export function spreadPence(total, weights) {
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0)
  if (!total || sum <= 0) return weights.map(() => 0)
  const raw = weights.map(w => (Math.max(0, w) * total) / sum)
  const out = raw.map(Math.floor)
  let left = total - out.reduce((s, x) => s + x, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0])
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k][1]]++
  return out
}

/** spreadPence with a most per share: what a full share can't take goes to the others. */
export function spreadCapped(total, weights, caps) {
  const out = weights.map(() => 0)
  let left = Math.min(total, caps.reduce((s, c) => s + Math.max(0, c), 0))
  for (let round = 0; left > 0 && round < weights.length + 1; round++) {
    const open = weights.map((w, i) => (out[i] < caps[i] ? Math.max(w, 1) : 0))
    const add = spreadPence(left, open)
    left = 0
    add.forEach((x, i) => {
      const room = caps[i] - out[i]
      const take = Math.min(x, room)
      out[i] += take
      left += x - take
    })
  }
  return out
}

/** Can this combo be found among separate items? Every step without a condition that needs a pick must offer a dish. */
export function autoMatchable(item) {
  const combo = comboOf(item)
  if (!combo || combo.mode !== 'auto') return false
  const required = combo.steps.filter(s => !s.when && s.min > 0)
  return required.length > 0 && required.every(s => s.options.some(o => o.type !== 'custom'))
}

/**
 * Find automatic combos among an order's separate items.
 *
 * lines: [{ key, item_id, section_id, qty, unit_base, cap, picks }]
 *   unit_base  the dish's own price for one (no extras: those stay paid)
 *   cap        the most that may come off one of it (what is left after
 *              line discounts), defaults to unit_base
 *   picks      its options as { groupKey: [optionId] }: a choice whose
 *              deal changes its options only takes it when dealFits()
 * combos: combo items ({ id, name, kind: 'combo', combo, price_pence }),
 *   only automatic ones are used; base(combo) gives its price (default
 *   price_pence).
 * ctx: { sectionItems, itemsById } for section options.
 *
 * Each match takes, for every step without a condition that needs a pick,
 * that many dishes from the step's choices (dearest first; custom choices
 * can't be matched). It applies only when it makes the order cheaper:
 * saving = the dishes' own prices - (combo price + their extra charges).
 * The best saving goes first, as many times as the order allows.
 *
 * Returns [{ combo_id, name, count, saving, lines: { key: pence } }].
 */
export function findAutoCombos(lines, combos, ctx = {}, base = null) {
  const auto = asList(combos).filter(autoMatchable)
  if (!auto.length) return []
  const units = []
  for (const l of asList(lines)) {
    const n = Math.max(0, Math.min(99, int(l.qty, 1)))
    for (let i = 0; i < n; i++) {
      units.push({ key: l.key, item_id: l.item_id, section_id: l.section_id ?? null, value: pence(l.unit_base), cap: pence(l.cap ?? l.unit_base), picks: l.picks || null, used: false })
    }
  }
  const matchers = auto.map(item => {
    const combo = comboOf(item)
    const steps = combo.steps.filter(s => !s.when && s.min > 0).map(step => {
      // Each dish (or section) the step offers, with the charge and the deal's changes of every choice offering it.
      const offers = new Map()
      const offer = (k, o) => offers.set(k, [...(offers.get(k) || []), { charge: o.price_pence, groups: o.groups || null }])
      for (const o of step.options) {
        if (o.type === 'item') offer('i:' + o.item_id, o)
        else if (o.type === 'section') {
          const ids = ctx.sectionItems?.[o.section_id]
          if (ids) for (const id of ids) offer('i:' + id, o)
          else offer('s:' + o.section_id, o)
        }
      }
      return { step, offers }
    })
    const price = Number(base ? base(item) : item.price_pence) || 0
    return { item, steps, price }
  })
  // The cheapest charge of the choices that could have asked this dish as it was ordered (undefined: none).
  const cheapest = (list, u) => {
    let best
    for (const o of list || []) if (dealFits(o.groups, u.picks) && (best === undefined || o.charge < best)) best = o.charge
    return best
  }
  const chargeFor = (s, u) => cheapest(s.offers.get('i:' + u.item_id), u) ?? (u.section_id != null ? cheapest(s.offers.get('s:' + u.section_id), u) : undefined)

  const tryMatch = m => {
    const taken = []
    let charges = 0
    for (const s of m.steps) {
      const pool = units.filter(u => !u.used && !taken.includes(u) && chargeFor(s, u) !== undefined && u.item_id !== m.item.id)
        .sort((a, b) => (b.value - chargeFor(s, b)) - (a.value - chargeFor(s, a)))
      const picked = []
      for (const u of pool) {
        if (picked.length >= s.step.min) break
        if (!s.step.repeat && picked.some(p => p.item_id === u.item_id)) continue
        picked.push(u)
      }
      if (picked.length < s.step.min) return null
      for (const u of picked) { taken.push(u); charges += chargeFor(s, u) }
    }
    const value = taken.reduce((x, u) => x + u.value, 0)
    const saving = Math.min(value - (m.price + charges), taken.reduce((x, u) => x + u.cap, 0))
    return saving > 0 ? { m, taken, saving } : null
  }

  const found = new Map()
  for (let guard = 0; guard < 200; guard++) {
    let best = null
    for (const m of matchers) {
      const hit = tryMatch(m)
      if (hit && (!best || hit.saving > best.saving)) best = hit
    }
    if (!best) break
    // Spread by the dishes' prices, never more off a dish than is left on it.
    const share = spreadCapped(best.saving, best.taken.map(u => u.value), best.taken.map(u => u.cap))
    for (const u of best.taken) u.used = true
    const f = found.get(best.m.item.id) || { combo_id: best.m.item.id, name: best.m.item.name, count: 0, saving: 0, lines: {} }
    f.count++
    best.taken.forEach((u, i) => {
      if (share[i] > 0) f.lines[u.key] = (f.lines[u.key] || 0) + share[i]
      f.saving += share[i]
    })
    found.set(best.m.item.id, f)
  }
  return [...found.values()]
}

/** Combos (on the menu) that offer this dish in some step: for "Make it a combo". */
export function combosWithItem(itemId, combos, ctx = {}) {
  return asList(combos).filter(c => {
    const combo = comboOf(c)
    if (!combo) return false
    return combo.steps.some(s => stepChoices(s, { ...ctx, selfId: c.id }).some(x => x.item_id === itemId))
  })
}

/** The first shown step of a combo that offers this dish, for starting the combo with it picked. */
export function stepWithItem(item, itemId, ctx = {}) {
  const combo = comboOf(item)
  if (!combo) return null
  for (const s of combo.steps) {
    if (s.when) continue
    const c = stepChoices(s, { ...ctx, selfId: item.id }).find(x => x.item_id === itemId)
    if (c) return { step_id: s.id, option_id: c.option_id, item_id: c.item_id }
  }
  return null
}

/** Problems with a combo's set-up, for the editor (none = []). */
export function comboProblems(combo, { itemIds = null, sectionIds = null } = {}) {
  const c = normaliseCombo(combo)
  const out = []
  if (!c.steps.length) out.push('Add at least one step.')
  for (const s of c.steps) {
    if (!s.options.length) out.push(s.name + ': add at least one choice.')
    if (s.min > 1 && !s.repeat && s.options.length === 1 && s.options[0].type !== 'section') out.push(s.name + ': needs ' + s.min + ' picks but has one choice; allow the same choice more than once.')
    if (itemIds) for (const o of s.options) if (o.type === 'item' && !itemIds.has(o.item_id)) out.push(s.name + ': a dish it offers is no longer on this menu.')
    if (sectionIds) for (const o of s.options) if (o.type === 'section' && !sectionIds.has(o.section_id)) out.push(s.name + ': a section it offers is no longer on this menu.')
  }
  if (c.mode === 'auto') {
    const required = c.steps.filter(s => !s.when && s.min > 0)
    if (!required.length) out.push('Automatic: at least one step must need a pick.')
    for (const s of required) if (!s.options.some(o => o.type !== 'custom')) out.push(s.name + ': an automatic combo can only be spotted from dishes, not typed-in choices.')
  }
  return out
}
