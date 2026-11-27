// shared/forms.js
//
// The forms that open in a sheet over a page (docs/CHAT_FIRST.md F1-F9,
// docs/PEPPER_FIRST.md step 3): one list for both sides. The API's open_form
// tool (api/src/ai/tools/forms.js) picks from it and checks the module; the
// admin's sheet (admin/src/components/forms/FormSheet.jsx) opens each with the
// page's own component and links to its page.
//
// Each form:
//   title    its name
//   module   the module it needs View on (read only below `edit`)
//   edit     the level that changes it: 'use' (everyday work) or 'manage'
//   path     the full page behind it (F8); `phone` the phone app's page, if any
//   by       'date' (a day), 'week' (a week, by its Monday) or null (no day)
//   fields   what Pepper may fill in (F4, F7), see FIELD TYPES below; {} = nothing
//   drafts   true: its unsaved values are kept on the server per person,
//            venue and day until Save (F6); forms that save each value as it
//            is typed (the check grids) or keep a draft of their own (an
//            order) have none
//   window   true: it opens a window of its own instead of the sheet (sold
//            out, a new booking, a booking's details)
//   group    true: a form for the whole group (a supplier): it needs no venue
//   plain    true: a flat set-up form drawn by one renderer from the schema
//            its route validates with (Pepper-first step 8A3): its fields are
//            the API's (api/src/forms/<area>.js), never listed here, so
//            `fields` stays {} (GET /api/forms/:key gives them to the sheet,
//            and open_form checks Pepper's values against the route's schema)
//
// FIELD TYPES (fields: { key: field }):
//   { type: 'text', max }                     words, one line or a few
//   { type: 'number', min, max, measured? }   measured: a reading (a temperature,
//                                             a count) that only the person may
//                                             give: Pepper places it only when the
//                                             number is in their own words
//   { type: 'int', min, max }
//   { type: 'bool' }
//   { type: 'enum', values: [...] }
//   { type: 'date' }                          YYYY-MM-DD
//   { type: 'time' }                          HH:MM
//   { type: 'list', max, of: { key: field } } rows of fields
// Every field has a `label` (the mark and the saved summary use it); a list
// row's `required` fields must be there, or the row is left out.

export const FORMS = {
  temps: {
    title: 'Fridge and freezer checks', module: 'food_safety', edit: 'use', path: '/food-safety', by: 'date',
    fields: {
      readings: { type: 'list', max: 40, label: 'Readings', of: {
        name:  { type: 'text', max: 80, label: 'Fridge or freezer', required: true },
        temp:  { type: 'number', min: -40, max: 40, measured: true, label: 'Temperature', required: true },
        check: { type: 'text', max: 40, label: 'Check time' },
      } },
    },
  },
  holds: {
    title: 'Hot and cold hold checks', module: 'food_safety', edit: 'use', path: '/food-safety', by: 'date',
    fields: {
      readings: { type: 'list', max: 40, label: 'Readings', of: {
        name:  { type: 'text', max: 80, label: 'Hold station', required: true },
        temp:  { type: 'number', min: -40, max: 120, measured: true, label: 'Temperature', required: true },
        check: { type: 'text', max: 40, label: 'Check time' },
      } },
    },
  },
  cooking: {
    title: 'Cooking checks', module: 'food_safety', edit: 'use', path: '/food-safety', by: 'date',
    fields: {},
  },
  delivery: {
    title: 'Delivery checks', module: 'food_safety', edit: 'use', path: '/food-safety', by: 'date',
    fields: {
      supplier:          { type: 'text', max: 120, label: 'Supplier' },
      product_temp:      { type: 'number', min: -40, max: 40, measured: true, label: 'Product temperature' },
      accepted:          { type: 'bool', label: 'Accepted' },
      corrective_action: { type: 'text', max: 500, label: 'Corrective action' },
      notes:             { type: 'text', max: 500, label: 'Notes' },
    },
    drafts: true,
  },
  checklist: {
    title: 'Checklist', module: 'checklists', edit: 'use', path: '/checklists', by: 'date',
    fields: {},
  },
  cash_up: {
    title: 'Cash-up', module: 'cash_recon', edit: 'use', path: '/cash-recon', phone: '/mobile/cash-up', by: 'date',
    fields: {},
  },
  wages: {
    title: 'Wages', module: 'cash_recon', edit: 'use', path: '/cash-recon', phone: '/mobile/wages', by: 'week',
    fields: {},
  },
  expense: {
    title: 'Expenses', module: 'cash_recon', edit: 'use', path: '/cash-recon', phone: '/mobile/expenses', by: 'date',
    fields: {}, plain: true, drafts: true,
  },
  sold_out: {
    title: 'Sold out', module: 'web_orders', edit: 'manage', path: '/orders', phone: '/mobile/orders', by: null,
    fields: {}, window: true,
  },
  rota_day: {
    title: 'Rota', module: 'rota', edit: 'manage', path: '/rota', by: 'date',
    fields: {},
  },
  // The four of F1 added in step 3e.
  order: {
    title: 'Supplier order', module: 'purchasing', edit: 'manage', path: '/purchasing', phone: '/mobile/purchasing', by: null,
    fields: {
      items: { type: 'list', max: 60, label: 'Items', of: {
        name: { type: 'text', max: 120, label: 'Item', required: true },
        qty:  { type: 'number', min: 0, max: 10000, label: 'Quantity', required: true },
      } },
    },
  },
  corrective: {
    title: 'Corrective actions', module: 'food_safety', edit: 'use', path: '/food-safety', by: 'date',
    fields: {
      reading: { type: 'text', max: 120, label: 'Reading (fridge, station or dish)' },
      action:  { type: 'text', max: 500, label: 'Corrective action' },
    },
    drafts: true,
  },
  hs_action: {
    title: 'H&S action', module: 'hs_action_log', edit: 'use', path: '/hs-action-log', by: 'date',
    fields: {
      task:        { type: 'text', max: 200, label: 'Task' },
      details:     { type: 'text', max: 1000, label: 'Details' },
      category:    { type: 'text', max: 80, label: 'Category' },
      priority:    { type: 'enum', values: ['low', 'medium', 'high', 'critical'], label: 'Priority' },
      assigned_to: { type: 'text', max: 120, label: 'Assigned to' },
      due_date:    { type: 'date', label: 'Due date' },
      notes:       { type: 'text', max: 1000, label: 'Notes' },
    },
    drafts: true,
  },
  booking: {
    title: 'New booking', module: 'bookings', edit: 'manage', path: '/bookings', by: 'date',
    fields: {
      name:   { type: 'text', max: 120, label: 'Name' },
      phone:  { type: 'text', max: 40, label: 'Phone' },
      email:  { type: 'text', max: 200, label: 'Email' },
      covers: { type: 'int', min: 1, max: 300, label: 'Covers' },
      time:   { type: 'time', label: 'Time' },
      notes:  { type: 'text', max: 500, label: 'Notes' },
    },
    drafts: true, window: true,
  },
  booking_change: {
    title: 'Change a booking', module: 'bookings', edit: 'manage', path: '/bookings', by: 'date',
    fields: {}, window: true,
  },
  // Flat set-up forms drawn from their route's schema (step 8A3).
  supplier: {
    title: 'New supplier', module: 'purchasing_setup', edit: 'manage', path: '/suppliers', by: null,
    fields: {}, plain: true, drafts: true, group: true,
  },
  staff_member: {
    title: 'New staff member', module: 'staff', edit: 'manage', path: '/staff', by: null,
    fields: {}, plain: true, drafts: true,
  },
  closure: {
    title: 'Close dates', module: 'schedule', edit: 'manage', path: '/schedule', by: null,
    fields: {}, plain: true, drafts: true,
  },
  // A recipe's details (inventory phase 3); its lines are added on its page.
  recipe: {
    title: 'New recipe', module: 'recipes', edit: 'manage', path: '/recipes', by: null,
    fields: {}, plain: true, drafts: true, group: true,
  },
  // A key-item count from one of the group's lists (inventory phase 4a): the
  // form starts it; the counting is on the Stock page or the phone's count page.
  stock_key_count: {
    title: 'New key-item count', module: 'stock', edit: 'use', path: '/stock', phone: '/mobile/stock-count', by: null,
    fields: {}, plain: true,
  },
  // Waste (inventory phase 4b): an item, a prep batch or a dish, with a photo
  // after it is saved; the full form (a preview of what it takes off) is the
  // Stock page's Waste tab and the phone's waste page.
  stock_waste: {
    title: 'Log waste', module: 'stock', edit: 'use', path: '/stock', phone: '/mobile/stock-waste', by: null,
    fields: {}, plain: true,
  },
  // One item sent to another venue (phase 4b); several at once on the Stock page's Transfers tab.
  stock_transfer: {
    title: 'Send stock to another venue', module: 'stock', edit: 'use', path: '/stock', by: null,
    fields: {}, plain: true,
  },
}

/** The flat set-up forms drawn from their route's schema (plain: true). */
export const PLAIN_FORM_KEYS = Object.keys(FORMS).filter(k => FORMS[k].plain)

export const FORM_KEYS = Object.keys(FORMS)

/** The forms Pepper may put values into. */
export const FILLABLE_FORMS = FORM_KEYS.filter(k => Object.keys(FORMS[k].fields).length)

/** A form's fields in a line for Pepper's tool description:
 *  "supplier, product_temp (measured), accepted (yes/no), ...". */
export function fieldsLine(fields) {
  const one = (k, f) => {
    if (f.type === 'list') return k + ': [{ ' + Object.entries(f.of).map(([kk, ff]) => one(kk, ff)).join(', ') + ' }]'
    const kind = f.type === 'bool' ? 'yes/no' : f.type === 'enum' ? f.values.join(' | ')
      : f.type === 'date' ? 'YYYY-MM-DD' : f.type === 'time' ? 'HH:MM' : f.type === 'text' ? '' : f.type
    const notes = [kind, f.measured ? 'measured' : '', f.required ? 'required' : ''].filter(Boolean)
    return k + (notes.length ? ' (' + notes.join(', ') + ')' : '')
  }
  return Object.entries(fields).map(([k, f]) => one(k, f)).join(', ')
}
