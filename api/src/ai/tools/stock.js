// src/ai/tools/stock.js
//
// Stock for Pepper (staff assistant and staff MCP): on hand, counts and each
// item's ledger (migration 287; inventory phase 4a, migrations 305 to 307).
// Every tool reads and counts only through the Stock page's own routes
// (callApi to /api/stock), so the figures, the checks and who may do what
// are the page's: Stock View reads, Stock Use counts, approving is Manage.
// Moved here from tools/purchasing.js with the stock area.
//
//   stock_on_hand   items at a venue by name, code or barcode, or the low
//                   ones against the venue's pars                      read
//   stock_moves     one item's ledger at a venue: deliveries, counts and
//                   adjustments with the running balance (values with
//                   Costing view)                                       read
//   usage_summary   phase 5: what sales took off at a venue over the last
//                   days, an item's by day and channel, a dish's sold and
//                   uncosted with why                                   read
//   count_stock     a count of the items the person names, in the units
//                   they say (2 cases and 400 g; the item's own units and
//                   its supplier packs), by storage area when they say one;
//                   submitted, and approved at once when the person may
//                   approve it                                  consequential
// Phase 4b (migrations 308 and 309):
//   log_waste       an item, a prep batch or a dish wasted, in the person's
//                   units, with a reason; the card shows what it takes off
//                   (POST .../waste/preview); Undo on its trading day reversible
//   waste_summary   waste over the last days by reason, kind, item, dish,
//                   person or day, the till's voids marked wasted in it  read
//   send_transfer   stock sent to another of the group's venues consequential
//   receive_transfer  a transfer on its way to the venue, received with what
//                   arrived (as sent where the person says nothing) consequential
// Phase 6a (migration 312):
//   variance_summary  a venue's period (between two full counts): food cost
//                   actual and theoretical, the flagged items, the biggest
//                   losses (the Variance tab's figures)                 read
//   explain_variance  one item's variance in a period and the evidence for it,
//                   each with where it is put right (shared/variance.js) read
// Closing and reopening a period stay on the page (a manager's step, with a note).
// Phase 9a (migrations 319 and 320):
//   suggested_order  what to order from a supplier for a venue: each item's
//                   forecast use to the delivery after next plus the buffer,
//                   less on hand and on order, in packs, with the working
//                   (GET /api/stock/venues/:id/suggested-order)          read
// Ordering itself stays with the order tools (update_order, place_order) once the person agrees.
//
// The model is given names, never ids (rule 19): items and areas are picked
// by name, code or barcode, and nothing it returns carries an id.

import { z } from 'zod'
import { callApi, staffPermissionLevel, levelAtLeast, ToolError } from '../context.js'
import { VenueText, venueFor, pickByName, plural, audited, localParts, longDate } from './util.js'
import { formatBase, UNITS } from '../../../../shared/procurement.js'
import { entriesToBase, entriesText, unitChoice, signedBase, lostInTransit, asSentEntry, WASTE_KINDS } from '../../../../shared/stock.js'
import { pounds } from '../../../../shared/costing.js'
import { quantityWords, SUGGEST_BASES } from '../../../../shared/forecast.js'

const COUNTED = { g: 'by weight (g / kg)', ml: 'by volume (ml / l)', each: 'by count (each)' }
const MAX_SHOWN = 60
const MAX_MOVES = 40
const Entry = z.object({
  qty:  z.number().min(0).max(100000000),
  unit: z.string().trim().min(1).max(80).describe('g, kg, ml, l, each, one of the item\'s own units (slice, portion) or a supplier pack (case, bag)'),
})

async function levelOf(ctx) {
  return staffPermissionLevel(ctx, 'stock')
}
async function requireView(ctx) {
  if (!levelAtLeast(await levelOf(ctx), 'view')) throw new ToolError('You don\'t have permission to see stock. Ask an owner or admin.', 403)
}

/** An item of the venue's stock list by our code, a barcode (its own or a supplier product's) or its name. */
function pickItem(items, text) {
  const raw = String(text ?? '').trim()
  const byCode = items.filter(i => i.code && i.code.toLowerCase() === raw.toLowerCase())
  if (byCode.length === 1) return byCode[0]
  const scan = raw.replace(/\s+/g, '')
  const byBarcode = /^[0-9]{8,14}$/.test(scan) ? items.filter(i => i.barcode === scan || (i.quote_barcodes || []).includes(scan)) : []
  if (byBarcode.length === 1) return byBarcode[0]
  return pickByName(items, raw, i => i.name, 'inventory item', 'The inventory is empty. Add items with add_inventory_item or import_price_list.')
}

const stockList = async (ctx, venue) => {
  const st = await callApi(ctx, 'GET', '/api/stock/venues/' + venue.id)
  return { ...st, items: st.items.map(i => ({ ...i, id: i.item_id })) }
}
const at = (when, tz) => { const l = localParts(when, tz); return longDate(l.date) + ' ' + l.time }
// Where a sale came from (usage from sales, phase 5), as Pepper says it.
const CHANNEL_WORDS = { till: 'till', kiosk: 'kiosk', online: 'online orders', imported: 'other tills', gloriafood: 'GloriaFood' }

// Variance (phase 6a): which period a person means, as the route's ?period= (an id read here, never shown).
async function periodQuery(ctx, venue, which = 'latest') {
  if (which === 'current') return '?period=current'
  const list = await callApi(ctx, 'GET', `/api/stock/venues/${venue.id}/periods`)
  const pick = which === 'last_closed' ? list.periods.find(p => p.status === 'closed') : list.periods[0]
  if (!pick) {
    if (which === 'last_closed') throw new ToolError(venue.name + ' has no closed stock period yet: a manager closes one on the Stock page\'s Variance tab.', 404)
    if (!list.current) throw new ToolError(venue.name + ' has no approved full count yet, so there is no variance to show.', 404)
    return '?period=current'
  }
  return '?period=' + pick.id
}
const periodText = p => (!p ? null : p.current ? 'since the last full count (' + p.words.replace(/ to now$/, '') + ' to now)' : p.words + ' (' + p.status + ')')
const ptsText = n => (n == null ? null : (Math.round(n * 100) / 100) + ' points')
const pctText = n => (n == null ? null : (Math.round(n * 10) / 10) + '%')

/** A period's variance in words (no ids). */
function varianceWords(venue, v) {
  const unitOf = r => r.base_unit
  const one = r => ({
    item: r.name,
    unexplained: r.unexplained == null ? 'not counted' : signedBase(r.unexplained, unitOf(r)),
    ...(r.unexplained_value != null ? { value: pounds(r.unexplained_value) } : {}),
    ...(r.share_pct != null ? { of_food_sales: ptsText(r.share_pct) } : {}),
    used: r.actual == null ? null : formatBase(r.actual, unitOf(r)), sales_took: formatBase(r.theoretical, unitOf(r)),
    ...(r.waste ? { waste: formatBase(r.waste, unitOf(r)) } : {}),
    ...(r.late ? { late_sales_in_it: formatBase(r.late, unitOf(r)) } : {}),
    ...(r.reviewed ? { reviewed: true } : {}),
  })
  const fc = v.food_cost
  return {
    venue: venue.name, period: periodText(v.period), closed: v.period?.status === 'closed',
    ...(fc ? {
      food_cost: {
        // Actual (and the gap) only over the same items as theoretical: not while an item sales used is uncounted.
        ...(fc.complete === false
          ? { actual: 'not known yet: ' + plural(fc.uncounted_used, 'item') + ' sales used ' + (fc.uncounted_used === 1 ? 'hasn\'t' : 'haven\'t') + ' been counted at both ends' }
          : { actual: pctText(fc.actual_pct), gap: ptsText(fc.gap_pts) }),
        theoretical: pctText(fc.theoretical_pct),
        net_food_sales: fc.net_food_pence == null ? null : pounds(fc.net_food_pence / 100),
      },
      ...(v.band?.unexplained_pct != null ? { unexplained_of_food_sales: ptsText(v.band.unexplained_pct), over_the_band: !!v.band.over } : {}),
    } : { food_cost: 'Food cost % needs Costing view and Till reports view.' }),
    ...(v.totals?.unexplained_value != null ? { unexplained_total: pounds(v.totals.unexplained_value), waste_total: pounds(v.totals.waste_value) } : {}),
    flagged: v.rows.filter(r => r.flagged).slice(0, 15).map(one),
    biggest_losses: v.rows.filter(r => (r.unexplained ?? 0) > 0).slice(0, 10).map(one),
    items: v.rows.length, not_counted: v.totals?.not_counted ?? 0,
    ...(v.period?.current ? { note: 'Running since the last full count: actual usage shows only for items counted since.' } : {}),
    ...(!v.rows.length ? { message: 'No stock moved at ' + venue.name + ' in that period.' } : {}),
  }
}

// This file's place, its area and what Pepper is told about it (tools/index.js gathers them).
export const order = 82
export const sections = {
  stock: { label: 'Stock: on hand, counts, waste, transfers and each item\'s history', modules: ['stock'] },
}
export const promptLines = [
  'Stock: stock_on_hand (how much of an item there is at a venue, or what is below its par), stock_moves (an item\'s ' +
    'history at a venue: deliveries, counts and adjustments with the running balance), usage_summary (what sales took off: ' +
    'an item by day and channel, a dish sold with what couldn\'t be costed), count_stock (a count of the ' +
    'items the person names, in their units, by storage area), log_waste (an item, a prep batch or a dish thrown away, ' +
    'with a reason; Undo on its card for 10 minutes), waste_summary (what was wasted by reason, kind, item or person), send_transfer and ' +
    'receive_transfer (stock moved between venues in two steps), variance_summary (a period\'s food cost actual against ' +
    'theoretical and the items flagged) and explain_variance (why one item\'s stock is out, with the evidence and where to put it right). ' +
    'suggested_order: what to order from a supplier for a venue, worked out from sales, covers booked, on hand and on order, with the working.',
]
export const promptNotes = [
  'Stock: on hand is the last approved count plus the deliveries, adjustments, waste and transfers since, less what sales took off ' +
    '(usage from sales: each sold dish broken into items by its recipe, worked out every few minutes, so today\'s sales count up to ' +
    'the last run; stock_on_hand\'s note says when). A dish with no recipe takes nothing off: usage_summary lists what sold uncosted. ' +
    'count_stock records only what the person counted, in their numbers and units (2 cases and 400 g is ' +
    'one item in two units): never work a count out, and with blind counts on never tell the counter what is ' +
    'expected (stock_on_hand) before their count is in. A count someone who can approve makes is approved at once; ' +
    'anyone else\'s waits for approval on the Stock page. A full count of the venue, by area, is done on the Stock ' +
    'page or the phone\'s count page (open_form stock_key_count starts a key-item count from a list).',
  'Waste: log_waste records what the person says was thrown away, in their numbers; pick the reason from the group\'s ' +
    'list by its meaning (dropped: Dropped or spilt; past its date: Out of date). A dish voided on the till as wasted is ' +
    'waste already: never log it again. A dish or batch is broken into items by its recipe, and the card says when the ' +
    'recipe can\'t (no recipe, a draft nobody checked). Transfers: send_transfer from one venue, receive_transfer at the ' +
    'other with what arrived (only the person\'s figures; items not mentioned arrived as sent). open_form stock_waste and ' +
    'stock_transfer open the forms.',
  'Variance: a period runs between two approved full counts at a venue. Actual usage is opening + received + transfers in - ' +
    'transfers out - closing; theoretical is what sales took by their recipes; waste and adjustments explain their part and ' +
    'the rest is unexplained (a loss above zero). Give pounds and food cost % only as the tools give them (they need Costing ' +
    'view, and food cost Till reports view too), never work them out. Closing or reopening a period is done on the Stock ' +
    'page\'s Variance tab by a manager: Pepper doesn\'t close or reopen periods.',
  'Suggested orders: suggested_order gives, for each item a supplier sells the venue, the forecast use until the delivery ' +
    'after next (the same weekday over the last four weeks of sales, scaled by covers booked against the usual) plus the ' +
    'group\'s buffer, less what is on hand and on order, in whole packs up to the minimum; an item sales never used is ' +
    'filled up to its par. Give its figures and its why as it says them, never work a quantity out yourself. It orders ' +
    'nothing: when the person wants it, fill the order with update_order using those quantities, and let them check and place it.',
]

export const tools = [
  {
    name: 'stock_on_hand',
    title: 'Stock on hand',
    activity: 'Looked at stock on hand',
    description:
      'How much of an inventory item there is at a venue: its last approved stock count plus what was delivered, ' +
      'adjusted, wasted (the till\'s voids marked wasted too) and moved by transfer since (sent, received, lost in transit), ' +
      'and less what sales took off (usage from sales, up to the last run, which its note says), the Stock page\'s On hand ' +
      'tab, the same figures. items: ' +
      'a few names, codes or barcodes; or low: true for every item below its par at the venue (pars from its order ' +
      'lists); with neither, every counted item. For "how much rice have we got?".',
    input: z.object({
      venue: VenueText,
      items: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
      low:   z.boolean().optional().describe('Only items below their par at the venue'),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireView(ctx)
      const venue = await venueFor(ctx, input.venue)
      const tz = venue.timezone || 'Europe/London'
      const st = await stockList(ctx, venue)
      let picked
      if (input.items?.length) picked = [...new Map(input.items.map(t => { const r = pickItem(st.items, t); return [r.id, r] })).values()]
      else if (input.low) picked = st.items.filter(r => r.low)
      else picked = st.items.filter(r => r.on_hand != null || r.received_since > 0)
      return {
        venue: venue.name,
        note: st.note,
        items: picked.slice(0, MAX_SHOWN).map(r => ({
          name: r.name,
          on_hand: r.on_hand == null ? 'never counted here' : formatBase(r.on_hand, r.base_unit),
          ...(r.counted_at ? { last_count: formatBase(r.counted, r.base_unit) + ' on ' + at(r.counted_at, tz) } : {}),
          ...(r.received_since ? { received_since: formatBase(r.received_since, r.base_unit) } : {}),
          ...(r.adjusted_since ? { adjusted_since: signedBase(r.adjusted_since, r.base_unit) } : {}),
          ...(r.wasted_since ? { wasted_since: signedBase(r.wasted_since, r.base_unit) } : {}),
          ...(r.transferred_since ? { transferred_since: signedBase(r.transferred_since, r.base_unit) } : {}),
          ...(r.used_since ? { sold_since: signedBase(r.used_since, r.base_unit) } : {}),
          ...(r.par_base != null ? { par: formatBase(r.par_base, r.base_unit) } : {}),
          ...(r.areas?.length ? { kept_in: r.areas.join(', ') } : {}),
          ...(r.value != null ? { value: pounds(r.value) } : {}),
          ...(r.low ? { low: true } : {}),
        })),
        ...(picked.length > MAX_SHOWN ? { showing: MAX_SHOWN, of: picked.length } : {}),
        ...(!picked.length ? { message: input.low ? 'Nothing is below its par at ' + venue.name + ' (only counted items with a par can be).' : 'Nothing has been counted or delivered at ' + venue.name + ' yet.' } : {}),
      }
    },
  },

  {
    name: 'stock_moves',
    title: 'An item\'s stock history',
    activity: 'Looked at an item\'s stock history',
    description:
      'One inventory item\'s history at a venue (the Stock page\'s item history): every delivery booked in, approved ' +
      'count, adjustment, waste (the till\'s voids marked wasted too) and transfer, newest first, each with its change and the balance after it; values in pounds for people ' +
      'with Costing view. days: how far back (default 30). For "why is the rice count so low?" or "when did we last ' +
      'get chicken?".',
    input: z.object({
      venue: VenueText,
      item:  z.string().trim().min(1).max(200).describe('Name, code or barcode'),
      days:  z.number().int().min(1).max(366).optional(),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireView(ctx)
      const venue = await venueFor(ctx, input.venue)
      const tz = venue.timezone || 'Europe/London'
      const st = await stockList(ctx, venue)
      const item = pickItem(st.items, input.item)
      const from = localParts(new Date(Date.now() - (input.days || 30) * 86400000), tz).date
      const h = await callApi(ctx, 'GET', `/api/stock/venues/${venue.id}/items/${item.id}/moves?from=${from}`)
      return {
        venue: venue.name,
        item: item.name,
        on_hand: h.on_hand.on_hand == null ? 'never counted here' : formatBase(h.on_hand.on_hand, item.base_unit),
        note: h.note,
        moves: h.moves.slice(0, MAX_MOVES).map(m => ({
          when: at(m.at, tz),
          what: m.kind_label + (m.source?.label ? ': ' + m.source.label : ''),
          ...(m.sets ? { counted: formatBase(m.qty_base, item.base_unit) } : {}),
          change: m.change == null ? 'first count' : signedBase(m.change, item.base_unit),
          balance: m.balance == null ? 'not counted yet' : formatBase(m.balance, item.base_unit),
          ...(m.by ? { by: m.by } : {}),
          ...(m.value != null ? { value: pounds(m.value) } : {}),
        })),
        ...(h.moves.length > MAX_MOVES ? { showing: MAX_MOVES, of: h.moves.length } : {}),
        ...(!h.moves.length ? { message: 'Nothing moved ' + item.name + ' at ' + venue.name + ' in the last ' + plural(input.days || 30, 'day') + '.' } : {}),
      }
    },
  },

  {
    name: 'usage_summary',
    title: 'Usage from sales',
    activity: 'Looked at usage from sales',
    description:
      'What sales took off stock at a venue over the last days (usage from sales, the Stock page\'s Usage tab): for an ' +
      'inventory item, how much each day with how much came from the till, kiosks, online orders and other tills; ' +
      'for a menu dish, how many sold each day by channel and how many couldn\'t be costed, with why. With neither, the ' +
      'items sales used most and the dishes sold without a full recipe. days: how far back (default 7, at most 31, today ' +
      'included up to the last run). For "how much chicken did we sell through yesterday?" or "why isn\'t the soup taking ' +
      'anything off stock?".',
    input: z.object({
      venue: VenueText,
      item:  z.string().trim().min(1).max(200).optional().describe('An inventory item: name, code or barcode'),
      dish:  z.string().trim().min(1).max(200).optional().describe('A menu dish by name'),
      days:  z.number().int().min(1).max(31).optional(),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireView(ctx)
      const venue = await venueFor(ctx, input.venue)
      const tz = venue.timezone || 'Europe/London'
      const days = input.days || 7
      const today = localParts(new Date(), tz).date
      const from = localParts(new Date(Date.now() - (days - 1) * 86400000), tz).date
      const u = await callApi(ctx, 'GET', `/api/stock/venues/${venue.id}/usage?from=${from}&to=${today}`)
      const split = (channels, unit) => Object.fromEntries(Object.entries(channels || {}).filter(([, v]) => Number(v))
        .map(([k, v]) => [CHANNEL_WORDS[k] || k, unit ? formatBase(v, unit) : Number(v)]))
      const base = { venue: venue.name, from, to: today, note: u.note }
      if (input.item) {
        const st = await stockList(ctx, venue)
        const item = pickItem(st.items, input.item)
        const total = u.items.find(i => i.item_id === item.id)
        const rows = u.by_day.filter(r => r.item_id === item.id)
        return {
          ...base, item: item.name,
          used: total ? formatBase(total.qty_base, item.base_unit) : 'nothing',
          ...(total ? { by_channel: split(total.channels, item.base_unit) } : {}),
          ...(total?.value != null ? { value: pounds(total.value) } : {}),
          days: rows.map(r => ({ day: longDate(r.day), used: formatBase(r.qty_base, item.base_unit), by_channel: split(r.channels, item.base_unit) })),
          ...(!total ? { message: 'Sales took no ' + item.name + ' off at ' + venue.name + ' in the last ' + plural(days, 'day') + ': no dish sold there uses it, or its dishes have no recipe linked.' } : {}),
        }
      }
      if (input.dish) {
        const picked = pickByName(u.dishes, input.dish, d => d.name, 'dish sold', 'Nothing was sold at ' + venue.name + ' in the last ' + plural(days, 'day') + '.')
        const why = u.uncosted.find(x => (x.dish_id || x.name) === (picked.dish_id || picked.name))
        return {
          ...base, dish: picked.name, sold: picked.qty, by_channel: split(picked.channels),
          ...(picked.recipe_name ? { recipe: picked.recipe_name } : {}),
          ...(picked.uncosted_qty ? { not_costed: picked.uncosted_qty, why: (why?.gaps || []).map(g => g.text + (g.fix ? ' (' + g.fix + ')' : '')) } : {}),
          ...(picked.cost != null ? { theoretical_cost: pounds(picked.cost) } : {}),
        }
      }
      return {
        ...base,
        used_most: u.items.slice(0, 15).map(i => ({ item: i.name, used: formatBase(i.qty_base, i.base_unit), ...(i.value != null ? { value: pounds(i.value) } : {}) })),
        sold_without_a_full_recipe: u.uncosted.slice(0, 15).map(x => ({ dish: x.name, not_costed: x.uncosted_qty, of: x.qty, why: x.gaps.map(g => g.text) })),
        ...(!u.items.length && !u.dishes.length ? { message: 'No sales were worked out at ' + venue.name + ' in the last ' + plural(days, 'day') + ' yet.' } : {}),
      }
    },
  },

  // Phase 9a (migrations 319 and 320): the suggested order, read through the stock route (the order form's Suggest is the same rule).
  {
    name: 'suggested_order',
    title: 'Suggested order',
    activity: 'Looked at a suggested order',
    description:
      'What to order from one supplier for a venue (the order form\'s Suggest, the same rule): for each item the supplier ' +
      'sells the venue that is on its order lists or that sales used lately, the forecast use until the delivery after next ' +
      '(what sales took on the same weekday over the last four weeks, scaled by the covers booked against the usual by now), ' +
      'plus the group\'s buffer, less on hand and on order, in whole packs up to the minimum, each with why. An item sales ' +
      'never used in those weeks is filled up to its par: here the highest on the venue\'s order lists, where an order ' +
      'form\'s Suggest takes the par on that order\'s own list, so those two can differ. delivery_date: when the order ' +
      'would arrive (YYYY-MM-DD; the supplier\'s next delivery when left out). It orders nothing. For "what should we ' +
      'order from Brakes?".',
    input: z.object({
      venue: VenueText,
      supplier: z.string().trim().min(1).max(200).describe('The supplier by name'),
      delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      items: z.array(z.string().trim().min(1).max(200)).max(20).optional().describe('Only these items, by name'),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireView(ctx)
      const venue = await venueFor(ctx, input.venue)
      const suppliers = await callApi(ctx, 'GET', `/api/purchasing/venues/${venue.id}/suppliers?all=1`)
      const supplier = pickByName(suppliers, input.supplier, x => x.name, 'supplier', 'There are no suppliers yet.')
      const q = new URLSearchParams({ supplier_id: supplier.id, ...(input.delivery_date ? { delivery_date: input.delivery_date } : {}) })
      const s = await callApi(ctx, 'GET', `/api/stock/venues/${venue.id}/suggested-order?${q}`)
      let lines = s.lines
      if (input.items?.length) lines = [...new Map(input.items.map(t => { const l = pickByName(s.lines, t, x => x.name, 'item from ' + supplier.name); return [l.item_id, l] })).values()]
      const shown = lines.filter(l => l.basis !== 'none')
      const covers = s.covers.filter(c => c.words).map(c => longDate(c.day) + ': ' + c.words)
      return {
        venue: venue.name, supplier: s.supplier_name,
        arrives: longDate(s.next_delivery), lasts_until: longDate(s.after) + ' (the delivery after next)',
        buffer: s.buffer_pct + '%',
        ...(covers.length ? { covers } : {}),
        lines: shown.slice(0, MAX_SHOWN).map(l => ({
          item: l.name,
          suggest: !l.qty ? 'nothing: on hand and on order cover it' : l.qty + ' x ' + l.pack_label,
          basis: SUGGEST_BASES[l.basis]?.label || l.basis,
          ...(l.forecast_base != null ? { forecast: quantityWords(l.forecast_base, l.base_unit) } : {}),
          on_hand: l.on_hand == null ? 'never counted here' : quantityWords(l.on_hand, l.base_unit),
          ...(l.on_order ? { on_order: quantityWords(l.on_order, l.base_unit) } : {}),
          why: l.summary,
          working: l.words,
        })),
        ...(shown.length > MAX_SHOWN ? { showing: MAX_SHOWN, of: shown.length } : {}),
        not_suggested: lines.filter(l => l.basis === 'none').map(l => ({ item: l.name, why: 'No sales use in the last four weeks and no par on the venue\'s order lists' })),
        page: '/purchasing',
        ...(!lines.length ? { message: supplier.name + ' sells ' + venue.name + ' nothing on its order lists, and sales used none of what it sells lately.' } : {}),
      }
    },
  },

  // Phase 6a (migration 312): variance by period, read through the Variance tab's routes.
  {
    name: 'variance_summary',
    title: 'Variance',
    activity: 'Looked at stock variance',
    description:
      'A venue\'s stock variance for a period (the Stock page\'s Variance tab): actual food cost % against theoretical ' +
      '(what the counts say was used against what sales took by their recipes, over net food sales), the items ' +
      'flagged by the group\'s band with their unexplained loss, and the biggest losses. A period runs between two ' +
      'approved full counts; period: latest (the newest one, open or closed; the default), last_closed, or current ' +
      '(running since the last full count: actual usage only for items counted since, so no actual food cost until every ' +
      'item sales used is counted). For "what was our food cost ' +
      'last week against theoretical?" or "where are we losing stock?". To ask why one item lost, use explain_variance.',
    input: z.object({
      venue: VenueText,
      period: z.enum(['latest', 'last_closed', 'current']).optional(),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireView(ctx)
      const venue = await venueFor(ctx, input.venue)
      const v = await callApi(ctx, 'GET', `/api/stock/venues/${venue.id}/variance${await periodQuery(ctx, venue, input.period)}`)
      return varianceWords(venue, v)
    },
  },

  {
    name: 'explain_variance',
    title: 'Why an item\'s stock is out',
    activity: 'Looked at why an item\'s stock is out',
    description:
      'Why an inventory item\'s stock is out in a period at a venue (explain_variance): its actual usage, what sales took, ' +
      'its waste and what is left unexplained, then the evidence from the documents, each with where it is put right: ' +
      'dishes sold without a recipe that use it, deliveries changed after the count, on hand going below zero, a unit ' +
      'that changed, waste logged, transfers not received, late sales from a closed period, remakes (not taken off as ' +
      'usage yet). period as variance_summary\'s. For "why are we short on chicken?" or "explain the cheese variance".',
    input: z.object({
      venue: VenueText,
      item:  z.string().trim().min(1).max(200).describe('An inventory item: name, code or barcode'),
      period: z.enum(['latest', 'last_closed', 'current']).optional(),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireView(ctx)
      const venue = await venueFor(ctx, input.venue)
      const q = await periodQuery(ctx, venue, input.period)
      const v = await callApi(ctx, 'GET', `/api/stock/venues/${venue.id}/variance${q}`)
      const inPeriod = v.rows.map(r => ({ ...r, id: r.item_id }))
      let item = null
      try {
        item = pickByName(inPeriod, input.item, r => r.name, 'item in the period', 'No stock moved at ' + venue.name + ' in that period.')
      } catch (err) {
        const st = await stockList(ctx, venue)
        item = pickItem(st.items, input.item)
        if (!item) throw err
      }
      const one = await callApi(ctx, 'GET', `/api/stock/venues/${venue.id}/variance/items/${item.item_id || item.id}${q}`)
      const r = one.row
      const unit = one.item.base_unit
      const f = n => (n == null ? null : formatBase(n, unit))
      return {
        venue: venue.name, period: periodText(v.period), item: one.item.name,
        ...(r ? {
          figures: {
            opening: f(r.opening), received: f(r.received), transfers_in: f(r.transfers_in), transfers_out: f(r.transfers_out),
            closing: r.closing == null ? 'not counted' : f(r.closing), actual_usage: f(r.actual),
            theoretical_usage: f(r.theoretical), ...(r.late ? { of_it_late_sales: f(r.late) } : {}),
            waste: f(r.waste), ...(r.adjusted ? { adjusted: signedBase(r.adjusted, unit) } : {}),
            variance: r.variance == null ? null : signedBase(r.variance, unit),
            unexplained: r.unexplained == null ? null : signedBase(r.unexplained, unit),
            ...(r.unexplained_value != null ? { unexplained_value: pounds(r.unexplained_value) } : {}),
          },
          flagged: !!r.flagged, ...(r.reviewed ? { reviewed_by: r.reviewed.by } : {}),
        } : { message: one.item.name + ' had no stock moves at ' + venue.name + ' in that period.' }),
        evidence: one.evidence.map(e => ({ what: e.label, says: e.text, fix: e.fix, ...(e.page ? { page: e.page } : {}) })),
        ...(one.evidence.length ? {} : { note: 'Nothing in the documents points at a cause: count it again, or look at how its dishes are made.' }),
      }
    },
  },

  {
    name: 'count_stock',
    class: 'consequential',
    needs: 'use',
    title: 'Record a stock count',
    activity: 'Recorded a stock count',
    description:
      'Records a stock count at a venue for one or more inventory items: how much is there now, in the units the ' +
      'person says. One item can be given in several units (2 cases + 3 each + 400 g: entries), in the item\'s ' +
      'standard units (kg or g for an item by weight, l or ml by volume, each by count), its own units (slice, ' +
      'portion) or its supplier packs (case, bag). area: the storage area it was counted in (Walk-in), when the ' +
      'person says one. Only what the person counted, in their numbers: never work a count out. Only these items ' +
      'change; the count is approved at once when the person may approve counts, else it waits for approval. Needs ' +
      'Stock use.',
    input: z.object({
      venue: VenueText,
      counts: z.array(z.object({
        item: z.string().trim().min(1).max(200).describe('Name, code or barcode'),
        qty:  z.number().min(0).max(100000000).optional().describe('One quantity (or use entries for several units)'),
        unit: z.string().trim().min(1).max(80).optional().describe('Leave out for the item\'s own unit (g, ml or each)'),
        entries: z.array(Entry).max(6).optional().describe('Several units on one line: [{ qty: 2, unit: "case" }, { qty: 400, unit: "g" }]'),
        area: z.string().trim().min(1).max(60).optional().describe('The storage area it was counted in'),
      })).min(1).max(100),
      note: z.string().trim().max(500).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      const p = await countPlan(ctx, input)
      const warnings = []
      if (!p.approves) warnings.push('This count waits for someone who approves counts before on hand changes.')
      if (input.note) warnings.push('Note: ' + input.note)
      // Blind counts (a stock setting): what is expected stays hidden until the count is in, here
      // as on the counting sheet, so the card never shows today's figure beside the counter's.
      return {
        title: 'Record this count at ' + p.venue.name + '?',
        lines: p.lines.map(l => l.item.name + ': ' + l.text + (l.area ? ' in ' + l.area.name : '') +
          (!p.blind && l.item.on_hand != null ? ' (was ' + formatBase(l.item.on_hand, l.item.base_unit) + ')' : '')),
        ...(warnings.length ? { warningTitle: p.approves ? 'Note' : 'Approval', warnings } : {}),
        confirmLabel: p.approves ? 'Record count' : 'Submit count',
      }
    },
    async run(ctx, input) {
      const p = await countPlan(ctx, input)
      return audited(ctx, 'count_stock', input, async () => {
        const out = await callApi(ctx, 'POST', '/api/stock/venues/' + p.venue.id + '/counts', {
          body: {
            lines: p.lines.map(l => ({ item_id: l.item.id, area_id: l.area?.id ?? null, entries: l.entries.map(e => ({ qty: e.qty, unit: e.unit })) })),
            ...(input.note ? { note: input.note } : {}),
          },
        })
        return {
          venue: p.venue.name, counted: out.lines, status: out.status,
          message: out.status === 'approved'
            ? 'Count recorded: ' + plural(out.lines, 'item') + '.'
            : 'Count submitted: ' + plural(out.lines, 'item') + ', waiting for someone who approves counts (the Stock page, Counts).',
        }
      })
    },
  },
  // ── Waste and transfers (phase 4b, migrations 308 and 309) ──────────

  {
    name: 'log_waste',
    class: 'reversible',
    needs: 'use',
    title: 'Log waste',
    activity: 'Logged waste',
    description:
      'Logs waste at a venue: an inventory item, a prep batch (a prep recipe: 2 litres of curry sauce) or a menu dish ' +
      '(3 burgers), how much in the person\'s units, and why, by one of the group\'s waste reasons (Dropped or spilt, ' +
      'Out of date, Made too much, Sent back by a guest...). "We dropped a tray of 12 chicken thighs" is the item Chicken ' +
      'thighs, qty 12 (or 1 tray when the item has a tray unit), reason Dropped or spilt. what: item, batch or dish when ' +
      'a name could be either; order_type for a dish taken away or delivered (its recipe can differ). A batch or a dish ' +
      'is broken into its items by its recipe; the card shows what it takes off stock and anything the recipe can\'t say. ' +
      'Never log a dish voided on the till as wasted: the till counts it already. Undo on the card takes it back for 10 ' +
      'minutes; after that it is undone on the Stock page\'s Waste tab on its trading day, or reversed by someone with ' +
      'Stock manage. Needs Stock use.',
    input: z.object({
      venue: VenueText,
      thing: z.string().trim().min(1).max(200).describe('The item, prep recipe or dish, by name, code or barcode'),
      what: z.enum(['item', 'batch', 'dish']).optional().describe('Only when the name could be more than one kind'),
      qty: z.number().positive().max(1000000),
      unit: z.string().trim().min(1).max(80).optional().describe('An item\'s unit (kg, g, each, tray, case); a batch\'s (l, kg); leave out for dishes'),
      reason: z.string().trim().min(1).max(60).describe('One of the group\'s waste reasons, by name'),
      order_type: z.string().trim().min(1).max(60).optional().describe('A dish\'s order type: Take out, Delivery'),
      note: z.string().trim().max(500).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      const p = await wastePlan(ctx, input)
      const pv = await callApi(ctx, 'POST', `/api/stock/venues/${p.venue.id}/waste/preview`, { body: p.body })
      const took = pv.items.length
        ? 'Takes off: ' + pv.items.map(i => i.name + ' ' + formatBase(i.qty_base, i.base_unit)).join(', ') + (pv.value != null ? ' (' + pounds(pv.value) + ')' : '')
        : 'Takes nothing off stock: it can\'t be broken into items yet'
      const warnings = [...pv.gaps]
      if (input.note) warnings.push('Note: ' + input.note)
      return {
        title: 'Log this waste at ' + p.venue.name + '?',
        lines: [pv.typed + ' · ' + pv.reason + ' (' + (WASTE_KINDS[pv.reason_kind]?.label || pv.reason_kind).toLowerCase() + ')', took],
        ...(warnings.length ? { warningTitle: pv.gaps.length ? 'Check' : 'Note', warnings } : {}),
        confirmLabel: 'Log waste',
      }
    },
    async run(ctx, input) {
      const p = await wastePlan(ctx, input)
      return audited(ctx, 'log_waste', input, async () => {
        const e = await callApi(ctx, 'POST', `/api/stock/venues/${p.venue.id}/waste`, { body: p.body })
        return {
          venue: p.venue.name, logged: e.name + ', ' + e.qty + ' ' + (e.what === 'dish' ? 'x' : e.unit), reason: e.reason,
          took_off: e.items.map(i => i.name + ' ' + formatBase(Math.abs(i.qty_base), i.base_unit)),
          ...(e.value != null ? { value: pounds(e.value) } : {}),
          ...(e.gaps.length ? { gaps: e.gaps } : {}),
          message: 'Logged as waste' + (e.items.length ? ': taken off stock.' : ', but nothing was taken off stock (see gaps).'),
          page: '/stock?tab=waste',
          _undo: { waste_id: e.id },
        }
      })
    },
    // Undo: the entry undone, on its trading day (the route says no after it: Stock manage reverses it then).
    async inverse(ctx, undo) {
      await callApi(ctx, 'POST', `/api/stock/waste/${undo.waste_id}/undo`, { body: {} })
      return { message: 'Undone: the waste is no longer taken off stock.' }
    },
  },

  {
    name: 'waste_summary',
    title: 'Waste summary',
    activity: 'Looked at waste',
    description:
      'What was wasted at a venue over the last days (7 unless asked; today counts): by reason, kind (WRAP\'s spoilage, ' +
      'preparation, plate), item, dish, person or day, each with how many entries and, for people with Costing view, ' +
      'its value at what was paid. The till\'s voids marked wasted are in it (test till sales left out). For "what did ' +
      'we waste this week?" or "how much chicken went in the bin?".',
    input: z.object({
      venue: VenueText,
      days: z.number().int().min(1).max(93).optional(),
      by: z.enum(['reason', 'kind', 'item', 'dish', 'person', 'day']).optional(),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireView(ctx)
      const venue = await venueFor(ctx, input.venue)
      // The last days up to the venue's trading day today (the route's: the till's day start), never the calendar date.
      const s = await callApi(ctx, 'GET', `/api/stock/venues/${venue.id}/waste/summary?days=${input.days || 7}&by=${input.by || 'reason'}`)
      return {
        venue: venue.name, from: longDate(s.from), to: longDate(s.to), by: s.by,
        entries: s.entries, ...(s.till_voids ? { of_which_till_voids: s.till_voids } : {}),
        ...(s.value != null ? { value: pounds(s.value) } : {}),
        rows: s.rows.slice(0, MAX_SHOWN).map(r => ({
          [s.by]: s.by === 'kind' ? (WASTE_KINDS[r.key]?.label || r.label) : r.label, entries: r.entries,
          ...(r.qty != null && s.by === 'item' ? { qty: formatBase(r.qty, r.unit) } : {}),
          ...(r.value != null ? { value: pounds(r.value) } : {}),
        })),
        ...(!s.rows.length ? { message: 'Nothing was logged as waste at ' + venue.name + ' in those days.' } : {}),
      }
    },
  },

  {
    name: 'send_transfer',
    class: 'consequential',
    needs: 'use',
    title: 'Send stock to another venue',
    activity: 'Sent stock to another venue',
    description:
      'Sends stock from one of the group\'s venues to another (the Stock page\'s Transfers): the items in the person\'s ' +
      'units (3 trays, 2 kg, 1 case). It leaves the sending venue now and arrives when someone at the other venue ' +
      'receives it (receive_transfer). Valued at the sender\'s average cost. Needs Stock use.',
    input: z.object({
      from: VenueText.describe('The venue it leaves'),
      to: z.string().trim().min(1).max(120).describe('The venue it goes to'),
      items: z.array(z.object({
        item: z.string().trim().min(1).max(200).describe('Name, code or barcode'),
        qty: z.number().positive().max(100000000),
        unit: z.string().trim().min(1).max(80).optional().describe('Leave out for the item\'s own unit'),
      })).min(1).max(50),
      note: z.string().trim().max(500).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      const p = await sendPlan(ctx, input)
      return {
        title: 'Send ' + plural(p.lines.length, 'item') + ' from ' + p.from.name + ' to ' + p.to.name + '?',
        lines: p.lines.map(l => l.item.name + ': ' + l.text + (l.item.on_hand != null ? ' (' + formatBase(l.item.on_hand, l.item.base_unit) + ' there now)' : '')),
        ...(input.note ? { warningTitle: 'Note', warnings: ['Note: ' + input.note] } : {}),
        confirmLabel: 'Send',
      }
    },
    async run(ctx, input) {
      const p = await sendPlan(ctx, input)
      return audited(ctx, 'send_transfer', input, async () => {
        const t = await callApi(ctx, 'POST', `/api/stock/venues/${p.from.id}/transfers`, {
          body: { to_venue_id: p.to.id, lines: p.lines.map(l => ({ item_id: l.item.id, qty: l.qty, unit: l.unit })), ...(input.note ? { note: input.note } : {}) },
        })
        return {
          sent: t.label, from: t.from_name, to: t.to_name, items: t.lines.map(l => l.name + ' ' + formatBase(l.qty_base, l.base_unit)),
          ...(t.value != null ? { value: pounds(t.value) } : {}),
          message: 'Sent: on its way to ' + t.to_name + ' until someone there receives it.',
          page: '/stock?tab=transfers',
        }
      })
    },
  },

  {
    name: 'receive_transfer',
    class: 'consequential',
    needs: 'use',
    title: 'Receive a stock transfer',
    activity: 'Received a stock transfer',
    description:
      'Receives stock sent to a venue from another of the group\'s venues: what arrived of each item, in the person\'s ' +
      'units. Items left out arrived as sent; an item that didn\'t come at all is 0. What didn\'t arrive stays on the ' +
      'transfer as lost in transit. transfer: its number (Transfer 12) or the venue it came from, when more than one is on ' +
      'its way. Only what the person says arrived: never assume a difference. Needs Stock use.',
    input: z.object({
      venue: VenueText.describe('The venue it arrived at'),
      transfer: z.string().trim().max(120).optional().describe('Its number, or the venue it came from'),
      items: z.array(z.object({
        item: z.string().trim().min(1).max(200),
        qty: z.number().min(0).max(100000000),
        unit: z.string().trim().min(1).max(80).optional(),
      })).max(50).optional(),
      note: z.string().trim().max(500).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      const p = await receivePlan(ctx, input)
      const short = p.lines.filter(l => l.lost > 0)
      return {
        title: 'Receive ' + p.t.label + ' from ' + p.t.from_name + ' at ' + p.venue.name + '?',
        lines: p.lines.map(l => l.line.name + ': sent ' + formatBase(l.line.qty_base, l.line.base_unit) + ', arrived ' + l.text),
        ...(short.length ? { warningTitle: 'Short', warnings: short.map(l => l.line.name + ': ' + formatBase(l.lost, l.line.base_unit) + ' short, kept as lost in transit') } : {}),
        confirmLabel: 'Receive',
      }
    },
    async run(ctx, input) {
      const p = await receivePlan(ctx, input)
      return audited(ctx, 'receive_transfer', input, async () => {
        const t = await callApi(ctx, 'POST', `/api/stock/transfers/${p.t.id}/receive`, {
          body: { lines: p.lines.map(l => ({ line_id: l.line.id, qty: l.qty, unit: l.unit })), ...(input.note ? { note: input.note } : {}) },
        })
        return {
          received: t.label, from: t.from_name, at: t.to_name,
          items: t.lines.map(l => l.name + ' ' + formatBase(l.received_base, l.base_unit) + (l.lost_base ? ' (' + formatBase(l.lost_base, l.base_unit) + ' lost in transit)' : '')),
          ...(t.lost_value != null && t.lost ? { lost_value: pounds(t.lost_value) } : {}),
          message: 'Received at ' + t.to_name + '.' + (t.lost ? ' What didn\'t arrive is kept as lost in transit.' : ''),
          page: '/stock?tab=transfers',
        }
      })
    },
  },
]

const WHAT_ROUTE = { item: 'item', batch: 'recipe', dish: 'dish' }

/** A waste entry from the person's words: the thing by name (an item, a batch or a dish), its unit, the reason. */
async function wastePlan(ctx, input) {
  if (!levelAtLeast(await levelOf(ctx), 'use')) throw new ToolError('You don\'t have permission to log waste. Ask an owner or admin.', 403)
  const venue = await venueFor(ctx, input.venue)
  const p = await callApi(ctx, 'GET', `/api/stock/venues/${venue.id}/waste/pickers`)
  const lists = {
    item: p.items.map(x => ({ ...x, kind: 'item' })),
    batch: p.recipes.map(x => ({ ...x, kind: 'batch' })),
    dish: p.dishes.map(x => ({ ...x, kind: 'dish' })),
  }
  let thing
  if (input.what) {
    thing = input.what === 'item' ? pickItem(lists.item, input.thing) : pickByName(lists[input.what], input.thing, x => x.name, input.what === 'batch' ? 'prep recipe' : 'dish')
  } else {
    // A name said exactly is that one, whichever kind; else an item first (by code, barcode or name), then a batch, then a dish.
    const t = input.thing.trim().toLowerCase()
    const exact = [...lists.item, ...lists.batch, ...lists.dish].filter(x => x.name.toLowerCase() === t)
    const kinds = [...new Set(exact.map(x => x.kind))]
    if (kinds.length > 1) throw new ToolError('"' + input.thing + '" is ' + kinds.map(k => (k === 'batch' ? 'a prep batch' : 'a' + (k === 'item' ? 'n item' : ' dish'))).join(' and ') + ': which was wasted? Say what.', 409)
    if (exact.length) thing = exact.length === 1 ? exact[0] : pickByName(exact, input.thing, x => x.name, 'thing')
    else {
      for (const k of ['item', 'batch', 'dish']) {
        try { thing = k === 'item' ? pickItem(lists.item, input.thing) : pickByName(lists[k], input.thing, x => x.name, k); break } catch (e) { if (e.status === 409) throw e }
      }
      if (!thing) throw new ToolError('Nothing called "' + input.thing + '" is an item, a prep batch or a dish here.', 404)
    }
  }
  const reason = pickByName(p.reasons, input.reason, r => r.name, 'waste reason', 'No waste reasons are switched on: they are set up on the Stock page, Settings.')
  let unit
  if (thing.kind === 'item' && input.unit) {
    const c = unitChoice(thing.units, input.unit)
    if (!c) throw new ToolError(thing.name + ' has no size for ' + input.unit + ': use ' + thing.units.map(u => u.key).join(', ') + '.', 422)
    unit = c.key
  } else if (thing.kind === 'batch') unit = input.unit || thing.unit
  const type = thing.kind === 'dish' && input.order_type ? pickByName(p.order_types, input.order_type, t => t.name, 'order type') : null
  return {
    venue, thing, reason,
    body: {
      what: WHAT_ROUTE[thing.kind], [thing.kind === 'item' ? 'item_id' : thing.kind === 'batch' ? 'recipe_id' : 'dish_id']: thing.id,
      qty: input.qty, ...(unit ? { unit } : {}), ...(type ? { order_type_id: type.id } : {}), reason_id: reason.id, ...(input.note ? { note: input.note } : {}),
    },
  }
}

/** A transfer's lines from the person's words: each item at the sending venue in a unit it has. */
async function sendPlan(ctx, input) {
  if (!levelAtLeast(await levelOf(ctx), 'use')) throw new ToolError('You don\'t have permission to send stock. Ask an owner or admin.', 403)
  const from = await venueFor(ctx, input.from)
  const to = await venueFor(ctx, input.to)
  if (from.id === to.id) throw new ToolError('Stock is sent to another venue: ' + from.name + ' is both.', 422)
  const st = await stockList(ctx, from)
  const seen = new Set()
  const lines = input.items.map(x => {
    const item = pickItem(st.items, x.item)
    if (seen.has(item.id)) throw new ToolError(item.name + ' is on the transfer twice.', 422)
    seen.add(item.id)
    const c = unitChoice(item.units, x.unit || item.base_unit)
    if (!c) throw new ToolError(item.name + ' has no size for ' + x.unit + ': use ' + item.units.map(u => u.key).join(', ') + '.', 422)
    const r = entriesToBase([{ qty: x.qty, unit: c.key }], item.units, item)
    if (r.problem) throw new ToolError(r.problem + '.', 422)
    return { item, qty: x.qty, unit: c.key, text: entriesText(r.entries) + (UNITS[c.key] ? '' : ' = ' + formatBase(r.qty_base, item.base_unit)) }
  })
  return { from, to, lines }
}

/** What arrived of a transfer on its way to the venue: the person's quantities, as sent for the items they leave out. */
async function receivePlan(ctx, input) {
  if (!levelAtLeast(await levelOf(ctx), 'use')) throw new ToolError('You don\'t have permission to receive stock. Ask an owner or admin.', 403)
  const venue = await venueFor(ctx, input.venue)
  const list = await callApi(ctx, 'GET', `/api/stock/venues/${venue.id}/transfers`)
  const open = list.incoming
  if (!open.length) throw new ToolError('Nothing is on its way to ' + venue.name + '.', 404)
  let pick
  const said = String(input.transfer ?? '').trim()
  const num = said.match(/(\d+)/)?.[1]
  if (num) pick = open.find(t => String(t.number) === num)
  else if (said) pick = pickByName(open, said, t => t.from_name, 'transfer from a venue')
  else if (open.length === 1) pick = open[0]
  if (!pick) throw new ToolError((said ? 'No transfer ' + said + ' is on its way here. ' : 'More than one transfer is on its way here: ') + open.map(t => t.label + ' from ' + t.from_name).join(', ') + '.', 409)
  const t = await callApi(ctx, 'GET', '/api/stock/transfers/' + pick.id)
  const given = new Map()
  for (const x of input.items || []) {
    const line = pickByName(t.lines, x.item, l => l.name, 'item on ' + t.label)
    if (given.has(line.id)) throw new ToolError(line.name + ' is said twice.', 422)
    given.set(line.id, x)
  }
  const lines = t.lines.map(line => {
    const x = given.get(line.id)
    const units = line.units || []
    // A line not mentioned arrived as sent (asSentEntry(): in the unit it was sent in only while that
    // unit's size is the same as then, else what left the sender in the base unit).
    const sent = x ? null : asSentEntry(line, units)
    const c = unitChoice(units, x ? x.unit || line.base_unit : sent.unit)
    if (!c) throw new ToolError(line.name + ' has no size for ' + (x?.unit || line.base_unit) + '.', 422)
    const qty = x ? x.qty : sent.qty
    const r = entriesToBase([{ qty, unit: c.key }], units, { name: line.name })
    if (r.problem) throw new ToolError(r.problem + '.', 422)
    return { line, qty, unit: c.key, text: formatBase(r.qty_base ?? 0, line.base_unit) + (x ? '' : ' (as sent)'), lost: lostInTransit(line.qty_base, r.qty_base ?? 0) }
  })
  return { venue, t, lines }
}

/** A count's lines: each item found by name, code or barcode, its quantity in units it is counted in. */
async function countPlan(ctx, input) {
  if (!levelAtLeast(await levelOf(ctx), 'use')) throw new ToolError('You don\'t have permission to count stock. Ask an owner or admin.', 403)
  const venue = await venueFor(ctx, input.venue)
  const [st, meta, areas] = await Promise.all([
    stockList(ctx, venue),
    callApi(ctx, 'GET', '/api/stock/meta'),
    input.counts.some(c => c.area) ? callApi(ctx, 'GET', `/api/stock/venues/${venue.id}/areas`) : [],
  ])
  const seen = new Set()
  const lines = input.counts.map(c => {
    const item = pickItem(st.items, c.item)
    const area = c.area ? pickByName(areas, c.area, a => a.name, 'storage area', 'No storage areas at ' + venue.name + ' yet: count without an area.') : null
    const k = item.id + '|' + (area?.id || '')
    if (seen.has(k)) throw new ToolError(item.name + ' is in the count twice.', 422)
    seen.add(k)
    const typed = c.entries?.length ? c.entries : c.qty != null ? [{ qty: c.qty, unit: c.unit || item.base_unit }] : null
    if (!typed) throw new ToolError('How much ' + item.name + ' was counted?', 422)
    for (const e of typed) {
      const std = UNITS[String(e.unit).toLowerCase()]
      if (std && std.kind !== UNITS[item.base_unit]?.kind && !unitChoice(item.units, e.unit)) {
        throw new ToolError(item.name + ' is counted ' + COUNTED[item.base_unit] + ', not in ' + e.unit + '.', 422)
      }
    }
    const r = entriesToBase(typed, item.units, item)
    if (r.problem) throw new ToolError(r.problem + '.', 422)
    const single = r.entries.length === 1 && UNITS[r.entries[0].unit]
    return { item, area, entries: r.entries, text: entriesText(r.entries) + (single ? '' : ' = ' + formatBase(r.qty_base, item.base_unit)), qty_base: r.qty_base }
  })
  // Approved at once only for someone who may (Manage), and not when a second person must approve.
  const approves = !!meta.can_approve && !meta.settings?.second_person_approves
  return { venue, lines, approves, blind: !!meta.settings?.blind_count }
}
