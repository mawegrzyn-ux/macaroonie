// src/ai/tools/forms.js
//
// open_form (OUTSTANDING 44 item 3, docs/PEPPER_FIRST.md 4.2 and step 3):
// "do today's cash-up", "log the fridge temps", "who's on Saturday": Pepper
// opens the form itself in the chat, as a card with an Open button, for the
// person to fill in. The model picks the form, the venue and the day, and may
// put values into the form's declared fields (`values`, F4 and F7): only what
// the person said or a document states, never a measured value (a
// temperature, a count) the person didn't say themselves. The card is built
// here from what the server found and checked (form_card), never from the
// model's text; the sheet marks each value Pepper placed until the person
// changes or accepts it, and Save goes through the page's own route.
//
// The forms are one list with the admin's sheet (shared/forms.js,
// components/forms/FormSheet.jsx): the six Today forms (fridge and freezer,
// hot and cold hold, cooking checks, a checklist, the cash-up, the week's
// wages) and more: delivery checks, the day's expenses with receipts, sold
// out dishes, the rota for a day, and since step 3e a supplier order,
// corrective actions, an H&S action log entry, a new booking and a booking's
// details to change. Each needs View on its module: the form
// shows read only below the level that changes it (`edit`), as on its page.
//
// In the staff chat the card opens the form; through the staff connector
// (another AI app) the answer is a link to the page, and values are not used.

import { z } from 'zod'
import { ToolError, isStaff, callApi, staffPermissionLevel, levelAtLeast } from '../context.js'
import { officeOrigin } from '../../services/platformHost.js'
import { MODULES } from '../../config/modules.js'
import { DateStr, TimeStr, VenueText, venueFor, venueToday, mondayOf, longDate, pickByName, pickCheckTime, reference, tenantVenueList } from './util.js'
import { FORMS, FORM_KEYS, FILLABLE_FORMS, fieldsLine } from '../../../../shared/forms.js'
import { PLAIN_FORMS, plainFields, customObjectOf } from '../../forms/index.js'
import { withTenant } from '../../config/db.js'
import { loadDefinitions } from '../../services/customFields.js'
import { checkValues as checkCustomValues } from '../../../../shared/customFields.js'
import { checkPlainValues, plainFieldsLine } from '../../forms/plain.js'

// The forms, one list with the admin's sheet (shared/forms.js): each one's
// title, module, the level that changes it, its page, its day or week and
// the fields Pepper may fill.
export const OPEN_FORMS = FORMS
const MODULE_LABEL = Object.fromEntries(MODULES.map(m => [m.key, m.label]))

/** The card's title: the form, and its day or week. */
function cardTitle(key, f, { date, monday, template, booking }) {
  if (key === 'checklist') return template.name
  if (key === 'order') return 'Supplier order'
  if (key === 'hs_action') return 'New H&S action'
  if (key === 'booking_change') return 'Booking for ' + booking.guest_name + ', ' + longDate(date)
  if (key === 'wages') return 'Wages, week of ' + longDate(monday)
  if (key === 'sold_out') return 'Sold out dishes'
  if (key === 'cash_up') return 'Cash-up for ' + longDate(date)
  if (key === 'rota_day') return 'Rota for ' + longDate(date)
  if (!f.by) return f.title
  return f.title + ', ' + longDate(date)
}

// ── Pepper's values (F4, F7) ─────────────────────────────

/** The zod schema of one declared field (shared/forms.js FIELD TYPES). */
function fieldSchema(f) {
  switch (f.type) {
    case 'text':   return z.string().trim().min(1).max(f.max ?? 500)
    case 'number': return z.number().finite().min(f.min ?? -1e9).max(f.max ?? 1e9)
    case 'int':    return z.number().int().min(f.min ?? -1e9).max(f.max ?? 1e9)
    case 'bool':   return z.boolean()
    case 'enum':   return z.enum(f.values)
    case 'date':   return DateStr
    case 'time':   return TimeStr
    default:       throw new Error('Unknown field type ' + f.type)
  }
}

/** The numbers in the person's own words ("fridge 2 is 6", "minus 18"). */
export function saidNumbers(text) {
  const out = []
  for (const m of String(text || '').matchAll(/(minus\s+|-)?(\d+(?:[.,]\d+)?)/gi)) {
    const n = Number(m[2].replace(',', '.'))
    out.push(m[1] ? -n : n)
  }
  return out
}
const isSaid = (n, said) => said.some(s => Math.abs(s - n) < 1e-9)

/**
 * Pepper's values checked against a form's declared fields: unknown fields
 * (and unknown keys in a row) are left out, a value of the wrong type or out
 * of range refuses the call (the model tries again), and a measured value is
 * kept only when its number is in the person's own words this turn (`said`).
 * A list row missing a required field is left out. Returns { values, left }:
 * `left` says in words what was left out and why, for the model.
 */
export function checkValues(form, raw, said) {
  const fields = FORMS[form].fields
  const values = {}
  const left = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { values, left }
  const nums = saidNumbers(said)
  const one = (f, v, where) => {
    const r = fieldSchema(f).safeParse(v)
    if (!r.success) throw new ToolError('values.' + where + ': ' + r.error.issues.map(i => i.message).join(', ') + '.', 422)
    if (f.measured && !isSaid(r.data, nums)) {
      left.push(where + ' (' + r.data + ' is a measured value the person didn\'t say; they type it themselves)')
      return undefined
    }
    return r.data
  }
  for (const [key, v] of Object.entries(raw)) {
    const f = fields[key]
    if (!f) { left.push(key + ' (not a field of this form)'); continue }
    if (v === null || v === undefined || v === '') continue
    if (f.type !== 'list') {
      const ok = one(f, v, key)
      if (ok !== undefined) values[key] = ok
      continue
    }
    if (!Array.isArray(v)) throw new ToolError('values.' + key + ' must be a list of rows.', 422)
    if (v.length > f.max) throw new ToolError('values.' + key + ': at most ' + f.max + ' rows.', 422)
    const rows = []
    v.forEach((row, i) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new ToolError('values.' + key + '[' + i + '] must be a row of fields.', 422)
      const out = {}
      for (const [k, rv] of Object.entries(row)) {
        const rf = f.of[k]
        if (!rf) { left.push(key + '[' + i + '].' + k + ' (not a field of this form)'); continue }
        if (rv === null || rv === undefined || rv === '') continue
        const ok = one(rf, rv, key + '[' + i + '].' + k)
        if (ok !== undefined) out[k] = ok
      }
      const missing = Object.entries(f.of).filter(([k, rf]) => rf.required && out[k] === undefined).map(([k]) => k)
      if (missing.length) {
        if (Object.keys(out).length) left.push(key + '[' + i + '] (no ' + missing.join(', ') + ')')
        return
      }
      rows.push(out)
    })
    if (rows.length) values[key] = rows
  }
  return { values, left }
}

/** A fridge or hold reading's unit and check time, from the names said. */
async function placeReadings(ctx, venue, date, rows, fridge, left) {
  const [units, times] = await Promise.all([
    callApi(ctx, 'GET', `/api/food-safety/${fridge ? 'equipment' : 'hold-stations'}?venue_id=${venue.id}`),
    callApi(ctx, 'GET', `/api/food-safety/${fridge ? 'capture-times' : 'hold-capture-times'}?venue_id=${venue.id}`),
  ])
  const active = (units || []).filter(u => u.is_active !== false)
  const checks = (times || []).filter(t => t.is_active !== false)
  const out = []
  for (const r of rows) {
    try {
      const unit = pickByName(active, r.name, u => u.name, fridge ? 'fridge or freezer' : 'hold station')
      const time = pickCheckTime(checks, r.check, date, venue)
      const key = fridge ? 'equipment_id' : 'station_id'
      out.push({ [key]: unit.id, capture_time_id: time?.id ?? null, name: unit.name, check: time?.label ?? null, temp: r.temp })
    } catch (err) {
      if (!(err instanceof ToolError)) throw err
      left.push(r.name + ' (' + err.message + ')')
    }
  }
  return out
}

// Per form: the values turned into what the sheet places (names to the
// venue's own rows). A form without one passes its checked values on as they are.
const PLACE = {
  temps: async (ctx, venue, date, v, left) => {
    const readings = await placeReadings(ctx, venue, date, v.readings || [], true, left)
    return readings.length ? { readings } : {}
  },
  holds: async (ctx, venue, date, v, left) => {
    const readings = await placeReadings(ctx, venue, date, v.readings || [], false, left)
    return readings.length ? { readings } : {}
  },
}

/** A booking on the day by its reference or the guest's name (booking_change). */
async function pickBooking(ctx, venue, date, text) {
  if (!text) throw new ToolError('Which booking? Give the guest\'s name or the booking\'s reference.', 422)
  const rows = (await callApi(ctx, 'GET', `/api/bookings?venue_id=${venue.id}&date=${date}&limit=200`) || [])
    .filter(b => !['cancelled', 'no_show'].includes(b.status))
  const ref = String(text).trim().replace(/^#/, '').toUpperCase()
  const byRef = rows.filter(b => reference(b.id) === ref)
  if (byRef.length === 1) return byRef[0]
  return pickByName(rows, text, b => b.guest_name, 'booking on ' + longDate(date), 'There are no bookings that day.')
}

/**
 * The group's own fields given for a plain form (values.custom, by their
 * names), checked against the definitions of the object the form adds:
 * { values: { 'custom.<key>': value }, labels: { 'custom.<key>': name } }.
 */
async function ownFormValues(ctx, formKey, raw) {
  if (raw == null) return { values: {}, labels: {} }
  const object = customObjectOf(formKey)
  if (!object) throw new ToolError('values.custom: this form has no fields of the group\'s own.', 422)
  const defs = await withTenant(ctx.tenantId, tx => loadDefinitions(tx, ctx.tenantId, object))
  const { values, problems } = checkCustomValues(defs, raw, { byLabel: true })
  if (problems.length) throw new ToolError('values.custom: ' + problems.join('; ') + '.', 422)
  const out = { values: {}, labels: {} }
  for (const [k, v] of Object.entries(values)) {
    if (v === null) continue
    out.values['custom.' + k] = v
    out.labels['custom.' + k] = defs.find(d => d.field_key === k).label
  }
  return out
}

// The fields Pepper may fill, per form: a plain form's are its route's own
// (api/src/forms/, step 8A3), the rest are declared in shared/forms.js.
const VALUES_HELP = [
  ...FILLABLE_FORMS.map(k => k + ' { ' + fieldsLine(FORMS[k].fields) + ' }'),
  ...Object.entries(PLAIN_FORMS).map(([k, def]) => k + ' { ' + plainFieldsLine(k, def) + ' }'),
].join('; ')

// What Pepper is told about this file's tools, gathered by tools/index.js:
// the place in the list (order, then the file name), the areas the tools
// belong to, and the file's lines in the system prompt (prompts.js).
export { formTools as tools }
export const order = 150
// The file's line(s) in the list of what Pepper can do.
export const promptLines = [
  'open_form opens a form in the chat for the person to fill in ("do today\'s cash-up", "log the fridge temps", ' +
    '"open the closing checklist", "add an expense", "mark the pad thai sold out myself", "who\'s on Saturday"): ' +
    'fridge and freezer, hold, cooking and delivery checks, a checklist, the cash-up, the week\'s wages, the day\'s ' +
    'expenses, sold out dishes, the rota for a day, a supplier order, corrective actions, an H&S action, a new booking, ' +
    'a booking\'s details, a new supplier, a new staff member or closed dates. Use it when the person wants to fill ' +
    'the form in themselves, or has many values to enter at once. When they have stated the values of one check or ' +
    'one change that a tool records (a reading, a delivery, a booking, an action), call that tool instead: its card is the confirmation. You may put values into the form ' +
    '(values) only from what the person said or a document they gave states; never infer or guess a reading, a count ' +
    'or an amount. The person checks every value and saves the form themselves.',
]

export const formTools = [
  {
    name: 'open_form',
    core: true,
    section: 'general',
    title: 'Open a form',
    description:
      'Opens a form in the chat for the staff member to fill in and save themselves (a card with an Open button). ' +
      'form: temps (fridge and freezer temperature checks), holds (hot and cold hold checks), cooking (cooking ' +
      'checks), delivery (delivery checks: temperatures and condition on arrival), checklist (a checklist, by name in ' +
      'checklist; left out = the one due), cash_up (a day\'s cash-up), wages (a week\'s wages; any date in the week), ' +
      'expense (a new petty cash expense on the day, with a receipt photo, above the day\'s list), sold_out (mark ' +
      'dishes sold out), rota_day (who is on and the rota for a day), order (a supplier order: pick the list, then quantities), corrective (corrective actions ' +
      'for the day\'s out-of-range readings), hs_action (a new H&S action log entry), booking (a new table booking on the ' +
      'day), booking_change (a booking\'s details to change: the guest\'s name or reference in booking, on the day), ' +
      'supplier (a new supplier), staff_member (a new staff member at the venue), closure (close the venue to bookings ' +
      'on some dates). ' +
      'Use it when they ask to do one of these themselves ("do today\'s cash-up", "open the closing checklist", ' +
      '"I\'ll do the order"), or when there are many values to enter at once. When the person has stated the values of ' +
      'one check or one change that a tool records (log_temperature, log_hold_check, log_cooking_check, log_delivery, ' +
      'create_booking, add_hs_action, add_expense, add_supplier, add_staff_member, close_dates), call that tool ' +
      'instead: its card is the confirmation. With values, ' +
      'open_form is the fallback when no single tool fits. date defaults to today at the venue. ' +
      'values (optional): what the person said or a document they gave states, placed in the form for them to check ' +
      '(each marked as filled by you): ' + VALUES_HELP + '; supplier and staff_member also take custom { name: value } ' +
      'for the group\'s own fields (what_can_i_do names them). Never put in a value they didn\'t give: a measured value ' +
      '(a temperature) only when they said the number themselves; names as they said them. Fields left out stay empty. ' +
      'Reply in one short line; the card says the rest.',
    input: z.object({
      form:      z.enum(FORM_KEYS),
      venue:     VenueText,
      date:      DateStr.optional().describe('The day (or any day of the week for wages). Defaults to today at the venue.'),
      checklist: z.string().trim().max(120).optional().describe('For form checklist: its name. Left out = the one due.'),
      booking:   z.string().trim().max(120).optional().describe('For form booking_change: the guest\'s name or the booking\'s 8-character reference, on the day (date).'),
      values:    z.record(z.string(), z.unknown()).optional()
        .describe('Values for the form\'s fields, only what the person said or a document states (see the description).'),
    }),
    readOnly: true,
    async run(ctx, input) {
      if (!isStaff(ctx)) throw new ToolError('Not available here', 403)
      const f = OPEN_FORMS[input.form]
      const level = await staffPermissionLevel(ctx, f.module)
      if (!levelAtLeast(level, 'view')) {
        throw new ToolError('You don\'t have access to ' + (MODULE_LABEL[f.module] || f.module) + ', so that form can\'t open. Ask an owner or admin.', 403)
      }
      // Checked before anything else, so a bad value is refused the same everywhere:
      // a plain form's by its route's own schema (8A3).
      const { custom: ownRaw, ...given } = input.values || {}
      const checked = PLAIN_FORMS[input.form]
        ? checkPlainValues(input.form, PLAIN_FORMS[input.form], given)
        : checkValues(input.form, input.values, ctx.said)
      // The group's own fields on a plain form's object (step 8B1), by their names: 'custom.<key>' in the form.
      const own = PLAIN_FORMS[input.form] ? await ownFormValues(ctx, input.form, ownRaw) : { values: {}, labels: {} }
      Object.assign(checked.values, own.values)
      // A form for the whole group (a supplier) opens at any venue: none is asked for.
      const venue = f.group && !input.venue
        ? (await tenantVenueList(ctx))[0] ?? await venueFor(ctx, input.venue)
        : await venueFor(ctx, input.venue)
      const date = input.date || venueToday(venue)
      const monday = mondayOf(date)
      let template = null
      if (input.form === 'checklist') {
        const due = await callApi(ctx, 'GET', `/api/checklists/due?venue_id=${venue.id}&date=${date}`)
        const open = due.filter(d => !d.not_required)
        if (!open.length) throw new ToolError('No checklist is due at ' + venue.name + ' on ' + longDate(date) + '.', 404)
        const pick = input.checklist
          ? pickByName(open, input.checklist, d => d.template.name, 'checklist due', 'No checklist is due that day.')
          : (open.filter(d => d.instance?.status !== 'completed').length === 1
            ? open.find(d => d.instance?.status !== 'completed')
            : null)
        if (!pick) throw new ToolError('Which checklist? Due: ' + open.map(d => d.template.name).join(', ') + '.', 422)
        template = pick.template
      }
      let booking = null
      if (input.form === 'booking_change') {
        const b = await pickBooking(ctx, venue, date, input.booking)
        booking = { id: b.id, guest_name: b.guest_name, reference: reference(b.id) }
      }
      const ref = f.by === 'week' ? { week: monday } : f.by === 'date' ? { date } : {}
      if (template) ref.template = template
      if (booking) ref.booking = booking
      const title = cardTitle(input.form, f, { date, monday, template, booking })
      const readOnly = !levelAtLeast(level, f.edit)
      if (ctx.channel !== 'staff_chat') {
        return { form: title, venue: venue.name, url: officeOrigin() + f.path, message: 'Open the page to fill it in.' }
      }
      const left = [...checked.left]
      const values = readOnly || !Object.keys(checked.values).length ? {}
        : PLACE[input.form] ? await PLACE[input.form](ctx, venue, date, checked.values, left) : checked.values
      if (readOnly && Object.keys(checked.values).length) left.push('every value (this person can only read this form)')
      const filled = Object.keys(values)
      // A plain form's labels come from its route's schema (shared/forms.js has none): the card names them.
      const labels = PLAIN_FORMS[input.form] && filled.length
        ? [...plainFields(input.form).filter(f => filled.includes(f.key)).map(f => f.label), ...filled.filter(k => own.labels[k]).map(k => own.labels[k])]
        : null
      return {
        form_card: {
          form: input.form, title, venue_id: venue.id, venue: venue.name, date, ref, read_only: readOnly,
          ...(filled.length ? { values } : {}),
          ...(labels ? { labels } : {}),
        },
        message: 'A card for "' + title + '" with an Open button is in the chat' + (readOnly ? ' (read only for this person)' : '') + '.' +
          (filled.length ? ' Your values are in the form, marked for the person to check: ' + filled.join(', ') + '.' : '') +
          (left.length ? ' Left out: ' + left.join('; ') + '.' : ''),
      }
    },
    // The chat's card (chat.js): from the result the server made, never the model's words.
    display(out) {
      const c = out?.form_card
      return c && OPEN_FORMS[c.form] ? { type: 'form', form: c } : null
    },
  },
]
