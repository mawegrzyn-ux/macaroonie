// shared/plainForm.js: the plain renderer's rules (Pepper-first step 8A3),
// apart from React so they are tested on their own (shared/test/plainForm.test.mjs)
// and the admin's PlainForm (admin/src/components/forms/PlainForm.jsx) only
// draws what they say. The field list comes from the API (GET /api/forms/:key,
// derived from the route's own schema by api/src/forms/plain.js):
//   [{ key, label, help?, examples?, type, required, min?, max?, maxLength?,
//      choices?, options?, when?, default? }]
//
//   layoutOf(fields, values)   what is drawn, in order: [{ key, control,
//                              label, required, help, choices? }]. The same
//                              list and values give the same layout
//   controlOf(field)           the control a field is drawn with
//   shown(field, values)       is it drawn (its `when`)
//   startOf(field, given, options)   its first value (Pepper's or a draft's,
//                              else the schema's default, else empty)
//   problemOf(field, value)    what is wrong with a value, or null
//   bodyOf(fields, values, from, date)  what the route is sent
//   savedLine(template, fields, values, options)  the saved line
//   pickOption(options, said)  a row of the group's list from a name or an id

export const NUMBER_TYPES = ['number', 'int', 'money']
const INPUT_TYPES = { email: 'email', tel: 'tel', url: 'url', time: 'time', text: 'text', int: 'text', number: 'text', money: 'text' }
// A choice with this many values or fewer is a row of buttons; more is a list.
export const BUTTON_CHOICES = 4

/** Does a field show, given the others' values (its `when`)? */
export function shown(field, values) {
  return Object.entries(field.when || {}).every(([k, want]) => [].concat(want).includes(values?.[k] ?? ''))
}

/** The control a field is drawn with. */
export function controlOf(field) {
  if (field.type === 'bool') return 'checkbox'
  if (field.type === 'choice') return !field.options && field.choices.length <= BUTTON_CHOICES ? 'buttons' : 'select'
  if (field.type === 'date') return 'date'
  if (field.type === 'textarea') return 'textarea'
  return 'input:' + (INPUT_TYPES[field.type] || 'text')
}

/** What is drawn, in order, for these values: the renderer draws exactly this. */
export function layoutOf(fields, values = {}) {
  return fields.filter(f => shown(f, values)).map(f => ({
    key: f.key,
    control: controlOf(f),
    label: f.label,
    required: !!f.required,
    help: f.help || '',
    ...(f.choices ? { choices: f.choices.map(c => c.value) } : {}),
  }))
}

/** A row of the group's list picked by a name (Pepper's) or an id (a draft): exact first, then contained. */
export function pickOption(options, said) {
  if (said == null || said === '') return null
  const t = String(said).trim().toLowerCase()
  return options.find(o => o.value === said) || options.find(o => o.label.toLowerCase() === t)
    || options.find(o => o.label.toLowerCase().includes(t)) || null
}

/** The value a field starts from: given (Pepper's, or a draft's), else the schema's default, else empty. */
export function startOf(field, given, options = []) {
  if (given !== undefined && given !== null && given !== '') {
    if (field.options) return pickOption(options, given)?.value ?? ''
    if (field.type === 'bool') return !!given
    return String(given)
  }
  if (field.default !== undefined) return field.type === 'bool' ? !!field.default : String(field.default)
  return field.type === 'bool' ? false : ''
}

/** What is wrong with a typed value, by the field list (the route checks again), or null. */
export function problemOf(field, v) {
  const empty = v === '' || v == null
  if (empty) return field.required && field.type !== 'bool' ? 'Needed' : null
  if (NUMBER_TYPES.includes(field.type)) {
    const n = Number(v)
    if (!Number.isFinite(n)) return 'A number'
    if (field.type === 'int' && !Number.isInteger(n)) return 'A whole number'
    if (field.min != null && n < field.min) return 'At least ' + field.min
    if (field.max != null && n > field.max) return 'At most ' + field.max
  }
  if (field.maxLength && String(v).length > field.maxLength) return 'At most ' + field.maxLength + ' characters'
  return null
}

/** The body the route takes: drawn fields only, typed as the schema wants, empty ones left out; `from` from the sheet's day. */
export function bodyOf(fields, values, from = {}, date = null) {
  const body = {}
  for (const f of fields) {
    if (!shown(f, values)) continue
    const v = values[f.key]
    if (f.type === 'bool') { body[f.key] = !!v; continue }
    if (v === '' || v == null) continue
    body[f.key] = NUMBER_TYPES.includes(f.type) ? Number(v) : f.type === 'time' ? String(v).slice(0, 5) : String(v).trim()
  }
  for (const [k, what] of Object.entries(from || {})) if (what === 'date' && date) body[k] = date
  return body
}

/** The saved line: the form's words with {field} filled in (a choice by its label, money as £). */
export function savedLine(template, fields, values, options = {}) {
  if (!template) return 'Saved'
  return template.replace(/\{([a-z_]+)\}/g, (_, k) => {
    const f = fields.find(x => x.key === k)
    const v = values[k]
    if (!f || v === '' || v == null) return ''
    if (f.type === 'money') return '£' + Number(v).toFixed(2)
    if (f.options) return options[k]?.find(o => o.value === v)?.label ?? ''
    if (f.choices) return f.choices.find(c => c.value === v)?.label ?? v
    return String(v)
  }).replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim()
}
