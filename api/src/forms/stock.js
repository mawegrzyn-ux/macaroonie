// src/forms/stock.js: the Stock area's plain forms (src/forms/plain.js says
// what a definition holds), drawn from the route's own schema (inventory
// phase 4a). A key-item count is started here, from one of the group's
// lists; its lines are counted on the Stock page or the phone's count page.

import { KeyCountBody } from '../routes/stockCounts.js'

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
}
