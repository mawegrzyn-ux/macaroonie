// src/forms/stock.js: the Stock area's plain forms (src/forms/plain.js says
// what a definition holds), drawn from the route's own schema (inventory
// phase 4a). A key-item count is started here, from one of the group's
// lists; its lines are counted on the Stock page or the phone's count page.
// Phase 4b: logging waste (one thing, with a photo after it is saved) and
// sending one item to another venue (a transfer of several items is sent on
// the Stock page or by Pepper's send_transfer).

import { KeyCountBody } from '../routes/stockCounts.js'
import { WasteBody } from '../routes/stockWaste.js'
import { TransferBody } from '../routes/stockTransfers.js'

const PICKERS = '/stock/venues/:venue/waste/pickers'

export const forms = {
  stock_key_count: {
    schema: KeyCountBody,
    save: { method: 'POST', path: '/stock/venues/:venue/key-counts' },
    saved: 'Started a key-item count: count it on the Stock page or the phone',
    fields: {
      key_list_id: { label: 'Key-item list', help: 'The short list to count (set up on the Stock page, Settings).', options: { path: '/stock/key-lists', label: 'name' } },
      note:        { label: 'Note', kind: 'textarea', help: 'Optional, e.g. Before the delivery.' },
    },
  },
  stock_waste: {
    schema: WasteBody,
    save: { method: 'POST', path: '/stock/venues/:venue/waste' },
    saved: 'Logged {qty} as waste: undo it on the Stock page the same day if it was a mistake',
    fields: {
      what:      { label: 'What was wasted', choices: { item: 'An item', recipe: 'A prep batch', dish: 'A dish' }, start: 'item' },
      item_id:   { label: 'Item', options: { path: PICKERS, list: 'items', label: 'name' }, when: { what: 'item' } },
      recipe_id: { label: 'Prep batch', help: 'Broken into its items by its recipe.', options: { path: PICKERS, list: 'recipes', label: 'name' }, when: { what: 'recipe' } },
      dish_id:   { label: 'Dish', help: 'Broken into its items by the recipe it uses here.', options: { path: PICKERS, list: 'dishes', label: 'name' }, when: { what: 'dish' } },
      qty:       { label: 'How much', help: 'For a dish, how many.' },
      unit:      { label: 'Unit', help: 'kg, g, l, each, or one of the item\'s own (tray, case). Left empty: its usual unit.', when: { what: ['item', 'recipe'] } },
      order_type_id: { label: 'Order type', help: 'Only when a dish taken away or delivered has a recipe of its own.', options: { path: PICKERS, list: 'order_types', label: 'name' }, when: { what: 'dish' } },
      reason_id: { label: 'Why', options: { path: PICKERS, list: 'reasons', label: 'name' } },
      note:      { label: 'Note', kind: 'textarea', help: 'Optional, e.g. Off the pass at lunch.' },
    },
    leave: {
      revenue_stream_id: 'a dish\'s revenue stream is picked on the Stock page\'s waste form',
      wasted_at: 'waste is logged for now from the form',
    },
    attach: { label: 'Photo', path: '/stock/waste/:id/photo' },
  },
  stock_transfer: {
    schema: TransferBody,
    save: { method: 'POST', path: '/stock/venues/:venue/transfers' },
    saved: 'Sent: it arrives when someone at the other venue receives it',
    fields: {
      to_venue_id: { label: 'To', help: 'Another of the group\'s venues.', options: { path: '/venues', label: 'name' } },
      item_id:     { label: 'Item', options: { path: PICKERS, list: 'items', label: 'name' } },
      qty:         { label: 'How much' },
      unit:        { label: 'Unit', help: 'kg, g, l, each, or one of the item\'s own (tray, case). Left empty: its usual unit.' },
      note:        { label: 'Note', kind: 'textarea', help: 'Optional, e.g. For the weekend.' },
    },
    leave: {
      lines: 'a transfer of several items is sent on the Stock page or by Pepper',
      sent_at: 'a transfer is sent now from the form',
    },
  },
}
