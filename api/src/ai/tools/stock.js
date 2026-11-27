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
//   count_stock     a count of the items the person names, in the units
//                   they say (2 cases and 400 g; the item's own units and
//                   its supplier packs), by storage area when they say one;
//                   submitted, and approved at once when the person may
//                   approve it                                  consequential
//
// The model is given names, never ids (rule 19): items and areas are picked
// by name, code or barcode, and nothing it returns carries an id.

import { z } from 'zod'
import { callApi, staffPermissionLevel, levelAtLeast, ToolError } from '../context.js'
import { VenueText, venueFor, pickByName, plural, audited, localParts, longDate } from './util.js'
import { formatBase, UNITS } from '../../../../shared/procurement.js'
import { entriesToBase, entriesText, unitChoice, signedBase } from '../../../../shared/stock.js'
import { pounds } from '../../../../shared/costing.js'

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

// This file's place, its area and what Pepper is told about it (tools/index.js gathers them).
export const order = 82
export const sections = {
  stock: { label: 'Stock: on hand, counts and each item\'s history', modules: ['stock'] },
}
export const promptLines = [
  'Stock: stock_on_hand (how much of an item there is at a venue, or what is below its par), stock_moves (an item\'s ' +
    'history at a venue: deliveries, counts and adjustments with the running balance), count_stock (a count of the ' +
    'items the person names, in their units, by storage area).',
]
export const promptNotes = [
  'Stock: on hand is the last approved count plus the deliveries and adjustments since; sales aren\'t taken off yet, ' +
    'so say so. count_stock records only what the person counted, in their numbers and units (2 cases and 400 g is ' +
    'one item in two units): never work a count out. A count someone who can approve makes is approved at once; ' +
    'anyone else\'s waits for approval on the Stock page. A full count of the venue, by area, is done on the Stock ' +
    'page or the phone\'s count page (open_form stock_key_count starts a key-item count from a list).',
]

export const tools = [
  {
    name: 'stock_on_hand',
    title: 'Stock on hand',
    activity: 'Looked at stock on hand',
    description:
      'How much of an inventory item there is at a venue: its last approved stock count plus what was delivered and ' +
      'adjusted since (the Stock page\'s On hand tab, the same figures). Sales aren\'t taken off yet, so say so. items: ' +
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
      'count and adjustment, newest first, each with its change and the balance after it; values in pounds for people ' +
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
      return {
        title: 'Record this count at ' + p.venue.name + '?',
        lines: p.lines.map(l => l.item.name + ': ' + l.text + (l.area ? ' in ' + l.area.name : '') +
          (l.item.on_hand != null ? ' (was ' + formatBase(l.item.on_hand, l.item.base_unit) + ')' : '')),
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
]

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
  return { venue, lines, approves }
}
