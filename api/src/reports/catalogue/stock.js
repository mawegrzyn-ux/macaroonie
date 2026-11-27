// src/reports/catalogue/stock.js
//
// Stock in the report catalogue (migration 287; inventory phase 4a,
// migrations 305 to 307): what is on hand, every move of stock (the
// ledger), the counts and each item's line in them (expected against
// counted), and adjustments. On hand, the ledger and the count lines are
// worked out in code for each run by the Stock page's own rules
// (work/stock.js, services/stockSvc.js, shared/stock.js): the last approved
// count plus deliveries and adjustments since; sales aren't taken off yet.
// Quantities are in each item's base unit (grams, millilitres or each), so
// only add up items kept in the same unit. Values are in pounds, at what
// the item cost at the venue then (the average paid, else the last price
// paid), and need Costing view: a value tells what suppliers charge.

import { subject, text, number, money, yesno, choice, moment, sum, count, countDistinct, one } from './define.js'
import { STOCK_TABLES, MOVE_TABLES, COUNT_LINE_TABLES } from '../work/stock.js'

const COSTING = 'costing'
const pounds = (src, opts = {}) => money(src, { unit: 'pounds', needs: COSTING, ...opts })
const value = (src, opts = {}) => sum(src, { type: 'money', unit: 'pounds', needs: COSTING, ...opts })

const UNITS = { g: 'Grams', ml: 'Millilitres', each: 'Each' }
const KINDS = { full: 'Full count', key: 'Key items' }
const STATUSES = { draft: 'Counting', submitted: 'Waiting for approval', approved: 'Approved', cancelled: 'Cancelled' }
const MOVES = { delivery: 'Delivery', count: 'Count', adjustment: 'Adjustment' }
const ITEM_NAME = '(SELECT i.name FROM inv_items i WHERE i.id = {t}.item_id AND i.tenant_id = {t}.tenant_id)'
const ITEM_UNIT = '(SELECT i.base_unit FROM inv_items i WHERE i.id = {t}.item_id AND i.tenant_id = {t}.tenant_id)'

/** Where these subjects come in the catalogue (index.js gathers this folder by it, then by file name). */
export const order = 102

/**
 * This area's tables that no subject reads, and why (decisions.js gathers
 * them). Counts, their lines, adjustments and the areas' names (on count
 * lines) are read; the rest is how counting is set up.
 */
export const decisions = {
  settings: [
    // The items on each area's shelves, the key-item lists, the group's approval and blind settings, each venue's count day.
    'stock_area_items', 'stock_key_lists', 'stock_key_list_items', 'stock_settings', 'stock_venue_settings',
  ],
  out: {},
}

const itemFields = () => ({
  item_name: text('item_name', { label: 'Item' }),
  base_unit: choice('base_unit', UNITS, { label: 'Measured in' }),
})

export const subjects = [
  // Moved from purchasing (purchasing.stock) in phase 4a.
  subject({
    key: 'stock.on_hand',
    label: 'Stock on hand',
    one: 'item at a venue',
    area: 'stock',
    module: 'stock',
    about: 'Each inventory item at each venue that was counted, delivered or adjusted there: its last approved stock count, what was received and adjusted since, and what that leaves on hand now, in the item\'s own unit (grams, millilitres or each). Sales aren\'t taken off yet. Not by period: it is now.',
    from: { work: 'stock_on_hand', tables: STOCK_TABLES },
    idType: 'text',
    venue: 'venue_id',
    name: 'item_name',
    open: { page: '/stock?venue=:venue&item=:id', module: 'stock', id: 'item_id', with: { venue: 'venue_id' } },
    fields: {
      ...itemFields(),
      category: text('category', { label: 'Category' }),
      on_hand: number('on_hand', { label: 'On hand', synonyms: ['stock', 'stock level', 'in stock', 'how much we have'], about: 'The last approved count plus what was received and adjusted since. Empty until the item is counted at the venue.' }),
      counted: number('counted', { label: 'Last count' }),
      counted_at: moment('counted_at', { label: 'Counted at' }),
      received_since: number('received_since', { label: 'Received since the count', about: 'Delivered and booked in at the venue after the last count (everything received, when never counted).' }),
      adjusted_since: number('adjusted_since', { label: 'Adjusted since the count' }),
      never_counted: yesno('never_counted', { label: 'Never counted' }),
      value: pounds('value', { label: 'Stock value', about: 'On hand at what the item cost at the venue lately: the average paid over the last 90 days, else the last price paid.' }),
    },
    measures: {
      total_on_hand: sum('on_hand', { label: 'Total on hand', about: 'Added up in each item\'s own unit: only add up items counted the same way.' }),
      items: count({ label: 'Items' }),
      uncounted: count({ label: 'Items never counted', where: '{t}.never_counted' }),
      stock_value: value('value', { label: 'Stock value', synonyms: ['value of stock', 'stock worth'] }),
    },
    links: {
      item: one('purchasing.items', 'item_id', { label: 'Item' }),
    },
    list: ['item_name', 'venue.name', 'on_hand', 'base_unit', 'counted_at', 'received_since'],
    sort: [{ by: 'item_name', dir: 'asc' }],
  }),

  subject({
    key: 'stock.moves',
    label: 'Stock moves',
    one: 'move of stock',
    area: 'stock',
    module: 'stock',
    about: 'Every move of stock at a venue, the ledger: each delivery booked in, each approved count and each adjustment, with the change it made and the balance after it (the balance starts at the first count). A count\'s change is what it found over what was expected. Sales aren\'t taken off yet.',
    from: { work: 'stock_moves', tables: MOVE_TABLES },
    idType: 'text',
    venue: 'venue_id',
    date: { sql: '{t}.date', label: 'Day' },
    name: 'item_name',
    open: { page: '/stock?venue=:venue&item=:id', module: 'stock', id: 'item_id', with: { venue: 'venue_id' } },
    fields: {
      ...itemFields(),
      kind: choice('kind', MOVES, { label: 'Kind of move' }),
      at: moment('at', { label: 'When' }),
      change: number('change', { label: 'Change', about: 'In the item\'s own unit: what came in or went out; for a count, what it found over what was expected.' }),
      counted: number('counted', { label: 'Counted' }),
      balance: number('balance', { label: 'Balance after', about: 'What the ledger says was there after the move; empty before the item\'s first count.' }),
      source: text('source', { label: 'From', about: 'The supplier order, the count or the adjustment\'s reason.' }),
      by: text('by', { label: 'By' }),
      value: pounds('value', { label: 'Value', about: 'The change at what the item cost then: the price paid for a delivery, else the average paid at the venue.' }),
    },
    measures: {
      moves: count({ label: 'Moves' }),
      received: sum('change', { label: 'Received', where: "{t}.kind = 'delivery'", about: 'In each item\'s own unit.' }),
      adjusted: sum('change', { label: 'Adjusted', where: "{t}.kind = 'adjustment'", about: 'In each item\'s own unit.' }),
      count_difference: sum('change', { label: 'Count differences', where: "{t}.kind = 'count'", about: 'What counts found over what was expected, in each item\'s own unit.' }),
      received_value: value('value', { label: 'Value received', where: "{t}.kind = 'delivery'" }),
      count_value: value('value', { label: 'Value of count differences', where: "{t}.kind = 'count'", synonyms: ['shrinkage', 'stock loss'] }),
      adjusted_value: value('value', { label: 'Value adjusted', where: "{t}.kind = 'adjustment'" }),
    },
    links: {
      item: one('purchasing.items', 'item_id', { label: 'Item' }),
    },
    list: ['date', 'item_name', 'venue.name', 'kind', 'change', 'balance', 'source', 'by'],
    sort: [{ by: 'at', dir: 'desc' }],
  }),

  subject({
    key: 'stock.counts',
    label: 'Stock counts',
    one: 'count',
    area: 'stock',
    module: 'stock',
    about: 'Every stock count at a venue: a full count (what isn\'t counted is confirmed as zero) or a key-item count from a short list, counting, waiting for approval, approved or cancelled. Only approved counts move stock.',
    from: 'stock_counts',
    venue: 'venue_id',
    date: { sql: '({t}.counted_at AT TIME ZONE {tz})::date', bound: '{t}.counted_at', label: 'Day counted' },
    open: { page: '/stock?tab=counts&count=:id', module: 'stock' },
    fields: {
      kind: choice('kind', KINDS, { label: 'Kind of count' }),
      status: choice('status', STATUSES, { label: 'Status' }),
      key_list: text('key_list_name', { label: 'Key-item list' }),
      counted_at: moment('counted_at', { label: 'Counted at' }),
      started_by: text('started_by', { label: 'Started by' }),
      submitted_at: moment('submitted_at', { label: 'Submitted at' }),
      submitted_by: text('submitted_by', { label: 'Submitted by' }),
      approved_at: moment('approved_at', { label: 'Approved at' }),
      approved_by: text('approved_by', { label: 'Approved by' }),
      cancelled_at: moment('cancelled_at', { label: 'Cancelled at' }),
      note: text('note', { label: 'Note' }),
      lines: number({ sql: '(SELECT count(DISTINCT l.item_id) FROM stock_count_lines l WHERE l.count_id = {t}.id AND l.tenant_id = {t}.tenant_id)' }, { label: 'Items counted', decimals: 0 }),
    },
    measures: {
      counts: count({ label: 'Counts', where: "{t}.status <> 'cancelled'", synonyms: ['stocktake', 'stock take', 'stocktakes'] }),
      approved: count({ label: 'Approved', where: "{t}.status = 'approved'" }),
      waiting: count({ label: 'Waiting for approval', where: "{t}.status = 'submitted'" }),
      full_counts: count({ label: 'Full counts', where: "{t}.kind = 'full' AND {t}.status = 'approved'" }),
    },
    list: ['date', 'venue.name', 'kind', 'status', 'lines', 'submitted_by', 'approved_by'],
    sort: [{ by: 'counted_at', dir: 'desc' }],
    // key_list_id: the list may be deleted; the count keeps its name (key_list_name). counted_by:
    // who started it in a one-step count (started_by says the same). areas_done: the sheet's progress.
    skip: ['key_list_id', 'counted_by', 'areas_done', 'cancelled_by', 'created_at', 'updated_at'],
  }),

  subject({
    key: 'stock.count_lines',
    label: 'Count lines',
    one: 'item in a count',
    area: 'stock',
    module: 'stock',
    about: 'Each item of a submitted or approved stock count: what was counted (its storage areas added), what was expected at the count\'s moment (the last approved count before it plus what moved since), the difference and its value. A full count\'s items nobody counted were confirmed as zero.',
    from: { work: 'stock_count_lines', tables: COUNT_LINE_TABLES },
    idType: 'text',
    venue: 'venue_id',
    date: { sql: '{t}.date', label: 'Day counted' },
    name: 'item_name',
    open: { page: '/stock?tab=counts&count=:id', module: 'stock', id: 'count_id' },
    fields: {
      ...itemFields(),
      counted_at: moment('counted_at', { label: 'Counted at' }),
      kind: choice('kind', KINDS, { label: 'Kind of count' }),
      status: choice('status', STATUSES, { label: 'Count status' }),
      counted: number('counted', { label: 'Counted' }),
      expected: number('expected', { label: 'Expected', about: 'What the ledger said was there at the count\'s moment; empty when the item had never been counted before.' }),
      difference: number('difference', { label: 'Difference', synonyms: ['count difference', 'over or short'], about: 'Counted less expected, in the item\'s own unit: below zero is stock missing.' }),
      value: pounds('value', { label: 'Value of the difference', about: 'The difference at what the item cost at the venue then (the average paid, else the last price paid).' }),
      areas: text('areas', { label: 'Storage areas' }),
      counted_by: text('counted_by', { label: 'Counted by' }),
      confirmed_zero: yesno('confirmed_zero', { label: 'Confirmed as zero' }),
      off: yesno('off', { label: 'Has a difference' }),
      latest: yesno('latest', { label: 'Latest count', about: 'From the venue\'s latest approved count, in any period.' }),
    },
    measures: {
      lines: count({ label: 'Items counted' }),
      items_off: count({ label: 'Items with a difference', where: 'COALESCE({t}.difference, 0) <> 0' }),
      net_value: value('value', { label: 'Net value of differences' }),
      missing_value: value('value', { label: 'Value missing', where: '{t}.value < 0', synonyms: ['shrinkage', 'stock loss', 'missing stock'] }),
      found_value: value('value', { label: 'Value found', where: '{t}.value > 0' }),
      counts: countDistinct('count_id', { label: 'Counts' }),
    },
    list: ['date', 'item_name', 'venue.name', 'counted', 'expected', 'difference', 'value'],
    sort: [{ by: 'value', dir: 'asc' }],
  }),

  subject({
    key: 'stock.adjustments',
    label: 'Stock adjustments',
    one: 'adjustment',
    area: 'stock',
    module: 'stock',
    about: 'Every adjustment of stock at a venue, for what fits no other record, each with its reason: the quantity as typed and in the item\'s own unit (minus takes stock off). An adjustment is put right by reversing it, which is an adjustment too.',
    from: 'stock_adjustments',
    venue: 'venue_id',
    date: { sql: '({t}.adjusted_at AT TIME ZONE {tz})::date', bound: '{t}.adjusted_at', label: 'Day adjusted' },
    name: 'reason',
    open: { page: '/stock?tab=adjustments&venue=:venue&adjustment=:id', module: 'stock', with: { venue: 'venue_id' } },
    fields: {
      item_name: text({ sql: ITEM_NAME }, { label: 'Item' }),
      base_unit: choice({ sql: ITEM_UNIT }, UNITS, { label: 'Measured in' }),
      qty: number('qty', { label: 'Quantity as typed' }),
      unit: text('unit', { label: 'Unit as typed' }),
      change: number('qty_base', { label: 'Change', about: 'In the item\'s own unit (grams, millilitres or each): below zero takes stock off.' }),
      reason: text('reason', { label: 'Reason', synonyms: ['why'] }),
      note: text('note', { label: 'Note' }),
      adjusted_at: moment('adjusted_at', { label: 'Adjusted at' }),
      adjusted_by: text('adjusted_by', { label: 'Adjusted by' }),
      reverses: yesno({ sql: '({t}.reverses_id IS NOT NULL)' }, { label: 'Reverses another' }),
    },
    measures: {
      adjustments: count({ label: 'Adjustments', synonyms: ['adjustment', 'write-off', 'write-offs'] }),
      taken_off: count({ label: 'Taken off', where: '{t}.qty_base < 0' }),
      added: count({ label: 'Added', where: '{t}.qty_base > 0' }),
    },
    links: {
      item: one('purchasing.items', 'item_id', { label: 'Item' }),
      reversed: one('stock.adjustments', 'reverses_id', { label: 'Adjustment it reverses' }),
    },
    list: ['date', 'item_name', 'venue.name', 'change', 'base_unit', 'reason', 'adjusted_by'],
    sort: [{ by: 'adjusted_at', dir: 'desc' }],
    skip: ['created_at'],
  }),
]
