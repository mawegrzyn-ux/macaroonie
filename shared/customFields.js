// shared/customFields.js: a group's own fields on a few business objects
// (Pepper-first step 8B1; docs/PEPPER_FIRST.md 13 decision 5: custom fields
// in the same field registry, no tenant-defined tables). The one
// implementation of their rules (rule 12): the API checks values with it, the
// admin's forms draw and check with it, Pepper's tools take values by label
// through it and the report catalogue reads its SQL.
//
// A definition (table custom_fields, migration 285):
//   { id, object_key, field_key, label, type, options, required, help }
// A value lives on the object's own row, in its jsonb column `custom`, by
// field_key: { payment_terms: '30 days', halal: true }.
//
//   CUSTOM_OBJECTS          the objects that take them: { key: { module } },
//                           keys of the object registry (shared/registry);
//                           module = who may see (View) and set them up (Manage)
//   CUSTOM_TYPES            text | number | yesno | date | choice
//   MAX_FIELDS              per object, MAX_OPTIONS per choice
//   fieldKeyOf(label)       the key a new field is stored under
//   definitionProblem(def)  what is wrong with a definition, or null
//   cleanValue(def, v)      a value as stored (trimmed text, a number, a
//                           boolean, YYYY-MM-DD), or undefined when it isn't one
//   valueProblem(def, v)    what is wrong with a value, or null
//   checkValues(defs, raw, { byLabel, create })
//                           -> { values, problems }: raw keyed by field key
//                           (or label with byLabel); null or '' clears a field;
//                           create: every required field must be there
//   valueText(def, v)       a stored value in words ('Yes', '30 days')
//   fieldSql(def)           the report catalogue's template for it ({t} is
//                           the object's row)

export const CUSTOM_OBJECTS = {
  'guests.customers':     { module: 'customers' },
  'staff.people':         { module: 'staff' },
  'purchasing.suppliers': { module: 'purchasing_setup' },
  'purchasing.items':     { module: 'purchasing_setup' },
}
export const CUSTOM_OBJECT_KEYS = Object.keys(CUSTOM_OBJECTS)

export const CUSTOM_TYPES = ['text', 'number', 'yesno', 'date', 'choice']
export const TYPE_LABELS = { text: 'Text', number: 'Number', yesno: 'Yes or no', date: 'Date', choice: 'One of a list' }
export const MAX_FIELDS = 20
export const MAX_OPTIONS = 30
export const MAX_TEXT = 500
export const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** The key a field is stored under: its label in lower case words, joined by _. */
export function fieldKeyOf(label) {
  const k = String(label || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  if (!k) return ''
  return /^[a-z]/.test(k) ? k : ('f_' + k).slice(0, 40)
}

/** What is wrong with a definition (label, type, options), or null. */
export function definitionProblem(def) {
  const label = String(def?.label ?? '').trim()
  if (!label) return 'A field needs a name'
  if (label.length > 60) return 'A field\'s name is at most 60 characters'
  if (!CUSTOM_TYPES.includes(def?.type)) return 'A field is text, a number, yes or no, a date or one of a list'
  if (def.field_key != null && !KEY_RE.test(def.field_key)) return 'A field\'s key is lower case letters, digits and _'
  if (def.type === 'choice') {
    const opts = def.options || []
    if (!Array.isArray(opts) || !opts.length) return 'One of a list needs its choices'
    if (opts.length > MAX_OPTIONS) return 'At most ' + MAX_OPTIONS + ' choices'
    const seen = new Set()
    for (const o of opts) {
      const t = String(o ?? '').trim()
      if (!t || t.length > 80) return 'Each choice is 1 to 80 characters'
      if (seen.has(t.toLowerCase())) return 'The choice ' + t + ' is there twice'
      seen.add(t.toLowerCase())
    }
  } else if (def.options?.length) {
    return 'Only one of a list has choices'
  }
  if (def.help != null && String(def.help).length > 200) return 'Help is at most 200 characters'
  return null
}

/** A real calendar day as YYYY-MM-DD. */
function isDay(s) {
  if (!DATE_RE.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** A value as stored, or undefined when it isn't one of this field's. */
export function cleanValue(def, v) {
  if (v === null || v === undefined) return undefined
  switch (def.type) {
    case 'text': {
      if (typeof v !== 'string' && typeof v !== 'number') return undefined
      const t = String(v).trim()
      return t && t.length <= MAX_TEXT ? t : undefined
    }
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim().replace(/,/g, '')) : NaN
      return Number.isFinite(n) && Math.abs(n) < 1e12 ? n : undefined
    }
    case 'yesno': {
      if (typeof v === 'boolean') return v
      const t = String(v).trim().toLowerCase()
      if (['yes', 'y', 'true'].includes(t)) return true
      if (['no', 'n', 'false'].includes(t)) return false
      return undefined
    }
    case 'date': {
      const t = String(v).trim()
      return isDay(t) ? t : undefined
    }
    case 'choice': {
      const t = String(v).trim().toLowerCase()
      return (def.options || []).find(o => o.toLowerCase() === t)
    }
    default: return undefined
  }
}

/** What is wrong with a value for this field, or null (empty is fine unless required). */
export function valueProblem(def, v) {
  if (v === null || v === undefined || v === '') return def.required ? 'Needed' : null
  if (cleanValue(def, v) !== undefined) return null
  switch (def.type) {
    case 'number': return 'A number'
    case 'yesno': return 'Yes or no'
    case 'date': return 'A date (YYYY-MM-DD)'
    case 'choice': return 'One of: ' + (def.options || []).join(', ')
    default: return 'Text of up to ' + MAX_TEXT + ' characters'
  }
}

/**
 * Values checked against the group's definitions for one object. `raw` is
 * keyed by field key, or by label (any case) with `byLabel`. A field nobody
 * defined is a problem (never kept); null or '' clears a field (null in
 * `values`, which the API takes off the row); with `create`, a required field
 * left out or cleared is a problem.
 * -> { values: { field_key: value | null }, problems: ['Label: why'] }
 */
export function checkValues(defs, raw, { byLabel = false, create = false } = {}) {
  const values = {}
  const problems = []
  const list = defs || []
  const find = k => {
    const t = String(k).trim().toLowerCase()
    return byLabel
      ? list.find(d => d.label.toLowerCase() === t) || list.find(d => d.field_key === t)
      : list.find(d => d.field_key === k)
  }
  if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) {
    return { values, problems: ['The fields are a set of names and values'] }
  }
  for (const [k, v] of Object.entries(raw || {})) {
    const def = find(k)
    if (!def) { problems.push(k + ': no such field' + (list.length ? ' (the fields are ' + list.map(d => d.label).join(', ') + ')' : '')); continue }
    if (v === null || v === undefined || v === '') {
      if (def.required) problems.push(def.label + ': needed')
      else values[def.field_key] = null
      continue
    }
    const clean = cleanValue(def, v)
    if (clean === undefined) {
      const why = valueProblem(def, v)
      problems.push(def.label + ': ' + why.charAt(0).toLowerCase() + why.slice(1))
    }
    else values[def.field_key] = clean
  }
  if (create) {
    for (const d of list) if (d.required && (values[d.field_key] === undefined || values[d.field_key] === null) && !problems.some(p => p.startsWith(d.label + ':'))) problems.push(d.label + ': needed')
  }
  return { values, problems }
}

/** A stored value in words. */
export function valueText(def, v) {
  if (v === null || v === undefined || v === '') return ''
  if (def.type === 'yesno') return v ? 'Yes' : 'No'
  return String(v)
}

/**
 * The report catalogue's SQL template for a field: the value read from the
 * row's `custom` column, typed, null when it isn't one (a value stored before
 * the field's choices changed still reads as text). The key is checked
 * against KEY_RE first: it is the only thing written into the SQL.
 */
export function fieldSql(def) {
  if (!KEY_RE.test(def.field_key || '')) throw new Error('A custom field\'s key isn\'t safe: ' + def.field_key)
  const at = '({t}.custom -> \'' + def.field_key + '\')'
  const text = '({t}.custom ->> \'' + def.field_key + '\')'
  switch (def.type) {
    case 'number': return '(CASE WHEN jsonb_typeof(' + at + ') = \'number\' THEN ' + text + '::numeric END)'
    case 'yesno': return '(CASE WHEN jsonb_typeof(' + at + ') = \'boolean\' THEN ' + text + '::boolean END)'
    case 'date': return '(CASE WHEN ' + text + ' ~ \'^[0-9]{4}-[0-9]{2}-[0-9]{2}$\' THEN ' + text + '::date END)'
    default: return text
  }
}
