// src/forms/plain.js
//
// Flat set-up forms drawn from the server's own validation schema
// (Pepper-first step 8A3; docs/PEPPER_FIRST.md 13 decision 3; "The filled
// form" in reports/AI first back office strategy.md). One definition
// validates the request (the route's zod schema, exported from the route),
// says what Pepper may fill (open_form) and draws the form (the admin's
// PlainForm): the model never makes up a field, its layout or its rules.
//
// A form's definition (api/src/forms/<area>.js, `forms`):
//   schema   the zod object the route validates with (imported from the
//            route, never a copy)
//   save     { method, path }: the route the form saves through, as the
//            admin calls it (no /api; ':venue' is the form's venue)
//   fields   the fields drawn, in order: { key: { label, help?, examples?,
//            kind?, choices?, options?, when? } }
//              kind     'textarea' | 'tel' | 'url' | 'email' | 'money': how a
//                       text or number is typed (the schema says text or number)
//              choices  { value: 'Label' } for an enum's values
//              options  { path, list?, label, only? }: the group's own list
//                       a uuid field picks from (path as the admin calls it,
//                       ':venue' allowed; list the reply's key that holds the
//                       rows, label the row's name, only a yes/no a row needs
//                       to be offered). Pepper names one by its label, never
//                       its id (rule 19)
//              when     { field: value | [values] }: drawn only then
//              start    the value the form starts from, when not the schema's
//                       default (checked against the schema)
//   from     { field: 'date' }: a field the sheet gives (its day), not drawn
//   leave    { field: 'why' }: the schema's fields the form leaves out
//   attach   { label, path }: a file sent after the save (path with ':id',
//            the saved row's id), e.g. a receipt photo
//   saved    the line kept when it saves, with {field} for a value
//
// fieldList(def) turns it into the list the renderer draws: [{ key, label,
// help, examples, type, required, min, max, maxLength, choices, options,
// when, default }], type one of text, textarea, email, tel, url, number,
// int, money, bool, choice, date, time. Deterministic: the same schema gives
// the same list, and the role only decides read only (the route).

import { z } from 'zod'
import { ToolError } from '../ai/context.js'

export const FIELD_TYPES = ['text', 'textarea', 'email', 'tel', 'url', 'number', 'int', 'money', 'bool', 'choice', 'date', 'time']
// How a field may be typed beyond what its schema says, by the schema's type.
const KINDS = { ZodString: ['textarea', 'tel', 'url', 'email'], ZodNumber: ['money'] }
const DATE_RE = /\\d\{4\}-\\d\{2\}-\\d\{2\}/
const TIME_RE = /\\d\{2\}:\\d\{2\}/

/** A schema without its optional, nullable, default and refine/transform wrappers. */
export function unwrap(schema) {
  let s = schema
  let optional = false, nullable = false, dflt
  for (;;) {
    const t = s?._def?.typeName
    if (t === 'ZodOptional') { optional = true; s = s._def.innerType; continue }
    if (t === 'ZodNullable') { nullable = true; s = s._def.innerType; continue }
    if (t === 'ZodDefault') { optional = true; dflt = s._def.defaultValue(); s = s._def.innerType; continue }
    if (t === 'ZodEffects') { s = s._def.schema; continue }
    break
  }
  return { base: s, optional, nullable, default: dflt }
}

const labelOf = key => { const s = String(key).replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1) }

/** One field of the list, from its schema and the form's words for it. */
function fieldOf(formKey, key, schema, meta) {
  const fail = msg => { throw new Error('Plain form ' + formKey + ', ' + key + ': ' + msg) }
  if (!schema) fail('isn\'t in the route\'s schema')
  const { base, optional, nullable, default: dflt } = unwrap(schema)
  const t = base?._def?.typeName
  const checks = base?._def?.checks || []
  const check = kind => checks.find(c => c.kind === kind)
  if (meta.kind && !(KINDS[t] || []).includes(meta.kind)) fail('kind ' + meta.kind + ' doesn\'t fit a ' + t)
  const out = { key, label: meta.label || labelOf(key), required: !optional && !nullable }
  if (meta.help) out.help = meta.help
  if (meta.examples?.length) out.examples = meta.examples
  if (dflt !== undefined) out.default = dflt
  if (t === 'ZodString') {
    const re = check('regex')?.regex?.source || ''
    if (check('uuid')) {
      if (!meta.options?.path) fail('a uuid needs options: the list it picks from')
      out.type = 'choice'
      out.options = {
        path: meta.options.path, label: meta.options.label || 'name',
        ...(meta.options.list ? { list: meta.options.list } : {}), ...(meta.options.only ? { only: meta.options.only } : {}),
      }
    } else if (DATE_RE.test(re)) out.type = 'date'
    else if (TIME_RE.test(re)) out.type = 'time'
    else if (check('email')) out.type = 'email'
    else out.type = meta.kind || 'text'
    if (check('max')) out.maxLength = check('max').value
    if (out.type === 'text' && out.maxLength > 500) out.type = 'textarea'
  } else if (t === 'ZodNumber') {
    out.type = meta.kind || (check('int') ? 'int' : 'number')
    if (check('min')) out.min = check('min').value
    if (check('max')) out.max = check('max').value
  } else if (t === 'ZodBoolean') {
    out.type = 'bool'
  } else if (t === 'ZodEnum') {
    out.type = 'choice'
    out.choices = base._def.values.map(v => ({ value: v, label: meta.choices?.[v] || labelOf(v) }))
  } else {
    fail('a ' + (t || 'value') + ' isn\'t a flat field (leave it out of the form, with why)')
  }
  if (meta.when) out.when = meta.when
  // A value the form starts from, other than the schema's default: one the schema takes.
  if (meta.start !== undefined) {
    if (!schema.safeParse(meta.start).success) fail('start ' + JSON.stringify(meta.start) + ' isn\'t a value the schema takes')
    out.default = meta.start
  }
  return out
}

const cache = new WeakMap()

/** The fields a plain form draws, in order (see the head of this file). */
export function fieldList(formKey, def) {
  if (cache.has(def)) return cache.get(def)
  const shape = def.schema?.shape
  if (!shape) throw new Error('Plain form ' + formKey + ': its schema isn\'t a zod object')
  const list = Object.entries(def.fields).map(([k, meta]) => fieldOf(formKey, k, shape[k], meta || {}))
  for (const f of list) {
    for (const [other] of Object.entries(f.when || {})) {
      if (!list.some(x => x.key === other)) throw new Error('Plain form ' + formKey + ', ' + f.key + ': when names ' + other + ', which isn\'t drawn')
    }
  }
  // Every field of the schema is drawn, given by the sheet, or left out with why.
  for (const k of Object.keys(shape)) {
    if (!def.fields[k] && !def.from?.[k] && !def.leave?.[k]) throw new Error('Plain form ' + formKey + ': the schema\'s ' + k + ' is neither drawn, given (from) nor left out (leave)')
  }
  cache.set(def, list)
  return list
}

/** The fields in a line for Pepper's open_form: "name (required), send_method (email | print), role (by name)". */
export function plainFieldsLine(formKey, def) {
  return fieldList(formKey, def).map(f => {
    const kind = f.type === 'choice'
      ? (f.options ? 'one of the group\'s, by name' : f.choices.map(c => c.value).join(' | '))
      : f.type === 'bool' ? 'yes/no' : f.type === 'date' ? 'YYYY-MM-DD' : f.type === 'time' ? 'HH:MM'
      : ['int', 'number', 'money'].includes(f.type)
        ? (f.type === 'int' ? 'int' : 'number') + (f.min != null && f.max != null ? ' ' + f.min + '-' + f.max : f.min != null ? ' ' + f.min + ' or more' : '')
      : ''
    const notes = [kind, f.required ? 'required' : ''].filter(Boolean)
    return f.key + (notes.length ? ' (' + notes.join(', ') + ')' : '')
  }).join(', ')
}

/**
 * Pepper's values for a plain form, checked by the route's own schema: a
 * field the form doesn't draw is left out (said in `left`), a value the
 * schema refuses refuses the call (the model tries again), and a field that
 * picks from the group's list takes the name as said (the form finds it).
 * -> { values, left }
 */
export function checkPlainValues(formKey, def, raw) {
  const values = {}
  const left = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { values, left }
  const fields = new Map(fieldList(formKey, def).map(f => [f.key, f]))
  for (const [key, v] of Object.entries(raw)) {
    const f = fields.get(key)
    if (!f) { left.push(key + (def.from?.[key] ? ' (the form takes it from its day)' : ' (not a field of this form)')); continue }
    if (v === null || v === undefined || v === '') continue
    const schema = f.options ? z.string().trim().min(1).max(120) : def.schema.shape[key]
    const r = schema.safeParse(v)
    if (!r.success) throw new ToolError('values.' + key + ': ' + r.error.issues.map(i => i.message).join(', ') + '.', 422)
    values[key] = r.data
  }
  return { values, left }
}
