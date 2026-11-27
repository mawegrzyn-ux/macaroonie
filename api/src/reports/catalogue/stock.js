// src/reports/catalogue/stock.js
//
// Stock in the report catalogue (migration 287; inventory phase 4a,
// migrations 305 to 307): what is on hand, every move of stock (the
// ledger), the counts and each item's line in them (expected against
// counted), and adjustments. On hand, the ledger and the count lines are
// worked out in code for each run by the Stock page's own rules
// (work/stock.js, services/stockSvc.js, shared/stock.js): the last approved
// count plus deliveries and adjustments since, less what sales took off
// (usage from sales, phase 5: one move per item per trading day).
// Quantities are in each item's base unit (grams, millilitres or each), so
// only add up items kept in the same unit. Values are in pounds, at what
// the item cost at the venue then (the average paid, else the last price
// paid), and need Costing view: a value tells what suppliers charge. A
// delivery's own value (Paid: what was received at its supplier's price)
// is that supplier's price and line total, so it needs purchasing prices
// (Purchasing setup), as the purchasing subjects' money does. Phase 4b
// (migrations 308 and 309): waste (logged, and the till's voids marked
// wasted, broken into items through the recipe; test till sales left out)
// and transfers between venues (sent, received, lost in transit), both
// worked out in code too; on hand and the ledger take them in.

import { subject, text, number, money, yesno, choice, moment, sum, count, countDistinct, one } from './define.js'
import { STOCK_TABLES, MOVE_TABLES, COUNT_LINE_TABLES, WASTE_TABLES, TRANSFER_TABLES } from '../work/stock.js'
import { WASTE_KINDS, WASTE_WHAT, TRANSFER_STATUSES, MOVE_KINDS } from '../../../../shared/stock.js'

const COSTING = 'costing'
const PRICES = 'purchasing_setup'
const pounds = (src, opts = {}) => money(src, { unit: 'pounds', needs: COSTING, ...opts })
const value = (src, opts = {}) => sum(src, { type: 'money', unit: 'pounds', needs: COSTING, ...opts })

const UNITS = { g: 'Grams', ml: 'Millilitres', each: 'Each' }
const KINDS = { full: 'Full count', key: 'Key items' }
const STATUSES = { draft: 'Counting', submitted: 'Waiting for approval', approved: 'Approved', cancelled: 'Cancelled' }
const MOVES = Object.fromEntries(Object.entries(MOVE_KINDS).map(([k, v]) => [k, v.label]))
const WASTE_KIND_LABELS = Object.fromEntries(Object.entries(WASTE_KINDS).map(([k, v]) => [k, v.label]))
const WASTE_SOURCES = { logged: 'Logged', till_void: 'Till void marked wasted' }
const TRANSFER_STATUS_LABELS = { ...TRANSFER_STATUSES }
const TRANSFER_DIRECTIONS = { out: 'Sent from here', in: 'Received here' }
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
    // (waste_reasons is read by Waste: a till void counts under the group's reason of its name.)
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
    about: 'Each inventory item at each venue that was counted, delivered or adjusted there: its last approved stock count, what was received and adjusted since, and what that leaves on hand now, in the item\'s own unit (grams, millilitres or each), less what sales took off (usage from sales, up to its last run). Not by period: it is now.',
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
    about: 'Every move of stock at a venue, the ledger: each delivery booked in, each approved count, each adjustment, each item wasted (the till\'s voids marked wasted too) and each transfer out, in or lost in transit, with the change it made and the balance after it (the balance starts at the first count). A count\'s change is what it found over what was expected. What each trading day\'s sales took off is one move per item (Sales).',
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
      value: pounds('value', { label: 'Value', about: 'A count\'s, an adjustment\'s or waste\'s change at what the item cost at the venue then (the average paid, else the last price paid); a transfer\'s at the sender\'s average when it was sent. Empty for a delivery: its value is Paid.' }),
      paid: pounds('paid', { label: 'Paid', needs: PRICES, about: 'A delivery: what was received at the price its supplier charged (the invoice\'s, else the price ordered at). Needs purchasing prices, as supplier orders do.' }),
    },
    measures: {
      moves: count({ label: 'Moves' }),
      received: sum('change', { label: 'Received', where: "{t}.kind = 'delivery'", about: 'In each item\'s own unit.' }),
      adjusted: sum('change', { label: 'Adjusted', where: "{t}.kind = 'adjustment'", about: 'In each item\'s own unit.' }),
      count_difference: sum('change', { label: 'Count differences', where: "{t}.kind = 'count'", about: 'What counts found over what was expected, in each item\'s own unit.' }),
      received_value: value('paid', { label: 'Value received', needs: PRICES, where: "{t}.kind = 'delivery'" }),
      count_value: value('value', { label: 'Value of count differences', where: "{t}.kind = 'count'", synonyms: ['shrinkage', 'stock loss'] }),
      adjusted_value: value('value', { label: 'Value adjusted', where: "{t}.kind = 'adjustment'" }),
      wasted: sum('change', { label: 'Wasted', where: "{t}.kind = 'waste'", about: 'In each item\'s own unit: below zero.' }),
      wasted_value: value('value', { label: 'Value wasted', where: "{t}.kind = 'waste'", synonyms: ['wastage'] }),
      transferred: sum('change', { label: 'Moved between venues', where: "{t}.kind IN ('transfer_out', 'transfer_in', 'lost_in_transit')", about: 'In each item\'s own unit: out and lost below zero, in above.' }),
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
    open: { page: '/stock?tab=counts&venue=:venue&count=:id', module: 'stock', with: { venue: 'venue_id' } },
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
    open: { page: '/stock?tab=counts&venue=:venue&count=:id', module: 'stock', id: 'count_id', with: { venue: 'venue_id' } },
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
    sort: [{ by: 'value', dir: 'asc' }, { by: 'item_name', dir: 'asc' }],
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

  // Phase 4b: waste and transfers.
  subject({
    key: 'stock.waste',
    label: 'Waste',
    one: 'item wasted',
    area: 'stock',
    module: 'stock',
    about: 'What was thrown away at a venue, a row for each item of each waste entry: an item logged as wasted, a prep batch or a dish broken into its items by its recipe, and each dish voided on the till and marked wasted (broken into items the same way; test till sales left out). With its reason, WRAP\'s kind (spoilage, preparation or plate), who logged it and, with Costing view, its value at what was paid then. An undone entry is left out; a reversing entry is below zero. An entry that couldn\'t be broken into items is a row with no item. Quantities are in each item\'s own unit.',
    from: { work: 'stock_waste', tables: WASTE_TABLES },
    idType: 'text',
    venue: 'venue_id',
    date: { sql: '{t}.date', label: 'Trading day' },
    name: 'name',
    // The Waste tab at the row's venue on its trading day (?date=), the entry picked out (?waste=: a logged
    // entry's id, or a till void's line id).
    open: { page: '/stock?tab=waste&venue=:venue&date=:date&waste=:id', module: 'stock', id: 'entry_id', with: { venue: 'venue_id', date: 'date' } },
    fields: {
      name: text('name', { label: 'Wasted', synonyms: ['dish', 'what was wasted'], about: 'What was logged: the item, the prep batch or the dish.' }),
      what: choice('what', WASTE_WHAT, { label: 'Logged as' }),
      source: choice('source', WASTE_SOURCES, { label: 'From', about: 'Logged on the Stock page, the phone or by Pepper; or a dish voided on the till and marked wasted.' }),
      entry_qty: number('entry_qty', { label: 'Quantity logged' }),
      entry_unit: text('entry_unit', { label: 'Unit logged' }),
      ...itemFields(),
      qty: number('qty', { label: 'Quantity of the item', about: 'In the item\'s own unit, as bought (after its yield): what it took off stock.' }),
      reason: text('reason', { label: 'Reason', synonyms: ['why', 'waste reason'] }),
      kind: choice('kind', WASTE_KIND_LABELS, { label: 'Kind of waste', synonyms: ['spoilage', 'plate waste', 'preparation waste', 'wrap'], about: 'WRAP\'s three kinds: spoilage (gone off or out of date), preparation (lost in the kitchen) and plate (what guests leave or send back).' }),
      by: text('by', { label: 'Logged by', synonyms: ['who', 'person'] }),
      at: moment('at', { label: 'When' }),
      value: pounds('value', { label: 'Value', about: 'The item\'s quantity at what it cost at the venue then (the average paid, else the last price paid).' }),
      gaps: text('gaps', { label: 'What the recipe couldn\'t say', about: 'Why a batch or a dish couldn\'t be broken into items in full: no recipe, a unit with no size, a draft nobody checked.' }),
      reverses: yesno('reverses', { label: 'Reverses another' }),
    },
    measures: {
      entries: countDistinct('entry_id', { label: 'Waste entries', synonyms: ['wastage', 'waste', 'things wasted', 'binned'], examples: ['waste by reason this week'] }),
      wasted: sum('qty', { label: 'Quantity wasted', about: 'In each item\'s own unit: only add up items kept the same way.' }),
      waste_value: value('value', { label: 'Value wasted', synonyms: ['wastage', 'waste value', 'spoilage', 'cost of waste'], examples: ['what did we waste this week'] }),
      items_wasted: countDistinct('item_id', { label: 'Items wasted' }),
    },
    links: {
      item: one('purchasing.items', 'item_id', { label: 'Item' }),
    },
    list: ['date', 'name', 'entry_qty', 'item_name', 'qty', 'base_unit', 'reason', 'kind', 'by', 'value'],
    sort: [{ by: 'at', dir: 'desc' }],
    skip: ['dish_id', 'check_id'],
  }),

  subject({
    key: 'stock.transfers',
    label: 'Stock transfers',
    one: 'item transferred',
    area: 'stock',
    module: 'stock',
    about: 'Stock moved between the group\'s venues, a row for each item of each transfer at each end: sent from a venue (out) and received at the other (in), with what was sent, what arrived and what was lost in transit (sent less received, never below zero), in transit until it is received, or cancelled (back at the sender). Valued at the sender\'s average cost when it was sent, with Costing view. A transfer counts on the day it was sent at the sender and on the day it was received at the receiver.',
    from: { work: 'stock_transfer_lines', tables: TRANSFER_TABLES },
    idType: 'text',
    venue: 'venue_id',
    date: { sql: '{t}.date', label: 'Day' },
    name: 'item_name',
    open: { page: '/stock?tab=transfers&venue=:venue&transfer=:id', module: 'stock', id: 'transfer_id', with: { venue: 'venue_id' } },
    fields: {
      ...itemFields(),
      number: number('number', { label: 'Transfer number', decimals: 0 }),
      direction: choice('direction', TRANSFER_DIRECTIONS, { label: 'Direction', synonyms: ['sent or received'] }),
      status: choice('status', TRANSFER_STATUS_LABELS, { label: 'Status', synonyms: ['in transit'] }),
      sent: number('sent', { label: 'Sent' }),
      received: number('received', { label: 'Received', about: 'What arrived; empty until it is received.' }),
      lost: number('lost', { label: 'Lost in transit', synonyms: ['lost', 'missing', 'short'], about: 'Sent less received, never below zero; empty until it is received.' }),
      sent_at: moment('sent_at', { label: 'Sent at' }),
      received_at: moment('received_at', { label: 'Received at' }),
      sent_by: text('sent_by', { label: 'Sent by' }),
      received_by: text('received_by', { label: 'Received by' }),
      note: text('note', { label: 'Note' }),
      value: pounds('value', { label: 'Value sent', about: 'What was sent at the sender\'s average cost when it was sent.' }),
      received_value: pounds('received_value', { label: 'Value received' }),
      lost_value: pounds('lost_value', { label: 'Value lost in transit' }),
    },
    measures: {
      transfers: countDistinct('transfer_id', { label: 'Transfers', synonyms: ['transfer', 'transfers', 'moved stock', 'stock moved'] }),
      sent_qty: sum('sent', { label: 'Quantity sent', where: "{t}.direction = 'out'", about: 'In each item\'s own unit.' }),
      received_qty: sum('received', { label: 'Quantity received', where: "{t}.direction = 'in'", about: 'In each item\'s own unit.' }),
      lost_qty: sum('lost', { label: 'Quantity lost in transit', where: "{t}.direction = 'out'", synonyms: ['lost in transit', 'lost'], about: 'In each item\'s own unit.' }),
      sent_value: value('value', { label: 'Value sent', where: "{t}.direction = 'out'" }),
      lost_value_total: value('lost_value', { label: 'Value lost in transit', where: "{t}.direction = 'out'", synonyms: ['lost in transit', 'transit loss'] }),
      in_transit: countDistinct('transfer_id', { label: 'In transit', where: "{t}.status = 'sent' AND {t}.direction = 'out'", synonyms: ['in transit', 'on its way'] }),
    },
    links: {
      item: one('purchasing.items', 'item_id', { label: 'Item' }),
      other_venue: one('venue', 'other_venue_id', { label: 'The other venue' }),
    },
    list: ['date', 'number', 'direction', 'venue.name', 'other_venue.name', 'item_name', 'sent', 'received', 'lost', 'base_unit', 'status'],
    sort: [{ by: 'sent_at', dir: 'desc' }],
  }),
]
