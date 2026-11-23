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
//   window   true: it opens a window of its own instead of the sheet
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
// Every field has a `label` (the mark and the saved summary use it).

export const FORMS = {
  temps: {
    title: 'Fridge and freezer checks', module: 'food_safety', edit: 'use', path: '/food-safety', by: 'date',
    fields: {},
  },
  holds: {
    title: 'Hot and cold hold checks', module: 'food_safety', edit: 'use', path: '/food-safety', by: 'date',
    fields: {},
  },
  cooking: {
    title: 'Cooking checks', module: 'food_safety', edit: 'use', path: '/food-safety', by: 'date',
    fields: {},
  },
  delivery: {
    title: 'Delivery checks', module: 'food_safety', edit: 'use', path: '/food-safety', by: 'date',
    fields: {},
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
    fields: {},
  },
  sold_out: {
    title: 'Sold out', module: 'web_orders', edit: 'manage', path: '/orders', phone: '/mobile/orders', by: null,
    fields: {}, window: true,
  },
  rota_day: {
    title: 'Rota', module: 'rota', edit: 'manage', path: '/rota', by: 'date',
    fields: {},
  },
}

export const FORM_KEYS = Object.keys(FORMS)
