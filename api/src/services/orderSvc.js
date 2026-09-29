// src/services/orderSvc.js
//
// Web ordering (migration 122): the one place orders are priced, created,
// moved through their statuses, paid and refunded. The public ordering
// API (routes/orderApi.js) and the admin orders API (routes/orders.js)
// both call into this file; neither touches the order tables directly.
//
// Prices come only from shared/orderPricing.js (priceBasket), applied to
// the live menu on the server. Payments go only through the gateway
// interface in services/paymentGateways/.

import { sql, withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { broadcast } from '../config/ws.js'
import { notificationQueue } from '../jobs/queues.js'
import { upsertCustomer } from '../routes/customers.js'
import { loadMenuFull } from '../routes/menus.js'
import { loadOpeningHours } from './siteDataSvc.js'
import { getGateway, checkoutGateways, COUNTER_METHODS } from './paymentGateways/index.js'
import { itemChoices, variantRules, fromPrice, isPriced, priceBasket } from '../../../shared/orderPricing.js'
import { menuOnAt, menuOnDate, scheduleLabel, isScheduled } from '../../../shared/menuSchedule.js'
import { venuePromotions, findByCode, lockUses } from './promoSvc.js'

// An unpaid online order holds its slot this long, then expires.
export const PENDING_TTL_MINS = 30

// Statuses that take up a collection slot.
const ACTIVE_STATUSES = ['placed', 'accepted', 'preparing', 'ready', 'completed']

// Allowed status changes by staff. 'placed' is reached only through
// placement (payment or pay at venue), 'expired' only by the sweep.
export const TRANSITIONS = {
  pending_payment: ['cancelled'],
  placed:          ['accepted', 'rejected', 'cancelled'],
  accepted:        ['preparing', 'ready', 'cancelled'],
  preparing:       ['ready', 'cancelled'],
  ready:           ['completed', 'cancelled'],
}

// ── Time helpers (venue local time <-> UTC) ────────────────────

function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]))
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second)
  return asUtc - (date.getTime() - date.getMilliseconds())
}

export function zonedToUtc(dateStr, hhmm, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const off = tzOffsetMs(new Date(guess), tz)
  let t = guess - off
  const off2 = tzOffsetMs(new Date(t), tz)
  if (off2 !== off) t = guess - off2
  return new Date(t)
}

export function localParts(date, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(date)
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]))
  const dateStr = `${m.year}-${m.month}-${m.day}`
  return {
    date: dateStr,
    time: `${m.hour}:${m.minute}`,
    minutes: Number(m.hour) * 60 + Number(m.minute),
    dow: new Date(Date.UTC(+m.year, +m.month - 1, +m.day)).getUTCDay(),
  }
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const hhmm = mins => String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0')
const toMins = t => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m }

// ── Settings ────────────────────────────────────────────────────

const SETTINGS_DEFAULTS = {
  is_enabled: false, is_paused: false, pause_message: null, hours: [], menu_ids: [], menu_schedules: {},
  allow_asap: true, lead_time_mins: 20, slot_interval_mins: 15, max_orders_per_slot: null,
  max_days_ahead: 0, min_order_pence: 0, auto_accept: false,
  default_vat_rate_takeaway: 20, default_vat_rate_eat_in: 20,
  tips_enabled: false, tip_percents: [10, 12, 15], payment_methods: ['pay_at_venue'],
  collection_instructions: null, confirmation_note: null,
}

function normaliseSettings(row, venueId) {
  const s = { ...SETTINGS_DEFAULTS, ...(row || {}), venue_id: venueId }
  s.default_vat_rate_takeaway = Number(s.default_vat_rate_takeaway)
  s.default_vat_rate_eat_in = Number(s.default_vat_rate_eat_in)
  s.hours = Array.isArray(s.hours) ? s.hours : []
  s.menu_schedules = s.menu_schedules && typeof s.menu_schedules === 'object' ? s.menu_schedules : {}
  return s
}

// Ordering hours default to the venue's opening hours (website hours or
// the booking schedule), one window per sitting.
export async function defaultHours(tx, venueId) {
  const [cfg] = await tx`SELECT id, opening_hours_source FROM website_config WHERE venue_id = ${venueId} LIMIT 1`
  const rows = await loadOpeningHours(tx, venueId, cfg || null)
  const out = []
  for (let day = 0; day < 7; day++) {
    const windows = rows
      .filter(r => r.day_of_week === day && !r.is_closed && r.opens_at && r.closes_at)
      .map(r => ({ open: r.opens_at, close: r.closes_at }))
      .sort((a, b) => toMins(a.open) - toMins(b.open))
    out.push({ day, windows })
  }
  return out
}

export async function loadSettings(tx, venueId, { withDefaultHours = false } = {}) {
  const [row] = await tx`SELECT * FROM ordering_settings WHERE venue_id = ${venueId}`
  const s = normaliseSettings(row, venueId)
  s.exists = !!row
  if (withDefaultHours && !s.hours.length) s.hours = await defaultHours(tx, venueId)
  return s
}

// ── Menu for ordering ──────────────────────────────────────────

// VAT by order type: collection and delivery are takeaway, table orders
// are eat in. The dish's own rate wins, then its section's (migration 127),
// then the venue default for that type.
export function vatRateFor(item, fulfilment, settings, section = null) {
  const key = fulfilment === 'eat_in' ? 'vat_rate_eat_in' : 'vat_rate_takeaway'
  if (item?.[key] != null) return Number(item[key])
  if (section?.[key] != null) return Number(section[key])
  return fulfilment === 'eat_in' ? settings.default_vat_rate_eat_in : settings.default_vat_rate_takeaway
}

async function soldOutIds(tx, venueId) {
  const rows = await tx`
    SELECT item_id FROM ordering_item_availability
     WHERE venue_id = ${venueId} AND (sold_out_until IS NULL OR sold_out_until > now())
  `
  return new Set(rows.map(r => r.item_id))
}

// The orderable menus of a venue, shaped for the guest page, plus an
// { itemId: item } map for pricing and { itemId: [menuId] } for menu
// schedules. Dishes that are switched off for ordering, or have no price,
// are left out; sold-out dishes stay in (shown as sold out) but can't be
// priced. With `dates` (the ordering dates) a menu scheduled on none of
// them is left out (migration 130); each menu then carries its schedule
// label and whether it is on at `now`.
export async function loadOrderingMenu(tx, venue, settings, { fulfilment = 'collection', dates = null, now = null } = {}) {
  const ids = settings.menu_ids || []
  const menuRows = ids.length ? await tx`
    SELECT id FROM menus
     WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${venue.tenant_id}
       AND (venue_id IS NULL OR venue_id = ${venue.id})
  ` : []
  const allowed = new Set(menuRows.map(r => r.id))
  const soldOut = await soldOutIds(tx, venue.id)
  const menus = []
  const itemsById = {}
  const itemMenus = {}
  let dietaryTags = []
  const schedules = settings.menu_schedules || {}
  const nowParts = now ? localParts(now, venue.timezone) : null
  for (const id of ids) {
    if (!allowed.has(id)) continue
    const sched = schedules[id]
    if (dates && !dates.some(d => menuOnDate(sched, d, new Date(d + 'T00:00:00Z').getUTCDay()))) continue
    const full = await loadMenuFull(tx, id, venue.tenant_id)
    if (!full) continue
    dietaryTags = full.dietary_tags || dietaryTags
    const rules = variantRules(full)
    const sections = []
    for (const s of full.sections || []) {
      const items = []
      for (const it of s.items || []) {
        if (it.is_orderable === false) continue
        const choices = itemChoices(it, rules)
        if (!isPriced(it, choices)) continue
        const item = {
          id: it.id, section_id: s.id, name: it.name, native_name: it.native_name || null,
          description: it.description || null, notes: it.notes || null,
          image_url: it.image_url || null, calories: it.calories ?? null,
          dietary: it.dietary || [], price_pence: it.price_pence ?? null,
          featured: !!it.is_featured,   // House favourite (Menus page)
          choices, from_pence: fromPrice(it, choices),
          sold_out: soldOut.has(it.id),
          min_qty: it.min_order_qty > 1 ? it.min_order_qty : null,   // migration 133
          vat_rate: vatRateFor(it, fulfilment, settings, s),
          variants: it.variants || [], variant_groups: it.variant_groups || [],
        }
        if (!itemsById[it.id]) itemsById[it.id] = item
        ;(itemMenus[it.id] ??= []).push(id)
        items.push(item)
      }
      if (items.length) sections.push({ id: s.id, title: s.title, subtitle: s.subtitle || null, image_url: s.image_url || null, items })
    }
    if (sections.length) {
      menus.push({
        id: full.id, name: full.name, tagline: full.tagline || null, sections,
        schedule: isScheduled(sched) ? scheduleLabel(sched) : null,
        on_now: nowParts ? menuOnAt(sched, nowParts) : true,
      })
    }
  }
  return {
    menus,
    itemsById,
    itemMenus,
    dietary_tags: (dietaryTags || []).map(t => ({ code: t.code, label: t.label, glyph: t.glyph, colour: t.colour })),
  }
}

/**
 * First dish in `itemIds` that none of its menus offers at venue-local
 * `parts` ({ date, dow, minutes }), or null when every dish is on.
 */
export function itemOffAt(itemIds, itemMenus, settings, parts) {
  const schedules = settings.menu_schedules || {}
  for (const id of itemIds) {
    const menuIds = itemMenus[id] || []
    if (!menuIds.some(m => menuOnAt(schedules[m], parts))) return id
  }
  return null
}

// What the guest page gets for a dish: prepared choices, not the raw
// variant rows. vat_rate stays (the order type's rate), so the basket and
// checkout can show "Includes VAT"; it used to be stripped too, which left
// the guest page's VAT at 0. The server still re-prices every order.
export function publicItem(item) {
  const { variants, variant_groups, ...rest } = item
  return rest
}

// ── Collection slots ───────────────────────────────────────────

function slotMinutesFor(windows, interval) {
  const out = []
  for (const w of windows || []) {
    const open = toMins(w.open)
    const close = toMins(w.close)
    for (let t = open; t <= close; t += interval) out.push(t)
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

// The slot an order counts against: the first slot at or after it.
function bucketOf(minutes, slotMins) {
  for (const s of slotMins) if (s >= minutes) return s
  return slotMins[slotMins.length - 1]
}

async function slotCounts(tx, venueId, date, tz, slotMins, excludeOrderId = null) {
  const rows = await tx`
    SELECT promised_at FROM orders
     WHERE venue_id = ${venueId} AND service_date = ${date}
       AND (status = ANY(${ACTIVE_STATUSES})
            OR (status = 'pending_payment' AND created_at > now() - make_interval(mins => ${PENDING_TTL_MINS})))
       AND (${excludeOrderId}::uuid IS NULL OR id <> ${excludeOrderId}::uuid)
  `
  const counts = {}
  for (const r of rows) {
    const b = bucketOf(localParts(new Date(r.promised_at), tz).minutes, slotMins)
    if (b != null) counts[b] = (counts[b] || 0) + 1
  }
  return counts
}

// Collection times for one day. `now` is a Date. `isOn(minutes)` (optional)
// says whether the basket's dishes are on the menu at that minute of the
// day (menu schedules, migration 130); times when they aren't are left out.
export async function computeSlots(tx, { venue, settings, date, now = new Date(), isOn = null }) {
  const tz = venue.timezone
  const today = localParts(now, tz).date
  const dow = new Date(date + 'T00:00:00Z').getUTCDay()
  const day = (settings.hours || []).find(h => Number(h.day) === dow)
  const windows = (day?.windows || []).filter(w => w.open && w.close && toMins(w.close) >= toMins(w.open))
  const interval = settings.slot_interval_mins
  const slotMins = slotMinutesFor(windows, interval)
  const lastDate = addDays(today, settings.max_days_ahead)
  if (date < today || date > lastDate || !slotMins.length) {
    return { date, is_open: false, asap: { available: false }, slots: [] }
  }
  const counts = await slotCounts(tx, venue.id, date, tz, slotMins)
  const cap = settings.max_orders_per_slot
  const earliest = new Date(now.getTime() + settings.lead_time_mins * 60000)
  let offMenu = 0
  const slots = slotMins.filter(m => {
    if (!isOn || isOn(m)) return true
    offMenu++
    return false
  }).map(m => {
    const at = zonedToUtc(date, hhmm(m), tz)
    const full = cap != null && (counts[m] || 0) >= cap
    return { time: hhmm(m), at: at.toISOString(), available: at >= earliest && !full, full }
  })

  // ASAP: today only, while a window is open (or opens within the lead
  // time), promised at the later of "now + lead time" and the opening.
  let asap = { available: false }
  if (date === today && settings.allow_asap) {
    for (const w of windows) {
      const openAt = zonedToUtc(date, w.open, tz)
      const closeAt = zonedToUtc(date, w.close, tz)
      if (now.getTime() < openAt.getTime() - settings.lead_time_mins * 60000) continue
      const ready = new Date(Math.max(earliest.getTime(), openAt.getTime()))
      if (ready > closeAt) continue
      const rounded = new Date(Math.ceil(ready.getTime() / 300000) * 300000)
      if (isOn && !isOn(localParts(rounded, tz).minutes)) break
      const b = bucketOf(localParts(rounded, tz).minutes, slotMins)
      const full = cap != null && (counts[b] || 0) >= cap
      asap = { available: !full, full, promised_at: rounded.toISOString(), ready_in_mins: Math.max(0, Math.round((rounded - now) / 60000)) }
      break
    }
  }
  return { date, is_open: true, asap, slots, off_menu: offMenu }
}

export function orderingDates(venue, settings, now = new Date()) {
  const today = localParts(now, venue.timezone).date
  const out = []
  for (let i = 0; i <= settings.max_days_ahead; i++) out.push(addDays(today, i))
  return out
}

// ── Serialisers ────────────────────────────────────────────────

const int = v => (v == null ? v : Number(v))

function shapeItems(items) {
  return items.map(i => ({
    id: i.id, menu_item_id: i.menu_item_id, name: i.name, options: i.options || [],
    qty: i.qty, unit_price_pence: i.unit_price_pence, line_total_pence: i.line_total_pence,
    discount_pence: i.discount_pence || 0,
    vat_rate: Number(i.vat_rate), vat_pence: i.vat_pence, note: i.note,
  }))
}

const shapePromos = rows => (rows || []).map(p => ({ name: p.name, code: p.code, discount_pence: p.discount_pence }))

export function publicOrder(order, items, venue, promotions = []) {
  return {
    token: order.public_token,
    order_number: order.order_number,
    status: order.status,
    fulfilment: order.fulfilment,
    is_asap: order.is_asap,
    promised_at: order.promised_at,
    placed_at: order.placed_at,
    ready_at: order.ready_at,
    guest_name: order.guest_name,
    currency: order.currency,
    subtotal_pence: order.subtotal_pence, discount_pence: order.discount_pence || 0, tip_pence: order.tip_pence,
    promotions: shapePromos(promotions),
    total_pence: order.total_pence, vat_pence: order.vat_pence,
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    refunded_pence: order.refunded_pence,
    cancel_reason: order.status === 'rejected' || order.status === 'cancelled' ? order.cancel_reason : null,
    items: shapeItems(items).map(({ id, menu_item_id, ...rest }) => rest),
    venue: venue ? { name: venue.name, timezone: venue.timezone } : null,
  }
}

export function adminOrder(order, items = [], extra = {}, promotions = []) {
  return {
    ...order,
    service_date: order.service_date,
    subtotal_pence: int(order.subtotal_pence), total_pence: int(order.total_pence),
    discount_pence: int(order.discount_pence) || 0,
    items: shapeItems(items),
    promotions: shapePromos(promotions),
    ...extra,
  }
}

const ORDER_COLS = sql`*, service_date::text AS service_date`

async function loadOrderRow(tx, id) {
  const [o] = await tx`SELECT ${ORDER_COLS} FROM orders WHERE id = ${id}`
  return o || null
}

async function loadItems(tx, orderId) {
  return tx`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY sort_order`
}

export async function loadOrderPromotions(tx, orderId) {
  return tx`SELECT name, code, discount_pence FROM order_promotions WHERE order_id = ${orderId} ORDER BY created_at, name`
}

async function addEvent(tx, order, type, { from = null, to = null, detail = {}, actor = 'system' } = {}) {
  await tx`
    INSERT INTO order_events (order_id, tenant_id, type, from_status, to_status, detail, actor)
    VALUES (${order.id}, ${order.tenant_id}, ${type}, ${from}, ${to}, ${tx.json(detail)}, ${actor})
  `
}

// ── Notifications (after commit) ──────────────────────────────

function notify(order, type) {
  broadcast(order.venue_id, {
    type: type === 'created' ? 'order.created' : 'order.updated',
    data: { id: order.id, status: order.status, order_number: order.order_number, payment_status: order.payment_status },
  })
}

function queueEmail(order, type) {
  if (!order.guest_email) return
  notificationQueue.add('order_email', { orderId: order.id, tenantId: order.tenant_id, type })
    .catch(() => {})
}

// An order just became 'placed' (paid, or pay at venue): tell the kitchen
// and the guest.
function afterPlaced(order) {
  notify(order, 'created')
  queueEmail(order, 'order_confirmation')
}

function afterStatus(order, from) {
  notify(order, 'updated')
  if (order.status === 'ready' && from !== 'ready') queueEmail(order, 'order_ready')
  if ((order.status === 'rejected' || order.status === 'cancelled') && order.placed_at) {
    queueEmail(order, 'order_cancelled')
  }
}

// ── Placement ──────────────────────────────────────────────────

async function placeOrder(tx, order, settings, actor) {
  const to = settings.auto_accept ? 'accepted' : 'placed'
  const [o] = await tx`
    UPDATE orders
       SET status = ${to}, placed_at = now(),
           accepted_at = ${settings.auto_accept ? sql`now()` : null}
     WHERE id = ${order.id}
     RETURNING ${ORDER_COLS}
  `
  await addEvent(tx, o, 'status', { from: order.status, to: 'placed', actor })
  if (settings.auto_accept) await addEvent(tx, o, 'status', { from: 'placed', to: 'accepted', actor: 'system', detail: { auto: true } })
  return o
}

const CreateError = (status, message, extra) => Object.assign(httpError(status, message), extra || {})

// Create an order from the guest's basket. Returns { order, items, payment }.
// Pricing, slot and minimum-order checks all run here, against the live
// menu, under a per-venue-per-day lock so two guests can't both take the
// last place in a slot.
// ── GDPR (migration 125) ───────────────────────────────────────
// The wording the guest sees at checkout. The server owns it: the guest
// page shows what GET /order-api/venues/:id returns, and createOrder()
// records this same text on the order, so what was agreed to can be shown
// later. Change the wording here only.
export async function loadPrivacy(tx, tenantId) {
  const [row] = await tx`
    SELECT COALESCE(NULLIF(ts.brand_name, ''), NULLIF(ts.site_name, ''), t.name) AS business,
           (SELECT '/p/' || p.slug FROM website_pages p
             WHERE p.tenant_id = t.id AND p.venue_id IS NULL AND p.is_published
               AND (p.slug = 'privacy' OR (p.is_legal AND p.slug ILIKE '%privacy%'))
             ORDER BY (p.slug = 'privacy') DESC LIMIT 1) AS policy_url
      FROM tenants t
      LEFT JOIN tenant_site ts ON ts.tenant_id = t.id
     WHERE t.id = ${tenantId}
  `
  const business = row?.business || 'We'
  return {
    business,
    policy_url: row?.policy_url || null,
    data_text: 'I agree that ' + business + ' uses my details, including any allergy information I give, only to prepare this order and to contact me about it.',
    marketing_text: 'Send me the ' + business + ' newsletter: occasional, carefully crafted emails with news and offers. Optional. I can unsubscribe at any time.',
  }
}

export async function createOrder({ venue, body, gatewayCtx = {} }) {
  const tz = venue.timezone
  const now = new Date()

  const created = await withTenant(venue.tenant_id, async tx => {
    const settings = await loadSettings(tx, venue.id)
    if (!settings.is_enabled) throw CreateError(422, 'Online ordering is not available here')
    if (settings.is_paused) throw CreateError(422, settings.pause_message || 'We are not taking online orders right now')

    const gateway = checkoutGateways(settings, { venue, ...gatewayCtx }).find(g => g.key === body.payment_method)
    if (!gateway) throw CreateError(422, 'That payment method is not available')

    // Collection time
    let promisedAt
    let isAsap
    let requestedFor = null
    const serviceDate = body.when === 'asap' ? localParts(now, tz).date : localParts(new Date(body.when), tz).date
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${venue.id + ':' + serviceDate}, 0))`
    const day = await computeSlots(tx, { venue, settings, date: serviceDate, now })
    if (body.when === 'asap') {
      if (!day.asap.available) throw CreateError(422, 'ASAP collection is not available now: please choose a time', { code: 'slot_unavailable' })
      promisedAt = new Date(day.asap.promised_at)
      isAsap = true
    } else {
      const wanted = new Date(body.when).toISOString()
      const slot = day.slots.find(s => s.at === wanted)
      if (!slot || !slot.available) throw CreateError(422, 'That collection time is no longer available: please choose another', { code: 'slot_unavailable' })
      promisedAt = new Date(slot.at)
      requestedFor = promisedAt
      isAsap = false
    }

    // Prices, and every dish must be on its menu at the collection time.
    const { itemsById, itemMenus } = await loadOrderingMenu(tx, venue, settings, { fulfilment: 'collection' })
    const off = itemOffAt(body.lines.map(l => l.item_id), itemMenus, settings, localParts(promisedAt, tz))
    if (off && itemsById[off]) {
      throw CreateError(422, `${itemsById[off].name} isn't on the menu at that collection time: please choose another time or remove it`, { code: 'slot_unavailable' })
    }
    const tipPercent = settings.tips_enabled && settings.tip_percents.includes(Number(body.tip_percent))
      ? Number(body.tip_percent) : 0

    // Promotions (migration 131): automatic ones, manual ones the guest
    // applied, code ones whose code the guest entered. Timed by when the
    // order is placed. The rules are shared/promotions.js.
    const nowParts = localParts(now, tz)
    const promos = await venuePromotions(tx, venue, nowParts.date)
    const unlocked = []
    for (const code of body.promo_codes || []) {
      const p = findByCode(promos, code)
      if (!p) throw CreateError(422, `The promo code "${String(code).trim()}" isn't valid or has run out: please remove it`, { code: 'promo_invalid' })
      unlocked.push(p.id)
    }
    const promoCtx = { at: nowParts, venueId: venue.id, unlocked, chosen: body.promo_ids || [] }
    const priced = priceBasket(itemsById, body.lines, { tipPercent, promos, promoCtx })
    if (priced.errors.length) throw CreateError(422, priced.errors[0].error, { code: 'basket_invalid', errors: priced.errors })
    if (!priced.lines.length) throw CreateError(422, 'Your basket is empty')
    // The minimum order is on the dishes' full price, before promotions.
    if (priced.subtotal_pence < settings.min_order_pence) {
      throw CreateError(422, 'The minimum order is £' + (settings.min_order_pence / 100).toFixed(2), { code: 'min_order' })
    }
    const usedUp = await lockUses(tx, venue.tenant_id, priced.promotions.map(p => p.id))
    if (usedUp) throw CreateError(422, `Sorry, ${usedUp} has just run out: please check your basket`, { code: 'promo_invalid' })

    const [{ next }] = await tx`
      SELECT COALESCE(MAX(order_number), 0) + 1 AS next FROM orders
       WHERE venue_id = ${venue.id} AND service_date = ${serviceDate}
    `
    const [{ ordering_fee_percent: feePct }] = await tx`SELECT ordering_fee_percent FROM tenants WHERE id = ${venue.tenant_id}`
    const feePercent = Number(feePct) || 0
    // The platform fee is on what the guest pays for the dishes (after promotions, before tips).
    const feePence = Math.round((priced.subtotal_pence - priced.discount_pence) * feePercent / 100)
    const customerId = body.customer.email
      ? await upsertCustomer(tx, venue.tenant_id, { name: body.customer.name, email: body.customer.email, phone: body.customer.phone })
      : null
    // Newsletter opt-in goes on the customer. Not ticking the box is not
    // an unsubscribe, so an unticked box leaves an earlier opt-in alone.
    if (customerId && body.marketing_opt_in) {
      await tx`
        UPDATE customers
           SET marketing_opt_in = true, marketing_opt_in_at = now(),
               marketing_opt_in_source = 'web_order', updated_at = now()
         WHERE id = ${customerId}
      `
    }
    const privacy = await loadPrivacy(tx, venue.tenant_id)
    const consentAt = now.toISOString()
    const consent = {
      data: { text: privacy.data_text, at: consentAt },
      marketing: body.marketing_opt_in ? { text: privacy.marketing_text, at: consentAt } : null,
      policy_url: privacy.policy_url,
    }

    const [order] = await tx`
      INSERT INTO orders (tenant_id, venue_id, channel, fulfilment, service_date, order_number,
                          status, is_asap, requested_for, promised_at, customer_id,
                          guest_name, guest_email, guest_phone, notes, allergy_note, marketing_opt_in,
                          data_consent_at, consent,
                          currency, subtotal_pence, discount_pence, tip_pence, total_pence, vat_pence,
                          platform_fee_percent, platform_fee_pence,
                          payment_method, payment_status)
      VALUES (${venue.tenant_id}, ${venue.id}, 'web', 'collection', ${serviceDate}, ${Number(next)},
              'pending_payment', ${isAsap}, ${requestedFor}, ${promisedAt}, ${customerId},
              ${body.customer.name}, ${body.customer.email || null}, ${body.customer.phone || null},
              ${body.notes || null}, ${body.allergy_note || null}, ${!!body.marketing_opt_in},
              ${consentAt}, ${tx.json(consent)},
              ${venue.currency || 'GBP'}, ${priced.subtotal_pence}, ${priced.discount_pence}, ${priced.tip_pence}, ${priced.total_pence}, ${priced.vat_pence},
              ${feePercent}, ${feePence},
              ${gateway.key}, 'unpaid')
      RETURNING ${ORDER_COLS}
    `
    for (const [i, l] of priced.lines.entries()) {
      await tx`
        INSERT INTO order_items (order_id, tenant_id, menu_item_id, name, options, qty,
                                 unit_price_pence, line_total_pence, discount_pence, vat_rate, vat_pence, note, sort_order)
        VALUES (${order.id}, ${venue.tenant_id}, ${l.item_id}, ${l.name}, ${tx.json(l.options)}, ${l.qty},
                ${l.unit_pence}, ${l.line_total_pence}, ${l.discount_pence || 0}, ${l.vat_rate}, ${l.vat_pence}, ${l.note}, ${i})
      `
    }
    for (const p of priced.promotions) {
      await tx`
        INSERT INTO order_promotions (order_id, tenant_id, promotion_id, name, code, discount_pence)
        VALUES (${order.id}, ${venue.tenant_id}, ${p.id}, ${p.name}, ${p.code}, ${p.discount_pence})
      `
    }
    await addEvent(tx, order, 'status', { to: 'pending_payment', actor: 'guest', detail: { channel: 'web' } })
    return { order, settings, gateway }
  })

  // The gateway may call an outside service, so it runs after the order
  // is committed. A failure leaves the order unpaid; the guest can retry.
  const payment = await startPayment(venue, created.order, created.settings, created.gateway, gatewayCtx)
  return payment
}

// Start (or restart) the payment for a pending order.
export async function startPayment(venue, order, settings, gateway, gatewayCtx = {}) {
  let result
  try {
    result = await gateway.start({ order, venue, ...gatewayCtx })
  } catch (err) {
    throw httpError(502, 'The payment could not be started: please try again')
  }

  return withTenant(venue.tenant_id, async tx => {
    let o = await loadOrderRow(tx, order.id)
    let client = null
    if (result.status === 'none') {
      o = await placeOrder(tx, o, settings, 'guest')
    } else {
      const status = result.status === 'succeeded' ? 'succeeded' : 'pending'
      const [p] = await tx`
        INSERT INTO order_payments (order_id, tenant_id, gateway, gateway_ref, amount_pence, status, raw)
        VALUES (${o.id}, ${o.tenant_id}, ${gateway.key}, ${result.ref ?? null},
                ${result.amount_pence ?? o.total_pence}, ${status}, ${tx.json(result.raw ?? {})})
        RETURNING id
      `
      if (status === 'succeeded') {
        const [paid] = await tx`
          UPDATE orders SET payment_status = 'paid', paid_pence = paid_pence + ${result.amount_pence ?? o.total_pence}
           WHERE id = ${o.id} RETURNING ${ORDER_COLS}
        `
        await addEvent(tx, paid, 'payment', { detail: { gateway: gateway.key, payment_id: p.id, status }, actor: 'guest' })
        o = await placeOrder(tx, paid, settings, 'guest')
      } else {
        const [pending] = await tx`UPDATE orders SET payment_status = 'pending' WHERE id = ${o.id} RETURNING ${ORDER_COLS}`
        o = pending
        client = { ...(result.client || {}), payment_id: p.id }
      }
    }
    return { order: o, client }
  }).then(res => {
    if (res.order.status !== 'pending_payment') afterPlaced(res.order)
    return res
  })
}

// A gateway reports a payment's outcome (from the browser via
// confirmFromClient, or from a webhook). Idempotent: a payment that has
// already succeeded is left alone.
export async function applyPaymentResult(tenantId, paymentId, { status, raw = {} }) {
  let placed = null
  let updated = null
  let duplicate = null
  const res = await withTenant(tenantId, async tx => {
    const [p] = await tx`SELECT * FROM order_payments WHERE id = ${paymentId} FOR UPDATE`
    if (!p) throw httpError(404, 'Payment not found')
    if (p.status === 'succeeded' || p.status === 'refunded' || p.status === 'partially_refunded') {
      return { order: await loadOrderRow(tx, p.order_id), payment: p }
    }
    const next = status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : status === 'cancelled' ? 'cancelled' : 'pending'
    const [pay] = await tx`
      UPDATE order_payments SET status = ${next}, raw = raw || ${tx.json(raw)}, updated_at = now()
       WHERE id = ${p.id} RETURNING *
    `
    let o = await loadOrderRow(tx, p.order_id)
    if (next === 'succeeded' && o.paid_pence >= o.total_pence) {
      // Already paid by another attempt (e.g. a retry went through first):
      // this money goes straight back.
      duplicate = { payment: pay, order: o }
      await addEvent(tx, o, 'note', { detail: { message: 'A second payment arrived for a paid order and is being refunded', payment_id: pay.id }, actor: 'system' })
      return { order: o, payment: pay }
    }
    if (next === 'succeeded') {
      const [paid] = await tx`
        UPDATE orders SET payment_status = 'paid', paid_pence = paid_pence + ${pay.amount_pence}
         WHERE id = ${o.id} RETURNING ${ORDER_COLS}
      `
      o = paid
      await addEvent(tx, o, 'payment', { detail: { gateway: pay.gateway, payment_id: pay.id, status: next }, actor: 'guest' })
      if (o.status === 'pending_payment') {
        const settings = await loadSettings(tx, o.venue_id)
        o = await placeOrder(tx, o, settings, 'guest')
        placed = o
      } else if (o.status === 'expired' || o.status === 'cancelled') {
        // Paid after the order was given up on: keep the record so staff
        // see it and can refund.
        await addEvent(tx, o, 'note', { detail: { message: 'Payment arrived after the order had ' + o.status }, actor: 'system' })
        updated = o
      }
    } else if (next === 'failed') {
      const [f] = await tx`UPDATE orders SET payment_status = 'failed' WHERE id = ${o.id} AND payment_status <> 'paid' RETURNING ${ORDER_COLS}`
      o = f || o
      await addEvent(tx, o, 'payment', { detail: { gateway: pay.gateway, payment_id: pay.id, status: next }, actor: 'guest' })
    }
    return { order: o, payment: pay }
  })
  if (placed) afterPlaced(placed)
  else if (updated) notify(updated, 'updated')
  if (duplicate) await refundDuplicate(tenantId, duplicate)
  return res
}

async function refundDuplicate(tenantId, { payment, order }) {
  const gateway = getGateway(payment.gateway)
  let ref = null
  let error = null
  try {
    if (!gateway?.refund) throw new Error('This gateway cannot refund online')
    ref = (await gateway.refund({ payment, amount_pence: payment.amount_pence }))?.ref ?? null
  } catch (err) {
    error = err.message
  }
  await withTenant(tenantId, async tx => {
    if (!error) {
      await tx`
        UPDATE order_payments SET status = 'refunded', refunded_pence = amount_pence,
               raw = raw || ${tx.json({ duplicate_refund: { ref } })}, updated_at = now()
         WHERE id = ${payment.id}
      `
    }
    await addEvent(tx, order, 'refund', {
      detail: { duplicate: true, payment_id: payment.id, amount_pence: payment.amount_pence, ref, error },
      actor: 'system',
    })
  })
  notify(order, 'updated')
}

// ── Staff actions ──────────────────────────────────────────────

export async function changeStatus(tenantId, orderId, to, { actor, reason = null, prepMinutes = null } = {}) {
  let from
  const res = await withTenant(tenantId, async tx => {
    const [o] = await tx`SELECT ${ORDER_COLS} FROM orders WHERE id = ${orderId} FOR UPDATE`
    if (!o) throw httpError(404, 'Order not found')
    from = o.status
    if (!(TRANSITIONS[o.status] || []).includes(to)) {
      throw httpError(409, `Can't change an order from ${o.status} to ${to}`)
    }
    const stamp = {
      accepted: sql`accepted_at = now()`, ready: sql`ready_at = now()`, completed: sql`completed_at = now()`,
      rejected: sql`cancelled_at = now()`, cancelled: sql`cancelled_at = now()`,
    }[to] ?? sql`updated_at = now()`
    const promised = to === 'accepted' && prepMinutes
      ? sql`, promised_at = GREATEST(promised_at, now() + make_interval(mins => ${Number(prepMinutes)}))`
      : sql``
    const [u] = await tx`
      UPDATE orders
         SET status = ${to}, ${stamp}${promised},
             cancel_reason = ${to === 'rejected' || to === 'cancelled' ? reason : o.cancel_reason}
       WHERE id = ${o.id}
       RETURNING ${ORDER_COLS}
    `
    await addEvent(tx, u, 'status', { from: o.status, to, actor, detail: reason ? { reason } : {} })
    return u
  })

  // Turning down or cancelling a paid order gives the money back.
  let refund = null
  if ((to === 'rejected' || to === 'cancelled') && res.paid_pence - res.refunded_pence > 0) {
    try {
      refund = await refundOrder(tenantId, orderId, { actor, reason: reason || (to === 'rejected' ? 'Order rejected' : 'Order cancelled'), notifyGuest: false })
    } catch (err) {
      refund = { error: err.message }
    }
  }
  const order = refund?.order || res
  afterStatus(order, from)
  return { order, refund }
}

export async function changePromisedTime(tenantId, orderId, { promisedAt, actor }) {
  const o = await withTenant(tenantId, async tx => {
    const [u] = await tx`
      UPDATE orders SET promised_at = ${promisedAt}
       WHERE id = ${orderId} AND status IN ('placed', 'accepted', 'preparing', 'ready')
       RETURNING ${ORDER_COLS}
    `
    if (!u) throw httpError(409, 'This order can no longer be retimed')
    await addEvent(tx, u, 'time', { detail: { promised_at: promisedAt }, actor })
    return u
  })
  notify(o, 'updated')
  return o
}

// Staff record a payment taken at the counter.
export async function markPaid(tenantId, orderId, { method, actor }) {
  if (!COUNTER_METHODS[method]) throw httpError(400, 'Unknown payment method')
  const o = await withTenant(tenantId, async tx => {
    const [cur] = await tx`SELECT ${ORDER_COLS} FROM orders WHERE id = ${orderId} FOR UPDATE`
    if (!cur) throw httpError(404, 'Order not found')
    const due = cur.total_pence - cur.paid_pence
    if (due <= 0) throw httpError(409, 'This order is already paid')
    if (['pending_payment', 'rejected', 'cancelled', 'expired'].includes(cur.status)) {
      throw httpError(409, 'This order is not open')
    }
    await tx`
      INSERT INTO order_payments (order_id, tenant_id, gateway, amount_pence, status, raw)
      VALUES (${cur.id}, ${cur.tenant_id}, ${method}, ${due}, 'succeeded', ${tx.json({ recorded_by: actor })})
    `
    const [u] = await tx`
      UPDATE orders SET payment_status = 'paid', paid_pence = paid_pence + ${due}
       WHERE id = ${cur.id} RETURNING ${ORDER_COLS}
    `
    await addEvent(tx, u, 'payment', { detail: { method, amount_pence: due }, actor })
    return u
  })
  notify(o, 'updated')
  return o
}

// Refund some or all of what was paid. Online payments go back through
// their gateway; counter payments (cash, card terminal) are recorded as
// refunded by staff at the counter.
export async function refundOrder(tenantId, orderId, { amountPence = null, reason = null, actor, notifyGuest = true }) {
  const plan = await withTenant(tenantId, async tx => {
    const [o] = await tx`SELECT ${ORDER_COLS} FROM orders WHERE id = ${orderId}`
    if (!o) throw httpError(404, 'Order not found')
    const refundable = o.paid_pence - o.refunded_pence
    if (refundable <= 0) throw httpError(409, 'Nothing left to refund')
    const want = amountPence == null ? refundable : Math.min(Number(amountPence), refundable)
    if (!(want > 0)) throw httpError(400, 'Refund amount must be more than zero')
    const payments = await tx`
      SELECT * FROM order_payments
       WHERE order_id = ${o.id} AND status IN ('succeeded', 'partially_refunded')
       ORDER BY created_at DESC
    `
    return { order: o, want, payments }
  })

  let left = plan.want
  const done = []
  for (const p of plan.payments) {
    if (left <= 0) break
    const avail = p.amount_pence - p.refunded_pence
    if (avail <= 0) continue
    const amount = Math.min(avail, left)
    const gateway = getGateway(p.gateway)
    let ref = null
    if (gateway) {
      if (typeof gateway.refund !== 'function') throw httpError(422, `${gateway.adminLabel || gateway.label} payments can't be refunded online: refund at the counter`)
      const r = await gateway.refund({ payment: p, amount_pence: amount })
      ref = r?.ref ?? null
    }
    done.push({ payment: p, amount, ref })
    left -= amount
  }

  const order = await withTenant(tenantId, async tx => {
    for (const d of done) {
      await tx`
        UPDATE order_payments
           SET refunded_pence = refunded_pence + ${d.amount},
               status = CASE WHEN refunded_pence + ${d.amount} >= amount_pence THEN 'refunded' ELSE 'partially_refunded' END,
               raw = raw || ${tx.json({ refunds: [{ amount_pence: d.amount, ref: d.ref, at: new Date().toISOString() }] })},
               updated_at = now()
         WHERE id = ${d.payment.id}
      `
    }
    const total = done.reduce((s, d) => s + d.amount, 0)
    const [u] = await tx`
      UPDATE orders
         SET refunded_pence = refunded_pence + ${total},
             payment_status = CASE WHEN refunded_pence + ${total} >= paid_pence THEN 'refunded' ELSE 'partially_refunded' END
       WHERE id = ${orderId}
       RETURNING ${ORDER_COLS}
    `
    await addEvent(tx, u, 'refund', { detail: { amount_pence: total, reason, payments: done.map(d => ({ id: d.payment.id, gateway: d.payment.gateway, amount_pence: d.amount, ref: d.ref })) }, actor })
    return u
  })
  if (notifyGuest) notify(order, 'updated')
  return { order, refunded_pence: plan.want - left }
}

// ── Expiry sweep ───────────────────────────────────────────────
// Unpaid online orders older than PENDING_TTL_MINS give their slot back.
// Runs across tenants (bare sql, like the booking hold sweep).
export async function expireStaleOrders(log) {
  const rows = await sql`
    UPDATE orders
       SET status = 'expired', cancelled_at = now(), cancel_reason = 'Payment not completed'
     WHERE status = 'pending_payment'
       AND created_at < now() - make_interval(mins => ${PENDING_TTL_MINS})
     RETURNING id, tenant_id, venue_id, status, order_number, payment_status
  `
  for (const o of rows) {
    try {
      await withTenant(o.tenant_id, async tx => {
        await addEvent(tx, o, 'status', { from: 'pending_payment', to: 'expired', actor: 'system' })
        const pending = await tx`SELECT * FROM order_payments WHERE order_id = ${o.id} AND status = 'pending'`
        for (const p of pending) {
          const g = getGateway(p.gateway)
          try { await g?.cancel?.({ payment: p }) } catch (err) { log?.warn?.({ err, payment: p.id }, 'Could not cancel payment') }
          await tx`UPDATE order_payments SET status = 'cancelled', updated_at = now() WHERE id = ${p.id}`
        }
      })
    } catch (err) {
      log?.warn?.({ err, order: o.id }, 'Order expiry follow-up failed')
    }
    notify(o, 'updated')
  }
  return rows.length
}

// ── Loading for the admin and the guest ───────────────────────

export async function loadAdminOrder(tx, id) {
  const o = await loadOrderRow(tx, id)
  if (!o) return null
  const [items, events, payments, promos] = await Promise.all([
    loadItems(tx, id),
    tx`SELECT * FROM order_events WHERE order_id = ${id} ORDER BY created_at`,
    tx`SELECT id, gateway, gateway_ref, amount_pence, refunded_pence, status, created_at FROM order_payments WHERE order_id = ${id} ORDER BY created_at`,
    loadOrderPromotions(tx, id),
  ])
  return adminOrder(o, items, { events, payments }, promos)
}

export async function loadPublicOrderByToken(token) {
  const [meta] = await sql`
    SELECT o.id, o.tenant_id, v.name AS venue_name, v.timezone
      FROM orders o JOIN venues v ON v.id = o.venue_id
     WHERE o.public_token = ${token} LIMIT 1
  `
  if (!meta) return null
  return withTenant(meta.tenant_id, async tx => {
    const o = await loadOrderRow(tx, meta.id)
    const items = await loadItems(tx, meta.id)
    const promotions = await loadOrderPromotions(tx, meta.id)
    const [pending] = await tx`
      SELECT id, gateway FROM order_payments WHERE order_id = ${meta.id} AND status IN ('pending', 'failed')
       ORDER BY created_at DESC LIMIT 1
    `
    return { order: o, items, promotions, venue: { name: meta.venue_name, timezone: meta.timezone }, pendingPayment: pending || null }
  })
}
