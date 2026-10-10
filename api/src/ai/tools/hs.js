// src/ai/tools/hs.js
//
// Health & safety and checklist tools for staff: the admin assistant panel
// and the staff MCP connector, next to the booking tools in staff.js.
// What they cover, and the permission each needs (the same modules as the
// admin pages):
//
//   hs_status            the day's H&S status per venue, the Overview
//                        tiles' numbers (services/hsStatus.js)      checklists or food_safety, view
//   food_safety_day      every fridge / hold / cooking / delivery
//                        reading for a day, what's missing, what's
//                        out of range with no corrective action      food_safety, view
//   log_temperature      fridge / freezer reading                     food_safety, manage
//   log_hold_check       hot / cold hold reading                      food_safety, manage
//   log_cooking_check    core temperature of a dish                   food_safety, manage
//   log_delivery         delivery check                               food_safety, manage
//   add_corrective_action  what was done about a bad reading         food_safety, manage
//   checklists_due       checklists for a venue and day               checklists, view
//   get_checklist        one checklist's tasks and ticks              checklists, view
//   tick_checklist       tick or untick tasks (or all)                checklists, manage
//   list_hs_actions      H&S action log entries                       hs_action_log, view
//   add_hs_action        new action log entry                         hs_action_log, manage
//   complete_hs_action   mark an entry done or not done               hs_action_log, manage
//
// Like the booking tools, reads go through the admin routes or SQL with an
// explicit tenant filter, and every change goes through the admin route
// in-process (callApi), so the route's checks are the admin's. Change tools
// are `confirm` tools: in a chat the staff member sees a card and nothing
// is written until they press Confirm. Every change is audited.
//
// Dates default to today at the venue (its own time zone), never the
// server's date. Fridges, hold stations, check times, cooking sessions,
// dishes and categories are named the way staff say them; pickByName()
// matches them and asks when a name is ambiguous.

import { z } from 'zod'
import { sql, withTenant } from '../../config/db.js'
import {
  ToolError, callApi, audit, requireStaffPermission, staffPermissionLevel, levelAtLeast,
} from '../context.js'
import { computeHsStatus } from '../../services/hsStatus.js'
import { DateStr, localParts, longDate } from './util.js'
import { staffVenue } from './staff.js'

const Id = z.string().uuid()
const num = v => (v === null || v === undefined || v === '') ? null : Number(v)
const hhmm = t => (t ? String(t).slice(0, 5) : null)
const venueNow = venue => localParts(new Date(), venue.timezone)
const dayOf = (venue, date) => date || venueNow(venue).date
const fmtTemp = t => (t === null || t === undefined) ? '' : Number(t).toFixed(1) + '°C'

function rangeText(min, max) {
  if (min != null && max != null) return min + ' to ' + max + '°C'
  if (min != null) return 'at least ' + min + '°C'
  if (max != null) return 'at most ' + max + '°C'
  return null
}
const inRange = (t, min, max) => (min == null || t >= min) && (max == null || t <= max)

/**
 * The one row whose name matches `text`: its id, then exact, then starts
 * with, then contains (case-insensitive). Throws listing the choices when
 * nothing or more than one matches.
 */
function pickByName(rows, text, nameOf, what) {
  const raw = String(text ?? '').trim()
  const byId = rows.find(r => r.id === raw)
  if (byId) return byId
  const t = raw.toLowerCase()
  for (const test of [n => n === t, n => n.startsWith(t), n => n.includes(t)]) {
    const hits = rows.filter(r => test(String(nameOf(r)).toLowerCase()))
    if (hits.length === 1) return hits[0]
    if (hits.length > 1) {
      throw new ToolError('More than one ' + what + ' matches "' + raw + '": ' + hits.map(nameOf).join(', ') + '. Which one?', 409)
    }
  }
  throw new ToolError('No ' + what + ' called "' + raw + '". ' +
    (rows.length ? 'There is: ' + rows.map(nameOf).join(', ') + '.' : 'None are set up for this venue yet (H&S settings).'), 404)
}

/**
 * Which check time a reading is for. Named ("Morning", "09:00") when the
 * person says; else, today, the latest check time that has started (the
 * first if none has); on another day it must be named when there are
 * several. null when the venue has no check times (an extra reading).
 */
function pickCheckTime(times, wanted, date, venue) {
  if (!times.length) return null
  const sorted = [...times].sort((a, b) => String(a.time_of_day).localeCompare(String(b.time_of_day)))
  const label = t => t.label + ' (' + hhmm(t.time_of_day) + ')'
  if (wanted) {
    const w = String(wanted).trim()
    if (/^\d{1,2}:\d{2}$/.test(w)) {
      const hit = sorted.find(t => hhmm(t.time_of_day) === w.padStart(5, '0'))
      if (hit) return hit
      throw new ToolError('No check at ' + w + '. Check times: ' + sorted.map(label).join(', ') + '.', 404)
    }
    return pickByName(sorted, w, t => t.label, 'check time')
  }
  const now = venueNow(venue)
  if (date === now.date) {
    const started = sorted.filter(t => hhmm(t.time_of_day) <= now.time)
    return started.length ? started[started.length - 1] : sorted[0]
  }
  if (sorted.length === 1) return sorted[0]
  throw new ToolError('Which check is it for? Check times: ' + sorted.map(label).join(', ') + '.', 422)
}

/** Today's cooking session the same way the Cooking tab picks it. */
function pickSession(sessions, wanted, date, venue) {
  if (!sessions.length) return null
  if (wanted) return pickByName(sessions, wanted, s => s.label, 'cooking session')
  const timed = sessions.filter(s => s.time_of_day).sort((a, b) => String(a.time_of_day).localeCompare(String(b.time_of_day)))
  const now = venueNow(venue)
  if (!timed.length || date !== now.date) return sessions[0]
  const started = timed.filter(s => hhmm(s.time_of_day) <= now.time)
  return started.length ? started[started.length - 1] : timed[0]
}

const venueLine = (venue, date) => venue.name + ', ' + longDate(date)

// ── Readings ───────────────────────────────────────────────

/** Everything a fridge / hold reading card and run need. */
async function tempPlan(ctx, kind, input) {
  const venue = await staffVenue(ctx, input.venue_id)
  const date = dayOf(venue, input.date)
  const fridge = kind === 'fridge'
  const [units, times, logged] = await Promise.all([
    callApi(ctx, 'GET', `/api/food-safety/${fridge ? 'equipment' : 'hold-stations'}?venue_id=${venue.id}`),
    callApi(ctx, 'GET', `/api/food-safety/${fridge ? 'capture-times' : 'hold-capture-times'}?venue_id=${venue.id}`),
    callApi(ctx, 'GET', `/api/food-safety/${fridge ? 'temp-logs' : 'holds'}?venue_id=${venue.id}&date=${date}`),
  ])
  const unit = pickByName(units || [], fridge ? input.fridge : input.station, u => u.name, fridge ? 'fridge or freezer' : 'hold station')
  const time = pickCheckTime((times || []).filter(t => t.is_active !== false), input.check_time, date, venue)
  const min = num(unit.min_temp_c), max = num(unit.max_temp_c)
  const ok = inRange(input.temperature_c, min, max)
  const unitKey = fridge ? 'equipment_id' : 'station_id'
  const previous = time ? (logged || []).find(l => l[unitKey] === unit.id && l.capture_time_id === time.id) : null
  return { venue, date, unit, time, min, max, ok, previous }
}

function tempCard(kind, input, plan) {
  const { venue, date, unit, time, min, max, ok, previous } = plan
  const what = kind === 'fridge' ? (unit.equipment_type === 'freezer' ? 'freezer' : 'fridge') : 'hold'
  const range = rangeText(min, max)
  return {
    title: 'Log this ' + what + ' temperature?',
    lines: [
      unit.name + ': ' + fmtTemp(input.temperature_c),
      venueLine(venue, date) + (time ? ', ' + time.label + ' check (' + hhmm(time.time_of_day) + ')' : ', extra reading'),
      ...(range ? ['Should be ' + range] : []),
      ...(input.corrective_action ? ['Corrective action: ' + input.corrective_action] : []),
      ...(input.notes ? ['Notes: ' + input.notes] : []),
      ...(previous ? ['Replaces ' + fmtTemp(previous.temperature_c) + ' already logged for this check'] : []),
    ],
    ...(!ok ? {
      warningTitle: 'Out of range',
      warnings: [fmtTemp(input.temperature_c) + ' is outside ' + range + '.' +
        (input.corrective_action ? '' : ' Add what was done about it (a corrective action).')],
    } : {}),
    confirmLabel: 'Log reading',
  }
}

async function runTemp(ctx, kind, tool, input) {
  await requireStaffPermission(ctx, 'food_safety', 'manage')
  const plan = await tempPlan(ctx, kind, input)
  const body = {
    venue_id: plan.venue.id,
    capture_time_id: plan.time?.id ?? null,
    temperature_c: input.temperature_c,
    corrective_action: input.corrective_action ?? null,
    notes: input.notes ?? null,
    ...(kind === 'fridge'
      ? { equipment_id: plan.unit.id, log_date: plan.date }
      : { station_id: plan.unit.id, check_date: plan.date }),
  }
  try {
    const row = await callApi(ctx, 'POST', kind === 'fridge' ? '/api/food-safety/temp-logs' : '/api/food-safety/holds', { body })
    const result = {
      reading_id: row.id, [kind === 'fridge' ? 'fridge' : 'station']: plan.unit.name,
      date: plan.date, check: plan.time?.label ?? null, temperature: fmtTemp(input.temperature_c),
      in_range: plan.ok,
      message: 'Logged.' + (!plan.ok && !input.corrective_action
        ? ' It is out of range with no corrective action yet: ask what was done and add it with add_corrective_action.' : ''),
    }
    await audit(ctx, { tool, input, ok: true, result })
    return result
  } catch (err) {
    await audit(ctx, { tool, input, ok: false, result: { error: err.message } })
    throw err
  }
}

const TempInput = {
  venue_id:          Id,
  temperature_c:     z.number().min(-60).max(150),
  check_time:        z.string().max(60).optional()
    .describe('Which scheduled check: its name ("Morning") or time ("09:00"). Leave out for the check due now.'),
  date:              DateStr.optional().describe('Defaults to today at the venue'),
  corrective_action: z.string().max(2000).optional().describe('What was done about an out-of-range reading'),
  notes:             z.string().max(2000).optional(),
}

// ── Day summaries ──────────────────────────────────────────

async function canSee(ctx, moduleKey) {
  return levelAtLeast(await staffPermissionLevel(ctx, moduleKey), 'view')
}

const STATUS_WORDS = {
  green: 'all done', amber: 'partly done', red: 'needs attention', grey: 'nothing scheduled',
  closed: 'closed (no daily checks needed)', upcoming: 'not yet',
}

export const hsTools = [
  {
    name: 'hs_status',
    title: 'H&S status',
    description:
      'Health & safety status for a day (default today): per venue, which checklists are done and how many ' +
      'fridge, hold and cooking checks are logged out of those due, plus out-of-range readings with no corrective action. ' +
      'The same figures as the Overview page\'s H&S tiles. Use food_safety_day for the readings themselves.',
    input: z.object({
      venue_id: Id.optional().describe('One venue; leave out for all'),
      date:     DateStr.optional(),
    }),
    readOnly: true,
    async run(ctx, { venue_id, date }) {
      const [lists, fs] = await Promise.all([canSee(ctx, 'checklists'), canSee(ctx, 'food_safety')])
      if (!lists && !fs) throw new ToolError('You don\'t have permission to see checklists or food safety logs. Ask an owner or admin.', 403)
      const venue = venue_id ? await staffVenue(ctx, venue_id) : null
      const [first] = venue ? [venue] : await sql`
        SELECT id, name, timezone FROM venues WHERE tenant_id = ${ctx.tenantId} AND is_active = true ORDER BY name LIMIT 1
      `
      if (!first) throw new ToolError('No venues yet.', 404)
      const today = venueNow(first).date
      const day = date || today
      const res = await withTenant(ctx.tenantId, tx => computeHsStatus(tx, ctx.tenantId, day, day, today))
      const venues = res.days[0].venues.filter(v => !venue || v.venue_id === venue.id)
      return {
        date: day, day: longDate(day),
        venues: venues.map(v => {
          const categories = fs ? v.categories : []
          const checklists = lists ? v.checklists : []
          return {
            venue_id: v.venue_id,
            venue: v.venue_name,
            // The overall status mixes checklists and food safety, so it is
            // only given to people who can see both.
            ...(lists && fs ? { status: STATUS_WORDS[v.status] || v.status } : {}),
            ...(v.closed ? { closed: true } : {}),
            ...(lists ? {
              checklists: checklists.map(c => ({
                checklist_id: c.id, name: c.name, frequency: c.frequency,
                done: c.not_required ? 'not needed (closed)' : c.completed ? 'yes' : 'no',
              })),
            } : {}),
            ...(fs ? {
              checks: categories.map(c => ({
                type: c.label,
                ...(c.key === 'delivery' ? { summary: c.summary } : { logged: c.completed + ' of ' + c.expected }),
                ...(c.unresolved ? { out_of_range_without_action: c.unresolved } : {}),
                status: STATUS_WORDS[c.status] || c.status,
              })),
            } : {}),
          }
        }),
      }
    },
  },

  {
    name: 'food_safety_day',
    title: 'Food safety log',
    description:
      'A venue\'s food safety log for a day (default today): each fridge/freezer and hold station with its readings ' +
      'per check time and the checks still missing, cooking checks per session, deliveries, and every out-of-range ' +
      'reading that has no corrective action yet (with its reading_id for add_corrective_action).',
    input: z.object({ venue_id: Id, date: DateStr.optional() }),
    readOnly: true,
    async run(ctx, { venue_id, date }) {
      await requireStaffPermission(ctx, 'food_safety', 'view')
      const venue = await staffVenue(ctx, venue_id)
      const day = dayOf(venue, date)
      const q = path => callApi(ctx, 'GET', `/api/food-safety/${path}${path.includes('?') ? '&' : '?'}venue_id=${venue.id}`)
      const [equipment, times, temps, stations, holdTimes, holds, sessions, cooking, deliveries, settings] = await Promise.all([
        q('equipment'), q('capture-times'), q('temp-logs?date=' + day),
        q('hold-stations'), q('hold-capture-times'), q('holds?date=' + day),
        q('cooking-sessions'), q('cooking?date=' + day), q('deliveries?date=' + day),
        callApi(ctx, 'GET', `/api/hs-settings?venue_id=${venue.id}&date=${day}`).catch(() => ({ closed: false })),
      ])
      const unresolved = []
      const now = venueNow(venue)
      // Today, a check whose time hasn't come yet isn't missing yet.
      const isDue = t => day < now.date || (day === now.date && hhmm(t.time_of_day) <= now.time)
      const units = (list, checkTimes, readings, key, type) => list.map(u => {
        const mine = readings.filter(r => r[key] === u.id)
        for (const r of mine) {
          if (r.is_within_range === false && !r.corrective_action) {
            unresolved.push({ type, reading_id: r.id, what: u.name + ' ' + fmtTemp(r.temperature_c) })
          }
        }
        return {
          name: u.name,
          ...(u.equipment_type ? { type: u.equipment_type } : u.hold_type ? { type: u.hold_type } : {}),
          should_be: rangeText(num(u.min_temp_c), num(u.max_temp_c)),
          readings: mine.map(r => ({
            reading_id: r.id,
            check: checkTimes.find(t => t.id === r.capture_time_id)?.label ?? 'extra reading',
            temperature: fmtTemp(r.temperature_c),
            in_range: r.is_within_range !== false,
            ...(r.corrective_action ? { corrective_action: r.corrective_action } : {}),
          })),
          ...(() => {
            if (settings.closed || day > now.date) return {}
            const open = checkTimes.filter(t => !mine.some(r => r.capture_time_id === t.id))
            const label = t => t.label + ' (' + hhmm(t.time_of_day) + ')'
            const missing = open.filter(isDue).map(label)
            const later = open.filter(t => !isDue(t)).map(label)
            return { missing, ...(later.length ? { later_today: later } : {}) }
          })(),
        }
      })
      for (const c of cooking) {
        if (c.is_within_range === false && !c.corrective_action) {
          unresolved.push({ type: 'cooking', reading_id: c.id, what: c.dish_name + ' ' + fmtTemp(c.core_temp_c) })
        }
      }
      for (const d of deliveries) {
        const passed = d.packaging_ok && d.damage_ok && d.quality_ok && d.temp_ok && d.accepted
        if (!passed && !d.corrective_action) unresolved.push({ type: 'delivery', reading_id: d.id, what: 'Delivery from ' + d.vendor_name })
      }
      return {
        venue: venue.name, date: day, day: longDate(day),
        ...(settings.closed ? { closed: 'Closed today: no fridge, hold or cooking checks are needed.' } : {}),
        fridges_and_freezers: units(equipment, times, temps, 'equipment_id', 'fridge'),
        hold_stations: units(stations, holdTimes, holds, 'station_id', 'hold'),
        cooking: sessions.map(s => {
          const mine = cooking.filter(c => c.session_id === s.id)
          return {
            session: s.label, required: s.required_items_count, logged: mine.length,
            ...(s.time_of_day ? { time: hhmm(s.time_of_day) } : {}),
            dishes: mine.map(c => ({ reading_id: c.id, dish: c.dish_name, core_temp: fmtTemp(c.core_temp_c), in_range: c.is_within_range !== false })),
          }
        }).concat(cooking.some(c => !c.session_id) ? [{
          session: 'No session',
          dishes: cooking.filter(c => !c.session_id).map(c => ({ reading_id: c.id, dish: c.dish_name, core_temp: fmtTemp(c.core_temp_c), in_range: c.is_within_range !== false })),
        }] : []),
        deliveries: deliveries.map(d => ({
          reading_id: d.id, supplier: d.vendor_name, accepted: d.accepted,
          checks_passed: !!(d.packaging_ok && d.damage_ok && d.quality_ok && d.temp_ok),
          ...(d.product_temp_c != null ? { product_temp: fmtTemp(d.product_temp_c) } : {}),
          ...(d.corrective_action ? { corrective_action: d.corrective_action } : {}),
        })),
        out_of_range_without_action: unresolved,
      }
    },
  },

  {
    name: 'log_temperature',
    title: 'Log a fridge temperature',
    description:
      'Logs a fridge or freezer temperature for a scheduled check (default: the check due now, today). ' +
      'Logging the same check again replaces the earlier reading. If the reading is out of range, ask what was done ' +
      'about it and pass it as corrective_action.',
    input: z.object({ ...TempInput, fridge: z.string().min(1).max(200).describe('The fridge or freezer, by name') }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'food_safety', 'manage')
      return tempCard('fridge', input, await tempPlan(ctx, 'fridge', input))
    },
    run: (ctx, input) => runTemp(ctx, 'fridge', 'log_temperature', input),
  },

  {
    name: 'log_hold_check',
    title: 'Log a hold temperature',
    description:
      'Logs a hot or cold hold temperature for a hold station\'s scheduled check (default: the check due now, today). ' +
      'Logging the same check again replaces the earlier reading. Out of range: ask for the corrective action.',
    input: z.object({ ...TempInput, station: z.string().min(1).max(200).describe('The hold station, by name') }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'food_safety', 'manage')
      return tempCard('hold', input, await tempPlan(ctx, 'hold', input))
    },
    run: (ctx, input) => runTemp(ctx, 'hold', 'log_hold_check', input),
  },

  {
    name: 'log_cooking_check',
    title: 'Log a cooking check',
    description:
      'Logs a dish\'s core temperature (75°C or more passes). The dish is matched against the venue\'s cooking-check ' +
      'list; a dish not on it is logged by name. Session defaults to the one running now.',
    input: z.object({
      venue_id:          Id,
      dish:              z.string().min(1).max(200),
      core_temp_c:       z.number().min(-20).max(150),
      session:           z.string().max(100).optional().describe('Cooking session name; leave out for the current one'),
      date:              DateStr.optional(),
      corrective_action: z.string().max(2000).optional(),
      notes:             z.string().max(2000).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'food_safety', 'manage')
      const p = await cookingPlan(ctx, input)
      return {
        title: 'Log this cooking check?',
        lines: [
          p.dishName + ': ' + fmtTemp(input.core_temp_c),
          venueLine(p.venue, p.date) + (p.session ? ', ' + p.session.label : ''),
          ...(p.item ? [] : ['Not on the cooking-check list: logged by name']),
          ...(input.corrective_action ? ['Corrective action: ' + input.corrective_action] : []),
          ...(input.notes ? ['Notes: ' + input.notes] : []),
        ],
        ...(input.core_temp_c < 75 ? {
          warningTitle: 'Below 75°C',
          warnings: ['A core temperature under 75°C fails.' + (input.corrective_action ? '' : ' Add what was done about it (a corrective action).')],
        } : {}),
        confirmLabel: 'Log check',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'food_safety', 'manage')
      const p = await cookingPlan(ctx, input)
      try {
        const row = await callApi(ctx, 'POST', '/api/food-safety/cooking', {
          body: {
            venue_id: p.venue.id, check_date: p.date, session_id: p.session?.id ?? null,
            ...(p.item?.kind === 'menu' ? { menu_item_id: p.item.id }
              : p.item?.kind === 'own' ? { cooking_item_id: p.item.id } : { dish_name: p.dishName }),
            core_temp_c: input.core_temp_c,
            corrective_action: input.corrective_action ?? null,
            notes: input.notes ?? null,
          },
        })
        const ok = input.core_temp_c >= 75
        const result = {
          reading_id: row.id, dish: row.dish_name, core_temp: fmtTemp(input.core_temp_c), in_range: ok,
          session: p.session?.label ?? null, date: p.date,
          message: 'Logged.' + (!ok && !input.corrective_action
            ? ' It is under 75°C with no corrective action yet: ask what was done and add it with add_corrective_action.' : ''),
        }
        await audit(ctx, { tool: 'log_cooking_check', input, ok: true, result })
        return result
      } catch (err) {
        await audit(ctx, { tool: 'log_cooking_check', input, ok: false, result: { error: err.message } })
        throw err
      }
    },
  },

  {
    name: 'log_delivery',
    title: 'Log a delivery check',
    description:
      'Logs a delivery check: supplier, whether packaging, damage, quality and temperature were OK, the product ' +
      'temperature if taken, and whether it was accepted. Anything failed needs a corrective action.',
    input: z.object({
      venue_id:          Id,
      supplier:          z.string().min(1).max(200),
      packaging_ok:      z.boolean().default(true),
      damage_ok:         z.boolean().default(true).describe('true when there was no damage'),
      quality_ok:        z.boolean().default(true),
      temp_ok:           z.boolean().default(true),
      product_temp_c:    z.number().min(-60).max(100).optional(),
      accepted:          z.boolean().default(true),
      date:              DateStr.optional(),
      corrective_action: z.string().max(2000).optional(),
      notes:             z.string().max(2000).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'food_safety', 'manage')
      const venue = await staffVenue(ctx, input.venue_id)
      const date = dayOf(venue, input.date)
      const failed = deliveryFailures(input)
      return {
        title: 'Log this delivery?',
        lines: [
          input.supplier + (input.accepted ? ', accepted' : ', rejected'),
          venueLine(venue, date),
          failed.length ? 'Not OK: ' + failed.join(', ') : 'Packaging, damage, quality and temperature OK',
          ...(input.product_temp_c != null ? ['Product temperature: ' + fmtTemp(input.product_temp_c)] : []),
          ...(input.corrective_action ? ['Corrective action: ' + input.corrective_action] : []),
          ...(input.notes ? ['Notes: ' + input.notes] : []),
        ],
        ...((failed.length || !input.accepted) && !input.corrective_action ? {
          warningTitle: 'Failed check',
          warnings: ['Add what was done about it (a corrective action).'],
        } : {}),
        confirmLabel: 'Log delivery',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'food_safety', 'manage')
      const venue = await staffVenue(ctx, input.venue_id)
      try {
        const row = await callApi(ctx, 'POST', '/api/food-safety/deliveries', {
          body: {
            venue_id: venue.id, delivery_date: dayOf(venue, input.date), vendor_name: input.supplier,
            packaging_ok: input.packaging_ok, damage_ok: input.damage_ok, quality_ok: input.quality_ok,
            temp_ok: input.temp_ok, product_temp_c: input.product_temp_c ?? null, accepted: input.accepted,
            corrective_action: input.corrective_action ?? null, notes: input.notes ?? null,
          },
        })
        const failed = deliveryFailures(input)
        const result = {
          reading_id: row.id, supplier: input.supplier, date: row.delivery_date, accepted: input.accepted,
          message: 'Logged.' + ((failed.length || !input.accepted) && !input.corrective_action
            ? ' It failed a check with no corrective action yet: add one with add_corrective_action.' : ''),
        }
        await audit(ctx, { tool: 'log_delivery', input, ok: true, result })
        return result
      } catch (err) {
        await audit(ctx, { tool: 'log_delivery', input, ok: false, result: { error: err.message } })
        throw err
      }
    },
  },

  {
    name: 'add_corrective_action',
    title: 'Add a corrective action',
    description:
      'Records what was done about an out-of-range or failed reading already logged (reading_id from ' +
      'food_safety_day or a log tool). Replaces any corrective action it had.',
    input: z.object({
      type:              z.enum(['fridge', 'hold', 'cooking', 'delivery']),
      reading_id:        Id,
      corrective_action: z.string().min(1).max(2000),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'food_safety', 'manage')
      const r = await loadReading(ctx, input.type, input.reading_id)
      return {
        title: 'Add this corrective action?',
        lines: [r.what, r.venue + ', ' + longDate(r.date), 'Corrective action: ' + input.corrective_action,
          ...(r.corrective_action ? ['Replaces: ' + r.corrective_action] : [])],
        confirmLabel: 'Save action',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'food_safety', 'manage')
      const r = await loadReading(ctx, input.type, input.reading_id)
      const path = { fridge: 'temp-logs', hold: 'holds', cooking: 'cooking', delivery: 'deliveries' }[input.type]
      try {
        await callApi(ctx, 'PATCH', `/api/food-safety/${path}/${input.reading_id}`, { body: { corrective_action: input.corrective_action } })
        await audit(ctx, { tool: 'add_corrective_action', input, ok: true, result: { what: r.what } })
        return { reading_id: input.reading_id, what: r.what, message: 'Corrective action saved.' }
      } catch (err) {
        await audit(ctx, { tool: 'add_corrective_action', input, ok: false, result: { error: err.message } })
        throw err
      }
    },
  },

  // ── Checklists ─────────────────────────────────────────────

  {
    name: 'checklists_due',
    title: 'Checklists due',
    description:
      'The checklists at a venue for a day (default today): each with its checklist_id, how often it runs, ' +
      'and whether it is done, in progress or not started (weekly and monthly ones count for their whole week or month).',
    input: z.object({ venue_id: Id, date: DateStr.optional() }),
    readOnly: true,
    async run(ctx, { venue_id, date }) {
      await requireStaffPermission(ctx, 'checklists', 'view')
      const venue = await staffVenue(ctx, venue_id)
      const day = dayOf(venue, date)
      const due = await callApi(ctx, 'GET', `/api/checklists/due?venue_id=${venue.id}&date=${day}`)
      return {
        venue: venue.name, date: day, day: longDate(day),
        checklists: due.map(d => ({
          checklist_id: d.template.id,
          name: d.template.name,
          ...(d.template.department ? { department: d.template.department } : {}),
          frequency: d.template.frequency,
          status: d.not_required ? 'not needed (closed)'
            : d.instance?.status === 'completed' ? 'done'
            : d.instance?.checked_count ? 'in progress' : 'not started',
          ticked: (d.instance?.checked_count ?? 0) + ' of ' + d.template.item_count,
          ...(d.instance?.completed_by ? { completed_by: d.instance.completed_by } : {}),
        })),
      }
    },
  },

  {
    name: 'get_checklist',
    title: 'Checklist tasks',
    description: 'One checklist\'s tasks for a day (default today) with which are ticked, and its notes.',
    input: z.object({ checklist_id: Id, date: DateStr.optional() }),
    readOnly: true,
    async run(ctx, { checklist_id, date }) {
      await requireStaffPermission(ctx, 'checklists', 'view')
      const c = await loadChecklist(ctx, checklist_id, date)
      return {
        checklist_id, name: c.template.name, venue: c.venue.name, date: c.date, frequency: c.template.frequency,
        status: c.instance?.status === 'completed' ? 'done' : c.ticked.size ? 'in progress' : 'not started',
        tasks: c.items.map(i => ({
          task_id: i.id, task: i.label, ticked: c.ticked.has(i.id),
          ...(c.values[i.id]?.notes ? { note: c.values[i.id].notes } : {}),
        })),
        ...(c.instance?.notes ? { notes: c.instance.notes } : {}),
      }
    },
  },

  {
    name: 'tick_checklist',
    title: 'Tick checklist tasks',
    description:
      'Ticks tasks on a checklist for a day (default today): name the tasks, or set all to tick every task. ' +
      'untick: true unticks them instead. The checklist is done once every task is ticked.',
    input: z.object({
      checklist_id: Id,
      tasks:        z.array(z.string().min(1).max(300)).max(100).optional().describe('Task names (or task_ids) to tick'),
      all:          z.boolean().optional().describe('Every task'),
      untick:       z.boolean().optional(),
      date:         DateStr.optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'checklists', 'manage')
      const c = await loadChecklist(ctx, input.checklist_id, input.date)
      const plan = tickPlan(c, input)
      const doneAfter = c.items.length > 0 && c.items.every(i => plan.next.has(i.id))
      const verb = input.untick ? 'Untick' : 'Tick'
      return {
        title: verb + ' ' + (plan.changed.length === 1 ? 'this task' : plan.changed.length + ' tasks') + '?',
        lines: [
          c.template.name + ', ' + venueLine(c.venue, c.date),
          ...(input.all && plan.changed.length > 3
            ? [verb + ' all ' + plan.changed.length + ' remaining tasks']
            : plan.changed.map(i => verb + ': ' + i.label)),
          doneAfter ? 'All ' + c.items.length + ' tasks ticked: the checklist will be done'
            : plan.next.size + ' of ' + c.items.length + ' tasks ticked after this',
        ],
        confirmLabel: verb,
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'checklists', 'manage')
      const c = await loadChecklist(ctx, input.checklist_id, input.date)
      const plan = tickPlan(c, input)
      const audited = { ...input, date: c.date }
      try {
        const saved = await callApi(ctx, 'PUT', '/api/checklists/instance', {
          body: {
            template_id: c.template.id,
            date: c.date,
            items: c.items.map(i => ({ template_item_id: i.id, checked: plan.next.has(i.id), notes: c.values[i.id]?.notes ?? null })),
            notes: c.instance?.notes ?? null,
          },
        })
        const result = {
          checklist: c.template.name, date: c.date,
          [input.untick ? 'unticked' : 'ticked']: plan.changed.map(i => i.label),
          ticked: plan.next.size + ' of ' + c.items.length,
          done: saved.status === 'completed',
          message: saved.status === 'completed' ? 'Done: every task is ticked.' : 'Saved.',
        }
        await audit(ctx, { tool: 'tick_checklist', input: audited, ok: true, result })
        return result
      } catch (err) {
        await audit(ctx, { tool: 'tick_checklist', input: audited, ok: false, result: { error: err.message } })
        throw err
      }
    },
  },

  // ── H&S action log ─────────────────────────────────────────

  {
    name: 'list_hs_actions',
    title: 'H&S action log',
    description:
      'A venue\'s H&S action log (repairs, records, training, cleaning jobs): open entries by default, with their ' +
      'action_id, priority, due date and who they are assigned to.',
    input: z.object({ venue_id: Id, status: z.enum(['open', 'completed', 'all']).optional() }),
    readOnly: true,
    async run(ctx, { venue_id, status = 'open' }) {
      await requireStaffPermission(ctx, 'hs_action_log', 'view')
      const venue = await staffVenue(ctx, venue_id)
      const rows = await callApi(ctx, 'GET', `/api/hs-action-log/entries?venue_id=${venue.id}&status=${status === 'open' ? 'open' : status}`)
      const today = venueNow(venue).date
      return {
        venue: venue.name,
        count: rows.length,
        actions: rows.slice(0, 50).map(r => ({
          action_id: r.id, task: r.task,
          ...(r.category_name ? { category: r.category_name } : {}),
          priority: r.priority,
          ...(r.due_date ? { due: dateText(r.due_date), ...(!r.is_completed && dateText(r.due_date) < today ? { overdue: true } : {}) } : {}),
          ...(r.assigned_to ? { assigned_to: r.assigned_to } : {}),
          ...(r.details ? { details: r.details } : {}),
          logged: dateText(r.logged_date),
          ...(r.is_completed ? { done_by: r.completed_by, done_at: r.completed_at } : {}),
        })),
        ...(rows.length > 50 ? { note: 'Showing the first 50.' } : {}),
      }
    },
  },

  {
    name: 'add_hs_action',
    title: 'Add an H&S action',
    description: 'Adds an entry to a venue\'s H&S action log (a repair, record, training or cleaning job to do).',
    input: z.object({
      venue_id:    Id,
      task:        z.string().min(1).max(300),
      details:     z.string().max(4000).optional(),
      category:    z.string().max(100).optional().describe('Category name, e.g. Repairs'),
      priority:    z.enum(['low', 'medium', 'high', 'critical']).optional(),
      due_date:    DateStr.optional(),
      assigned_to: z.string().max(200).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'hs_action_log', 'manage')
      const { venue, category } = await actionPlan(ctx, input)
      return {
        title: 'Add this to the action log?',
        lines: [
          input.task,
          venue.name + (category ? ', ' + category.name : ''),
          'Priority: ' + (input.priority || 'medium'),
          ...(input.due_date ? ['Due ' + longDate(input.due_date)] : []),
          ...(input.assigned_to ? ['For ' + input.assigned_to] : []),
          ...(input.details ? [input.details] : []),
        ],
        confirmLabel: 'Add action',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'hs_action_log', 'manage')
      const { venue, category } = await actionPlan(ctx, input)
      try {
        const row = await callApi(ctx, 'POST', '/api/hs-action-log/entries', {
          body: {
            venue_id: venue.id, logged_date: venueNow(venue).date, task: input.task,
            details: input.details ?? null, category_id: category?.id ?? null,
            priority: input.priority ?? 'medium', due_date: input.due_date ?? null,
            assigned_to: input.assigned_to ?? null,
          },
        })
        const result = { action_id: row.id, task: row.task, message: 'Added to the action log.' }
        await audit(ctx, { tool: 'add_hs_action', input, ok: true, result })
        return result
      } catch (err) {
        await audit(ctx, { tool: 'add_hs_action', input, ok: false, result: { error: err.message } })
        throw err
      }
    },
  },

  {
    name: 'complete_hs_action',
    title: 'Complete an H&S action',
    description: 'Marks an action log entry done (or, with done: false, not done again).',
    input: z.object({ action_id: Id, done: z.boolean().default(true) }),
    confirm: true,
    async describe(ctx, { action_id, done }) {
      await requireStaffPermission(ctx, 'hs_action_log', 'manage')
      const a = await loadAction(ctx, action_id)
      return {
        title: done ? 'Mark this done?' : 'Reopen this action?',
        lines: [a.task, a.venue_name + (a.category_name ? ', ' + a.category_name : '')],
        confirmLabel: done ? 'Mark done' : 'Reopen',
      }
    },
    async run(ctx, { action_id, done }) {
      await requireStaffPermission(ctx, 'hs_action_log', 'manage')
      const a = await loadAction(ctx, action_id)
      try {
        await callApi(ctx, 'PATCH', `/api/hs-action-log/entries/${a.id}/complete`, { body: { is_completed: done } })
        await audit(ctx, { tool: 'complete_hs_action', input: { action_id, done }, ok: true, result: { task: a.task } })
        return { action_id, task: a.task, message: done ? 'Marked done.' : 'Reopened.' }
      } catch (err) {
        await audit(ctx, { tool: 'complete_hs_action', input: { action_id, done }, ok: false, result: { error: err.message } })
        throw err
      }
    },
  },
]

// ── Helpers that load and check before a change ────────────

const dateText = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10))

function deliveryFailures(input) {
  return [
    !input.packaging_ok && 'packaging',
    !input.damage_ok && 'damage',
    !input.quality_ok && 'quality',
    !input.temp_ok && 'temperature',
  ].filter(Boolean)
}

async function cookingPlan(ctx, input) {
  const venue = await staffVenue(ctx, input.venue_id)
  const date = dayOf(venue, input.date)
  const [picker, sessions] = await Promise.all([
    callApi(ctx, 'GET', `/api/food-safety/cooking/items?venue_id=${venue.id}`),
    callApi(ctx, 'GET', `/api/food-safety/cooking-sessions?venue_id=${venue.id}`),
  ])
  const items = []
  for (const sec of picker?.sections || []) for (const it of sec.items || []) {
    if (!items.some(x => x.id === it.id)) items.push(it)
  }
  let item = null
  try {
    item = pickByName(items, input.dish, i => i.name, 'dish')
  } catch (err) {
    if (err.status !== 404) throw err   // ambiguous: ask which
  }
  const session = pickSession(sessions || [], input.session, date, venue)
  return { venue, date, item, dishName: item ? item.name : input.dish.trim(), session }
}

/** A logged reading of this tenant, for the corrective-action card. */
async function loadReading(ctx, type, id) {
  const rows = type === 'fridge' ? await sql`
      SELECT l.corrective_action, l.log_date::text AS date, e.name || ' ' || l.temperature_c || '°C' AS what, v.name AS venue
        FROM fs_temp_logs l JOIN fs_equipment e ON e.id = l.equipment_id JOIN venues v ON v.id = l.venue_id
       WHERE l.id = ${id} AND l.tenant_id = ${ctx.tenantId}`
    : type === 'hold' ? await sql`
      SELECT h.corrective_action, h.check_date::text AS date, s.name || ' ' || h.temperature_c || '°C' AS what, v.name AS venue
        FROM fs_hold_checks h JOIN fs_hold_stations s ON s.id = h.station_id JOIN venues v ON v.id = h.venue_id
       WHERE h.id = ${id} AND h.tenant_id = ${ctx.tenantId}`
    : type === 'cooking' ? await sql`
      SELECT c.corrective_action, c.check_date::text AS date, c.dish_name || ' ' || c.core_temp_c || '°C' AS what, v.name AS venue
        FROM fs_cooking_checks c JOIN venues v ON v.id = c.venue_id
       WHERE c.id = ${id} AND c.tenant_id = ${ctx.tenantId}`
    : await sql`
      SELECT d.corrective_action, d.delivery_date::text AS date, 'Delivery from ' || d.vendor_name AS what, v.name AS venue
        FROM fs_delivery_checks d JOIN venues v ON v.id = d.venue_id
       WHERE d.id = ${id} AND d.tenant_id = ${ctx.tenantId}`
  if (!rows.length) throw new ToolError('Reading not found. Use food_safety_day to find its reading_id.', 404)
  return rows[0]
}

/** A checklist of this tenant for a day: template, venue, tasks and ticks. */
async function loadChecklist(ctx, checklistId, date) {
  const [t] = await sql`
    SELECT id, venue_id FROM checklist_templates
     WHERE id = ${checklistId} AND tenant_id = ${ctx.tenantId} AND is_active = true
  `
  if (!t) throw new ToolError('Checklist not found. Use checklists_due for the checklist_id.', 404)
  const venue = await staffVenue(ctx, t.venue_id)
  const day = dayOf(venue, date)
  const res = await callApi(ctx, 'GET', `/api/checklists/instance?template_id=${t.id}&date=${day}`)
  const values = res.item_values || {}
  const items = res.items || []
  const ticked = new Set(items.filter(i => values[i.id]?.checked).map(i => i.id))
  return { template: res.template, venue, date: day, items, instance: res.instance, values, ticked }
}

/** Which tasks a tick / untick changes, and the ticks after it. */
function tickPlan(c, { tasks = [], all, untick }) {
  if (!c.items.length) throw new ToolError(c.template.name + ' has no tasks yet.', 422)
  if (!all && !tasks.length) throw new ToolError('Say which tasks, or set all.', 422)
  const picked = all ? c.items : tasks.map(t => pickByName(c.items, t, i => i.label, 'task on ' + c.template.name))
  const changed = picked.filter((i, n) => picked.indexOf(i) === n && c.ticked.has(i.id) === !!untick)
  if (!changed.length) {
    throw new ToolError(all
      ? (untick ? 'Nothing is ticked yet.' : 'Every task is already ticked: the checklist is done.')
      : (untick ? 'Those tasks aren\'t ticked.' : 'Those tasks are already ticked.'), 409)
  }
  const next = new Set(c.ticked)
  for (const i of changed) untick ? next.delete(i.id) : next.add(i.id)
  return { changed, next }
}

async function actionPlan(ctx, input) {
  const venue = await staffVenue(ctx, input.venue_id)
  let category = null
  if (input.category) {
    const cats = await callApi(ctx, 'GET', '/api/hs-action-log/categories')
    category = pickByName(cats || [], input.category, c => c.name, 'category')
  }
  return { venue, category }
}

async function loadAction(ctx, id) {
  const [a] = await sql`
    SELECT l.id, l.task, l.is_completed, v.name AS venue_name, c.name AS category_name
      FROM hs_action_log l
      JOIN venues v ON v.id = l.venue_id AND v.tenant_id = l.tenant_id
      LEFT JOIN hs_action_categories c ON c.id = l.category_id
     WHERE l.id = ${id} AND l.tenant_id = ${ctx.tenantId}
  `
  if (!a) throw new ToolError('Action not found. Use list_hs_actions for the action_id.', 404)
  return a
}
