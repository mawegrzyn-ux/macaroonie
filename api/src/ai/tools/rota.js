// src/ai/tools/rota.js
//
// Staff and rota tools for Pepper (the staff assistant and the staff MCP
// connector). What they cover, and the permission each needs (the same
// modules as the Staff, Rota and Rota setup pages):
//
//   list_staff            a venue's staff, roles, pay, leaving dates     staff, view
//   whos_working          a day's rota: working, time off, away          rota, view
//   rota_week             a week's rota per person, with hours           rota, view
//   set_rota              put people on, take them off, mark sick /
//                         holiday, for days in one week                  rota, manage
//   copy_rota_week        copy another week's worked shifts              rota, manage
//   rota_pay              a week's hours and pay per person              rota_pay, view
//   rota_tips             a week's tip pots, points and shares           rota_tips, view
//   add_pay_adjustment    extra pay, a deduction or a cash advance       rota_pay, manage
//   fill_wages_from_rota  write the week's pay into Cash Recon wages     rota_pay, manage
//   adjust_tips           move, add or take off points or tips           rota_tips, manage
//   set_tip_pot_amounts   this week's amounts for a pot's manual lines   rota_tips, manage
//   add_staff_member      new person at a venue                          staff, manage
//   update_staff_member   role, pay, pay method                          staff, manage
//   set_staff_leaving     last working day (or take it away)             staff, manage
//   add_time_off          a period off the rota (not paid)               staff, manage
//   remove_time_off       remove such a period                           staff, manage
//
// Every read and change goes through the /api/rota routes in-process
// (callApi), so the rules are the Rota page's: the whole-week entries PUT,
// off days from leaving dates and off-rota periods, pay redacted per
// rota_pay / rota_tips (redactWeek). Change tools are confirm tools, plan
// once for the card and again when the person presses Confirm, and are
// audited. Rota maths stays in services/rotaCalc.js; these tools only read
// its figures from GET .../pay (hours on the week view come from span(),
// the same minutes the Rota grid shows).

import { z } from 'zod'
import { withTenant } from '../../config/db.js'
import { ToolError, callApi, requireStaffPermission, staffPermissionLevel, levelAtLeast } from '../context.js'
import { span } from '../../services/rotaCalc.js'
import {
  DateStr, TimeStr, VenueText, venueFor, venueToday, longDate, shortDate, mondayOf, addDays,
  money, plural, pickByName, audited,
} from './util.js'

const hhmm = t => (t ? String(t).slice(0, 5) : null)
const r2 = n => Math.round(Number(n || 0) * 100) / 100

const STATUS_NAME = { on: 'Working', sick: 'Sick', pto: 'Paid time off', uto: 'Unpaid time off', abs: 'Absent' }
const ABSENCES = ['sick', 'pto', 'uto', 'abs']

const PersonText = z.string().trim().min(1).max(200).describe('The person, by name (or their staff id)')
const WeekDate = DateStr.optional().describe('Any date in the week (weeks run Monday to Sunday). Defaults to this week.')

/** The Monday of the week asked for, default this week at the venue. */
const weekOf = (venue, date) => mondayOf(date || venueToday(venue))
const weekText = monday => shortDate(monday) + ' to ' + shortDate(addDays(monday, 6))

const shiftLabel = s => s.name + ' ' + hhmm(s.start_time) + '-' + hhmm(s.end_time)

function minutesOf(entry, shiftById) {
  const s = entry.shift_id ? shiftById.get(entry.shift_id) : null
  const [a, b] = s ? span(s.start_time, s.end_time) : span(entry.start_time, entry.end_time)
  return b - a
}

/** "Lunch" / "10:00-14:00", with the status when it isn't working. */
function entryText(entry, shiftById) {
  const s = entry.shift_id ? shiftById.get(entry.shift_id) : null
  const what = s ? s.name : hhmm(entry.start_time) + '-' + hhmm(entry.end_time)
  const status = entry.status || 'on'
  return status === 'on' ? what : STATUS_NAME[status] + ' (' + what + ')'
}

function awayText(off) {
  if (!off) return null
  if (off.kind === 'left') return 'Left (last day ' + shortDate(off.left_on) + ')' + (off.note ? ': ' + off.note : '')
  return 'Off the rota ' + shortDate(off.from) + ' to ' + shortDate(off.until) + (off.note ? ' (' + off.note + ')' : '')
}

function rateText(s) {
  if (s.default_rate == null) return null
  const amount = money(s.default_rate)
  if (s.pay_type === 'hourly') return amount + ' an hour'
  return amount + ' a ' + (s.pay_basis || 'week')
}

const PAY_METHOD = { cash: 'cash', bank: 'bank transfer', split: 'split (bank, then cash)' }

async function loadWeek(ctx, venue, monday) {
  return callApi(ctx, 'GET', `/api/rota/venues/${venue.id}/weeks/${monday}`)
}

async function loadPay(ctx, venue, monday) {
  return callApi(ctx, 'GET', `/api/rota/venues/${venue.id}/weeks/${monday}/pay`)
}

/** Everyone the week knows about: on it, taken off it, away all week. */
function weekPeople(week) {
  return [
    ...week.staff.map(s => ({ ...s, where: 'on' })),
    ...(week.removed_staff || []).map(s => ({ ...s, where: 'removed' })),
    ...(week.away_staff || []).map(s => ({ ...s, where: 'away' })),
  ]
}

const pickPerson = (people, text) =>
  pickByName(people, text, p => p.name, 'staff member', 'There are no staff at this venue yet (Staff page).')

/** A person of the venue for the staff tools (any, incl. left / inactive). */
async function staffPerson(ctx, venue, text) {
  const staff = await callApi(ctx, 'GET', `/api/rota/venues/${venue.id}/staff`)
  const active = staff.filter(s => s.is_active)
  try {
    return { person: pickPerson(active, text), staff }
  } catch (err) {
    // An inactive person only when nobody active matches.
    if (err.status !== 404) throw err
    return { person: pickPerson(staff, text), staff }
  }
}

// ── set_rota ────────────────────────────────────────────────

const Change = z.object({
  person: PersonText,
  date:   DateStr,
  shift:  z.string().trim().max(100).optional()
    .describe('The shift by name ("Lunch"). With an hourly rota a shift name stands for its times.'),
  start:  TimeStr.optional().describe('Hourly rota: start time (HH:MM)'),
  end:    TimeStr.optional().describe('Hourly rota: end time (HH:MM); before the start means past midnight'),
  status: z.enum(['on', 'off', 'sick', 'pto', 'uto', 'abs']).default('on')
    .describe('on = working. off = take them off (that shift, those times, or the whole day when neither is given). ' +
      'sick, pto (paid time off / holiday), uto (unpaid time off), abs (absent) = mark the day or shift as that.'),
})

const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1]

/** What set_rota will save: the whole week's entries with the changes made. */
async function rotaPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const mondays = [...new Set(input.changes.map(c => mondayOf(c.date)))]
  if (mondays.length > 1) {
    throw new ToolError('One week at a time: these changes cover the weeks of ' + mondays.map(m => shortDate(m)).join(' and ') + '.', 422)
  }
  const monday = mondays[0]
  const week = await loadWeek(ctx, venue, monday)
  const mode = week.settings?.mode || 'day_parts'
  const shiftById = new Map(week.shifts.map(s => [s.id, s]))
  const activeShifts = week.shifts.filter(s => s.is_active)
  const people = weekPeople(week)
  const removedIds = new Set((week.removed_staff || []).map(s => s.id))
  const backOn = new Set()
  const openDates = week.open_dates ? new Set(week.open_dates) : null
  const nameOf = id => people.find(p => p.id === id)?.name ?? 'Unknown'

  let entries = week.entries.map(e => ({
    staff_id: e.staff_id, work_date: e.work_date, shift_id: e.shift_id ?? null,
    start_time: e.shift_id ? null : hhmm(e.start_time), end_time: e.shift_id ? null : hhmm(e.end_time),
    status: e.status || 'on',
  }))
  const lines = []
  const warnings = []
  const pickShift = text => pickByName(activeShifts, text, s => s.name, 'shift', 'No shifts are set up (Rota setup).')
  const spanOf = e => (e.shift_id ? (shiftById.has(e.shift_id) ? span(shiftById.get(e.shift_id).start_time, shiftById.get(e.shift_id).end_time) : null) : span(e.start_time, e.end_time))
  const describeList = list => list.map(e => entryText(e, shiftById)).join(', ')

  for (const c of input.changes) {
    const p = pickPerson(people, c.person)
    const day = shortDate(c.date)
    const who = p.name + ', ' + day + ': '
    const off = p.where === 'away' ? p : p.off_days?.[c.date]
    if (off && c.status !== 'off') {
      throw new ToolError(p.name + ' can\'t be on the rota on ' + day + ': ' + awayText(off) + '. Change that on the Staff page first.', 422)
    }
    let shift = c.shift ? pickShift(c.shift) : null
    if ((c.start && !c.end) || (!c.start && c.end)) throw new ToolError('Give both a start and an end time (' + p.name + ', ' + day + ').', 422)
    if (c.start && c.start === c.end) throw new ToolError('The times for ' + p.name + ' on ' + day + ' have no length.', 422)
    const times = c.start ? span(c.start, c.end) : (shift ? span(shift.start_time, shift.end_time) : null)
    const mine = () => entries.filter(e => e.staff_id === p.id && e.work_date === c.date)

    if (c.status === 'off') {
      const gone = mine().filter(e => {
        if (!shift && !c.start) return true
        if (e.shift_id && shift && !c.start) return e.shift_id === shift.id
        const s = spanOf(e)
        return s && overlaps(s, times)
      })
      if (!gone.length) {
        warnings.push(p.name + ' has nothing on ' + day + (shift ? ' (' + shift.name + ')' : c.start ? ' (' + c.start + '-' + c.end + ')' : '') + ' to take off.')
        continue
      }
      entries = entries.filter(e => !gone.includes(e))
      lines.push(who + 'off (takes off ' + describeList(gone) + ')')
      continue
    }

    if (openDates && !openDates.has(c.date) && c.status === 'on') {
      warnings.push(venue.name + ' is closed on ' + day + ' (booking schedule).')
    }
    if (p.where === 'removed') backOn.add(p.id)

    // No shift or times: mark what they already have that day.
    if (!shift && !c.start) {
      const have = mine()
      const statusWord = c.status === 'on' ? 'working' : STATUS_NAME[c.status].toLowerCase()
      if (have.length) {
        const change = have.filter(e => e.status !== c.status)
        if (!change.length) {
          warnings.push(p.name + ' is already ' + statusWord + ' on ' + day + ' (' + describeList(have) + ').')
          continue
        }
        for (const e of change) e.status = c.status
        lines.push(who + statusWord + ' (' + change.map(e => entryText({ ...e, status: 'on' }, shiftById)).join(', ') + ')')
        continue
      }
      if (mode === 'day_parts' && activeShifts.length === 1) {
        shift = activeShifts[0]                     // one shift a day: that one
      } else if (mode === 'day_parts') {
        throw new ToolError((c.status === 'on' ? 'Which shift for ' + p.name + ' on ' + day + '?'
          : p.name + ' has nothing on ' + day + ' to mark as ' + statusWord + ': which shift were they due to work?') +
          ' Shifts: ' + activeShifts.map(shiftLabel).join(', ') + '.', 422)
      } else {
        throw new ToolError((c.status === 'on' ? 'Give the start and end times for ' + p.name + ' on ' + day
          : p.name + ' has nothing on ' + day + ' to mark as ' + statusWord + ': give the times they were due to work') +
          ' (this rota is by the hour).', 422)
      }
    }

    if (mode === 'day_parts') {
      if (c.start) {
        throw new ToolError('This rota uses shifts, not times: name the shift. Shifts: ' + activeShifts.map(shiftLabel).join(', ') + '.', 422)
      }
      const sh = shift
      const have = mine().find(e => e.shift_id === sh.id)
      if (have) {
        if (have.status === c.status) {
          warnings.push(p.name + ' is already ' + (c.status === 'on' ? 'on ' + sh.name : STATUS_NAME[c.status].toLowerCase() + ' for ' + sh.name) + ' on ' + day + '.')
          continue
        }
        have.status = c.status
      } else {
        entries.push({ staff_id: p.id, work_date: c.date, shift_id: sh.id, start_time: null, end_time: null, status: c.status })
      }
      lines.push(who + (c.status === 'on' ? shiftLabel(sh) : STATUS_NAME[c.status].toLowerCase() + ' (' + sh.name + ')'))
      continue
    }

    // Hourly rota: a period. One that overlaps their other periods that day replaces them.
    const start = c.start || hhmm(shift.start_time)
    const end = c.end || hhmm(shift.end_time)
    const range = span(start, end)
    const same = mine().find(e => !e.shift_id && e.start_time === start && e.end_time === end)
    if (same) {
      if (same.status === c.status) {
        warnings.push(p.name + ' already has ' + start + '-' + end + ' on ' + day + '.')
        continue
      }
      same.status = c.status
    } else {
      const replaced = mine().filter(e => !e.shift_id && overlaps(span(e.start_time, e.end_time), range))
      if (replaced.length) {
        entries = entries.filter(e => !replaced.includes(e))
        warnings.push(p.name + ' on ' + day + ': replaces ' + describeList(replaced) + '.')
      }
      entries.push({ staff_id: p.id, work_date: c.date, shift_id: null, start_time: start, end_time: end, status: c.status })
    }
    lines.push(who + (c.status === 'on' ? start + '-' + end : STATUS_NAME[c.status].toLowerCase() + ' (' + start + '-' + end + ')'))
  }

  for (const id of backOn) warnings.push(nameOf(id) + ' was taken off this week\'s rota and goes back on it.')
  const removed = backOn.size ? [...removedIds].filter(id => !backOn.has(id)) : null
  return { venue, monday, mode, entries, removed, lines, warnings }
}

const entryBody = e => (e.shift_id
  ? { staff_id: e.staff_id, work_date: e.work_date, shift_id: e.shift_id, status: e.status }
  : { staff_id: e.staff_id, work_date: e.work_date, start_time: e.start_time, end_time: e.end_time, status: e.status })

// ── Pay and tips ────────────────────────────────────────────

const ADJUST_KIND = { extra: 'Extra pay', deduction: 'Deduction', advance: 'Cash advance', advance_repay: 'Advance repaid' }

function payRow(r, cur) {
  return {
    name: r.name,
    role: r.role_name ?? null,
    hours: r.hours,
    paid_hours: r.paid_hours,
    days_worked: r.days_worked,
    pay_type: r.pay_type,
    worked_out: money(r.computed_pay, cur),
    ...(r.pay_override != null ? { set_by_hand: money(r.pay_override, cur) } : {}),
    adjustments: (r.adjustments || []).map(a => ADJUST_KIND[a.kind] + ' ' + money(a.amount, cur) + (a.note ? ' (' + a.note + ')' : '')),
    ...(r.carried_owed > 0 ? { owed_from_last_week: money(r.carried_owed, cur) } : {}),
    pay: money(r.pay, cur),
    ...(r.bank_pay > 0 ? { by_bank: money(r.bank_pay, cur) } : {}),
    in_cash: money(r.cash_pay, cur),
    ...(r.pay_shortfall > 0 ? { could_not_take_off: money(r.pay_shortfall, cur) } : {}),
    ...(Object.keys(r.absence_hours || {}).length
      ? { time_off_hours: Object.fromEntries(Object.entries(r.absence_hours).map(([k, h]) => [STATUS_NAME[k] || k, h])) }
      : {}),
  }
}

const POT_SHARE = { house: 'kept by the house', points: 'shared by points', manual: 'shared by hand' }

async function needPayView(ctx, which) {
  const level = await staffPermissionLevel(ctx, which)
  if (levelAtLeast(level, 'view')) return
  const other = which === 'rota_pay' ? 'rota_tips' : 'rota_pay'
  const hint = levelAtLeast(await staffPermissionLevel(ctx, other), 'view')
    ? (which === 'rota_pay' ? ' You can see tips (rota_tips).' : ' You can see pay (rota_pay).')
    : ''
  await requireStaffPermission(ctx, which, 'view').catch(err => {
    throw new ToolError(err.message + hint, err.status)
  })
}

/** Tip move lines: given amounts, else the total split equally (2 dp). */
function tipLines(input, people) {
  const picked = input.to.map(t => ({ person: pickPerson(people, t.person), amount: t.amount }))
  const ids = picked.map(p => p.person.id)
  if (new Set(ids).size !== ids.length) throw new ToolError('Each person can only be picked once.', 422)
  if (picked.every(p => p.amount != null)) return picked.map(p => ({ ...p, amount: r2(p.amount) }))
  if (picked.some(p => p.amount != null)) throw new ToolError('Give an amount for every person, or one total amount to split equally.', 422)
  if (!input.amount) throw new ToolError('How much? Give amount (split equally) or an amount per person.', 422)
  const each = Math.floor((input.amount / picked.length) * 100) / 100
  const rest = r2(input.amount - each * picked.length)
  return picked.map((p, i) => ({ ...p, amount: r2(each + (i === 0 ? rest : 0)) }))
}

const unitText = (kind, n, cur) => (kind === 'money' ? money(n, cur) + ' in tips' : plural(r2(n), 'point'))

export const rotaTools = [
  {
    name: 'list_staff',
    section: 'rota',
    title: 'List staff',
    description:
      'A venue\'s staff: role, how they are paid (rate, hourly or fixed, cash / bank), leaving date and periods off the rota. ' +
      'People who left or were switched off are listed separately.',
    input: z.object({ venue: VenueText }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'staff', 'view')
      const venue = await venueFor(ctx, input.venue)
      const today = venueToday(venue)
      const staff = await callApi(ctx, 'GET', `/api/rota/venues/${venue.id}/staff`)
      const view = s => ({
        name: s.name,
        role: s.role_name ?? null,
        pay: rateText(s),
        paid_by: PAY_METHOD[s.pay_method] || s.pay_method,
        ...(s.pay_method === 'split' && s.bank_amount != null ? { by_bank_each_week: money(s.bank_amount, venue.currency) } : {}),
        ...(s.left_on ? { last_working_day: shortDate(s.left_on) + (s.left_note ? ' (' + s.left_note + ')' : '') } : {}),
        ...((s.off_periods || []).filter(p => p.to_date >= today).length
          ? { off_the_rota: s.off_periods.filter(p => p.to_date >= today).map(p => shortDate(p.from_date) + ' to ' + shortDate(p.to_date) + (p.note ? ' (' + p.note + ')' : '')) }
          : {}),
      })
      const current = staff.filter(s => s.is_active && !(s.left_on && s.left_on < today))
      const gone = staff.filter(s => !current.includes(s))
      return {
        venue: venue.name,
        staff: current.map(view),
        ...(gone.length ? { left_or_switched_off: gone.map(s => s.name + (s.left_on ? ' (left ' + shortDate(s.left_on) + ')' : ' (switched off)')) } : {}),
      }
    },
  },

  {
    name: 'whos_working',
    section: 'rota',
    title: 'Who\'s working',
    description:
      'Who is on the rota on a day (default today): working with their shifts or times and hours, who is sick or on time off, ' +
      'and who is away (left, or a period off the rota). Says when the venue is closed that day.',
    input: z.object({ venue: VenueText, date: DateStr.optional().describe('Defaults to today at the venue') }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'rota', 'view')
      const venue = await venueFor(ctx, input.venue)
      const date = input.date || venueToday(venue)
      const week = await loadWeek(ctx, venue, mondayOf(date))
      const shiftById = new Map(week.shifts.map(s => [s.id, s]))
      const byPerson = new Map()
      for (const e of week.entries.filter(e => e.work_date === date)) {
        if (!byPerson.has(e.staff_id)) byPerson.set(e.staff_id, [])
        byPerson.get(e.staff_id).push(e)
      }
      const working = [], timeOff = []
      for (const s of week.staff) {
        const list = byPerson.get(s.id) || []
        const on = list.filter(e => (e.status || 'on') === 'on')
        const off = list.filter(e => (e.status || 'on') !== 'on')
        if (on.length) {
          working.push({
            name: s.name, role: s.role_name ?? null,
            times: on.map(e => {
              const sh = e.shift_id ? shiftById.get(e.shift_id) : null
              return sh ? shiftLabel(sh) : hhmm(e.start_time) + '-' + hhmm(e.end_time)
            }).join(', '),
            hours: r2(on.reduce((m, e) => m + minutesOf(e, shiftById), 0) / 60),
          })
        }
        if (off.length) timeOff.push({ name: s.name, what: off.map(e => entryText(e, shiftById)).join(', ') })
      }
      const away = [
        ...week.staff.filter(s => s.off_days?.[date]).map(s => ({ name: s.name, why: awayText(s.off_days[date]) })),
        ...(week.away_staff || []).map(s => ({ name: s.name, why: awayText(s) })),
      ]
      return {
        venue: venue.name,
        date, day: longDate(date),
        ...(week.open_dates ? { open: week.open_dates.includes(date) } : {}),
        working,
        hours_total: r2(working.reduce((h, w) => h + w.hours, 0)),
        ...(timeOff.length ? { time_off: timeOff } : {}),
        ...(away.length ? { away } : {}),
        ...(!working.length ? { note: 'Nobody is working on this day on the rota.' } : {}),
      }
    },
  },

  {
    name: 'rota_week',
    section: 'rota',
    title: 'Rota for a week',
    description:
      'A venue\'s rota for a week (Monday to Sunday): each person\'s shifts or times per day with sickness and time off, ' +
      'their worked hours, the shifts set up, closed days, and who is off the rota that week.',
    input: z.object({ venue: VenueText, week: WeekDate }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'rota', 'view')
      const venue = await venueFor(ctx, input.venue)
      const monday = weekOf(venue, input.week)
      const week = await loadWeek(ctx, venue, monday)
      const shiftById = new Map(week.shifts.map(s => [s.id, s]))
      const people = week.staff.map(s => {
        const mine = week.entries.filter(e => e.staff_id === s.id)
        const days = {}
        for (const d of week.dates) {
          const list = mine.filter(e => e.work_date === d)
          if (list.length) days[shortDate(d)] = list.map(e => entryText(e, shiftById)).join(', ')
          else if (s.off_days?.[d]) days[shortDate(d)] = s.off_days[d].kind === 'left' ? 'Left' : 'Off the rota'
        }
        const worked = mine.filter(e => (e.status || 'on') === 'on')
        return { name: s.name, role: s.role_name ?? null, hours: r2(worked.reduce((m, e) => m + minutesOf(e, shiftById), 0) / 60), days }
      })
      const closed = week.open_dates ? week.dates.filter(d => !week.open_dates.includes(d)).map(shortDate) : []
      return {
        venue: venue.name,
        week_start: monday,
        week: weekText(monday),
        rota_by: week.settings?.mode === 'hourly' ? 'hours (start and end times)' : 'shifts',
        shifts: week.shifts.filter(s => s.is_active).map(shiftLabel),
        ...(closed.length ? { closed_days: closed } : {}),
        people,
        hours_total: r2(people.reduce((h, p) => h + p.hours, 0)),
        ...((week.removed_staff || []).length ? { taken_off_this_week: week.removed_staff.map(s => s.name) } : {}),
        ...((week.away_staff || []).length ? { away_all_week: week.away_staff.map(s => s.name + ': ' + awayText(s)) } : {}),
      }
    },
  },

  {
    name: 'set_rota',
    section: 'rota',
    title: 'Change the rota',
    description:
      'Puts people on the rota, takes them off, or marks them sick / on paid or unpaid time off / absent, for days in one week ' +
      '(several changes in one call). Shift rotas: name the shift. Hourly rotas: give start and end times (or a shift name for its times); ' +
      'a new period replaces their overlapping ones that day. status off with no shift or times clears the whole day; sick / pto / uto / abs ' +
      'with no shift or times marks what they already have that day. People who left or are in a period off the rota can\'t be put on. ' +
      'For a holiday that should be paid, use status pto; add_time_off takes them off the rota unpaid.',
    input: z.object({
      venue: VenueText,
      changes: z.array(Change).min(1).max(100),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'rota', 'manage')
      const plan = await rotaPlan(ctx, input)
      if (!plan.lines.length) throw new ToolError('Nothing to change: ' + plan.warnings.join(' '), 422)
      return {
        title: 'Change the rota?',
        lines: [plan.venue.name + ', week of ' + weekText(plan.monday), ...plan.lines],
        ...(plan.warnings.length ? { warningTitle: 'Check', warnings: plan.warnings } : {}),
        confirmLabel: 'Save rota',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'rota', 'manage')
      return audited(ctx, 'set_rota', input, async () => {
        const plan = await rotaPlan(ctx, input)
        if (!plan.lines.length) throw new ToolError('Nothing to change: ' + plan.warnings.join(' '), 422)
        const body = { entries: plan.entries.map(entryBody), ...(plan.removed ? { removed_staff_ids: plan.removed } : {}) }
        const res = await callApi(ctx, 'PUT', `/api/rota/venues/${plan.venue.id}/weeks/${plan.monday}/entries`, { body })
        return { venue: plan.venue.name, week: weekText(plan.monday), changes: plan.lines, entries_on_the_week: res.saved, message: 'Rota saved.' }
      })
    },
  },

  {
    name: 'copy_rota_week',
    section: 'rota',
    title: 'Copy a week\'s rota',
    description:
      'Copies the shifts people worked in one week onto another week (default: last week onto this week), replacing everything on ' +
      'the target week. Sickness and time off aren\'t copied; nobody lands on a day they are off the rota.',
    input: z.object({
      venue: VenueText,
      week: WeekDate.describe('Any date in the week to fill. Defaults to this week.'),
      from_week: DateStr.optional().describe('Any date in the week to copy from. Defaults to the week before.'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'rota', 'manage')
      const p = await copyPlan(ctx, input)
      return {
        title: 'Copy the rota?',
        lines: [
          p.venue.name,
          'From the week of ' + weekText(p.from) + ' (' + plural(p.worked, 'shift') + ' worked)',
          'Onto the week of ' + weekText(p.to),
        ],
        ...(p.existing ? {
          warningTitle: 'Replaces this week',
          warnings: ['The week of ' + weekText(p.to) + ' already has ' + plural(p.existing, 'entry', 'entries') + ' (incl. sickness and time off); they are replaced.'],
        } : {}),
        confirmLabel: 'Copy rota',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'rota', 'manage')
      return audited(ctx, 'copy_rota_week', input, async () => {
        const p = await copyPlan(ctx, input)
        const res = await callApi(ctx, 'POST', `/api/rota/venues/${p.venue.id}/weeks/${p.to}/copy`, { body: { from_week: p.from } })
        return {
          venue: p.venue.name, week: weekText(p.to), copied: res.copied,
          ...(res.skipped ? { skipped: res.skipped + ' (people off the rota that week)' } : {}),
          message: 'Rota copied.',
        }
      })
    },
  },

  {
    name: 'rota_pay',
    section: 'rota',
    title: 'Rota pay for a week',
    description:
      'A week\'s hours and pay per person from the rota: worked and paid hours, pay worked out, pay set by hand, adjustments ' +
      '(extra, deductions, advances), owed from last week, the total, and how much goes by bank and in cash.',
    input: z.object({ venue: VenueText, week: WeekDate }),
    readOnly: true,
    async run(ctx, input) {
      await needPayView(ctx, 'rota_pay')
      const venue = await venueFor(ctx, input.venue)
      const monday = weekOf(venue, input.week)
      const pay = await loadPay(ctx, venue, monday)
      const cur = venue.currency
      const rows = pay.rows.filter(r => r.entry_count > 0 || r.pay > 0 || (r.adjustments || []).length)
      return {
        venue: venue.name,
        week: weekText(monday),
        people: rows.map(r => payRow(r, cur)),
        totals: {
          hours: pay.totals.hours, paid_hours: pay.totals.paid_hours,
          pay: money(pay.totals.pay, cur), by_bank: money(pay.totals.pay_bank, cur), in_cash: money(pay.totals.pay_cash, cur),
        },
        ...(pay.rows.length > rows.length ? { not_working: pay.rows.filter(r => !rows.includes(r)).map(r => r.name) } : {}),
      }
    },
  },

  {
    name: 'rota_tips',
    section: 'rota',
    title: 'Tips for a week',
    description:
      'A week\'s tips: each tip pot (what came in, surcharges, what is shared and how it is paid out), each person\'s points and ' +
      'tip share and how much is paid in cash or by bank, tip moves, and what is unallocated or carries to next week.',
    input: z.object({ venue: VenueText, week: WeekDate }),
    readOnly: true,
    async run(ctx, input) {
      await needPayView(ctx, 'rota_tips')
      const venue = await venueFor(ctx, input.venue)
      const monday = weekOf(venue, input.week)
      const w = await loadPay(ctx, venue, monday)
      const cur = venue.currency
      const t = w.totals
      return {
        venue: venue.name,
        week: weekText(monday),
        pots: w.pots.map(p => ({
          name: p.name,
          how: POT_SHARE[p.distribution] || p.distribution,
          came_in: money(p.gross, cur),
          ...(p.surcharge ? { surcharges: money(p.surcharge, cur) } : {}),
          to_share: money(p.total, cur),
          paid: (p.payout_method === 'bank' ? 'by bank' : 'in cash') + (p.payout_to === 'people' ? ' to ' + ((p.payees || []).map(x => x.name).join(', ') || 'nobody picked yet') : ' as shares'),
        })),
        people: w.rows.filter(r => r.tip_share > 0 || r.points > 0).map(r => ({
          name: r.name,
          points: r.points,
          tip_share: money(r.tip_share, cur),
          ...(r.tip_bank ? { by_bank: money(r.tip_bank, cur) } : {}),
          ...(r.tip_cash ? { in_cash: money(r.tip_cash, cur) } : {}),
        })),
        moves: (w.moves || []).map(m => (m.action === 'move' ? 'Moved ' : m.action === 'add' ? 'Added ' : 'Took off ') +
          unitText(m.kind, m.total, cur) + (m.from_name ? ' from ' + m.from_name : '') + ' ' +
          (m.action === 'remove' ? 'from ' : 'to ') + m.lines.map(l => l.name).join(', ') + (m.note ? ' (' + m.note + ')' : '')),
        totals: {
          tips_in: money(t.tips_in, cur),
          shared: money(t.tips_shared, cur),
          ...(t.kept_by_house ? { kept_by_house: money(t.kept_by_house, cur) } : {}),
          in_cash: money(t.tips_cash, cur),
          by_bank: money(t.tips_bank, cur),
          ...(t.tips_carried_in ? { carried_in_from_earlier_weeks: money(t.tips_carried_in, cur) } : {}),
          ...(t.tips_carry_out ? { unallocated_carries_to_next_week: money(t.tips_carry_out, cur) } : {}),
        },
      }
    },
  },

  {
    name: 'add_pay_adjustment',
    section: 'rota',
    title: 'Add a pay adjustment',
    description:
      'Adds extra pay, a deduction, or a cash advance to a person\'s pay for a week (default this week). An advance is given ' +
      'this week and comes off next week\'s pay by itself. Pay never goes below zero.',
    input: z.object({
      venue: VenueText,
      week: WeekDate,
      person: PersonText,
      kind: z.enum(['extra', 'deduction', 'advance']),
      amount: z.number().positive().max(100000).describe('In pounds'),
      note: z.string().trim().max(500).optional().describe('What it is for'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'rota_pay', 'manage')
      const p = await adjustPlan(ctx, input)
      const cur = p.venue.currency
      const lines = [
        p.person.name + ', week of ' + weekText(p.monday),
        ADJUST_KIND[input.kind] + ': ' + money(input.amount, cur) + (input.note ? ' (' + input.note + ')' : ''),
        ...(p.row ? ['Pay this week: ' + money(p.row.pay, cur) + ' → ' + money(p.newPay, cur)] : []),
        ...(input.kind === 'advance' ? [money(input.amount, cur) + ' comes off the pay for the week of ' + weekText(addDays(p.monday, 7))] : []),
      ]
      const warnings = [
        ...(!p.row ? [p.person.name + ' isn\'t on this week\'s pay.'] : []),
        ...(p.short > 0 ? [money(p.short, cur) + ' of it can\'t come off: pay doesn\'t go below ' + money(0, cur) + '.'] : []),
        ...(p.filled ? ['This week\'s Cash Recon wages already list ' + p.person.name + ': fill wages from the rota again to update them.'] : []),
      ]
      return {
        title: 'Add this pay adjustment?',
        lines,
        ...(warnings.length ? { warningTitle: 'Check', warnings } : {}),
        confirmLabel: 'Add',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'rota_pay', 'manage')
      return audited(ctx, 'add_pay_adjustment', input, async () => {
        const p = await adjustPlan(ctx, input)
        const w = await callApi(ctx, 'POST', `/api/rota/venues/${p.venue.id}/weeks/${p.monday}/pay-adjustments`, {
          body: { staff_id: p.person.id, kind: input.kind, amount: input.amount, note: input.note ?? null },
        })
        const row = w.rows.find(r => r.staff_id === p.person.id)
        return {
          person: p.person.name, week: weekText(p.monday),
          ...(row ? { pay_now: money(row.pay, p.venue.currency) } : {}),
          message: 'Added.' + (p.filled ? ' Fill wages from the rota again to update Cash Recon.' : ''),
        }
      })
    },
  },

  {
    name: 'fill_wages_from_rota',
    section: 'rota',
    title: 'Fill wages from the rota',
    description:
      'Writes each rostered person\'s pay for the week into the Cash Recon wages (same as Fill Cash Recon wages on the Rota page). ' +
      'People already on the wages keep their row; anyone paid in full stays paid in full at the new amount.',
    input: z.object({ venue: VenueText, week: WeekDate }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'rota_pay', 'manage')
      const p = await fillPlan(ctx, input)
      const cur = p.venue.currency
      return {
        title: 'Fill Cash Recon wages?',
        lines: [
          p.venue.name + ', week of ' + weekText(p.monday),
          ...p.rows.map(r => r.name + ': ' + money(r.pay, cur) + (r.bank_pay > 0 ? ' (bank ' + money(r.bank_pay, cur) + ', cash ' + money(r.cash_pay, cur) + ')' : '')),
          'Total: ' + money(p.total, cur),
        ],
        ...(p.existing ? {
          warningTitle: 'Updates the wages',
          warnings: [plural(p.existing, 'person', 'people') + ' already on this week\'s wages get the new amounts. Paid ticks are kept.'],
        } : {}),
        confirmLabel: 'Fill wages',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'rota_pay', 'manage')
      return audited(ctx, 'fill_wages_from_rota', input, async () => {
        const p = await fillPlan(ctx, input)
        const res = await callApi(ctx, 'POST', `/api/rota/venues/${p.venue.id}/weeks/${p.monday}/fill-wages`, { body: {} })
        return {
          venue: p.venue.name, week: weekText(p.monday), added: res.added, updated: res.updated,
          total_pay: money(res.total_pay, p.venue.currency), message: 'Wages filled.',
        }
      })
    },
  },

  {
    name: 'adjust_tips',
    section: 'rota',
    title: 'Move or adjust tips',
    description:
      'For a week\'s tips: move points or tips (£) from one person to others, add some to people (a bonus), or take some off them. ' +
      'Give one total to split equally, or an amount per person. A note is needed for add and remove.',
    input: z.object({
      venue: VenueText,
      week: WeekDate,
      kind: z.enum(['points', 'money']).describe('points, or money (£ of tips)'),
      action: z.enum(['move', 'add', 'remove']).default('move'),
      from: PersonText.optional().describe('Move only: who gives'),
      to: z.array(z.object({ person: PersonText, amount: z.number().positive().max(100000).optional() })).min(1).max(30)
        .describe('Who gets it (add, move) or loses it (remove), optionally each with an amount'),
      amount: z.number().positive().max(100000).optional().describe('A total split equally between them'),
      note: z.string().trim().max(300).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'rota_tips', 'manage')
      const p = await tipPlan(ctx, input)
      const cur = p.venue.currency
      const verb = input.action === 'move' ? 'Move ' : input.action === 'add' ? 'Add ' : 'Take off '
      return {
        title: verb + (input.kind === 'money' ? 'tips' : 'points') + '?',
        lines: [
          p.venue.name + ', week of ' + weekText(p.monday),
          verb + unitText(input.kind, p.total, cur) + (p.from ? ' from ' + p.from.name : ''),
          ...p.lines.map(l => (input.action === 'remove' ? 'From ' : 'To ') + l.person.name + ': ' + unitText(input.kind, l.amount, cur)),
          ...(input.note ? ['Note: ' + input.note] : []),
        ],
        confirmLabel: 'Save',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'rota_tips', 'manage')
      return audited(ctx, 'adjust_tips', input, async () => {
        const p = await tipPlan(ctx, input)
        const w = await callApi(ctx, 'POST', `/api/rota/venues/${p.venue.id}/weeks/${p.monday}/tip-moves`, {
          body: {
            kind: input.kind, action: input.action,
            ...(input.action === 'move' ? { from_staff_id: p.from.id } : {}),
            lines: p.lines.map(l => ({ to_staff_id: l.person.id, amount: l.amount })),
            note: input.note ?? null,
          },
        })
        const touched = new Set([p.from?.id, ...p.lines.map(l => l.person.id)].filter(Boolean))
        return {
          week: weekText(p.monday),
          now: w.rows.filter(r => touched.has(r.staff_id)).map(r => r.name + ': ' +
            (input.kind === 'money' ? money(r.tip_share, p.venue.currency) : plural(r.points, 'point'))),
          message: 'Saved.',
        }
      })
    },
  },

  {
    name: 'set_tip_pot_amounts',
    section: 'rota',
    title: 'Enter tip pot amounts',
    description:
      'Enters a week\'s amounts for tip pots\' manual lines (e.g. cash tips counted, a card tips figure): £ for amount lines, ' +
      '% for percent lines, negative to take some off. null clears a line for the week. Lines are named "Line" or "Pot: Line".',
    input: z.object({
      venue: VenueText,
      week: WeekDate,
      lines: z.array(z.object({
        line: z.string().trim().min(1).max(200),
        amount: z.number().min(-1000000).max(1000000).nullable(),
      })).min(1).max(50),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'rota_tips', 'manage')
      const p = await potLinePlan(ctx, input)
      return {
        title: 'Enter these tip amounts?',
        lines: [p.venue.name + ', week of ' + weekText(p.monday), ...p.rows.map(r => r.text)],
        confirmLabel: 'Save',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'rota_tips', 'manage')
      return audited(ctx, 'set_tip_pot_amounts', input, async () => {
        const p = await potLinePlan(ctx, input)
        const w = await callApi(ctx, 'PUT', `/api/rota/venues/${p.venue.id}/weeks/${p.monday}/pot-lines`, {
          body: { amounts: p.rows.map(r => ({ line_id: r.line.id, amount: r.amount })) },
        })
        return {
          week: weekText(p.monday),
          pots: w.pots.map(x => x.name + ': ' + money(x.total, p.venue.currency) + ' to share'),
          message: 'Saved.',
        }
      })
    },
  },

  {
    name: 'add_staff_member',
    section: 'rota',
    title: 'Add a staff member',
    description:
      'Adds a person to a venue\'s staff: role, pay (hourly rate, or a fixed amount a week, day or shift) and how they are paid ' +
      '(cash, bank transfer, or split with a fixed amount by bank each week).',
    input: z.object({
      venue: VenueText,
      name: z.string().trim().min(1).max(200),
      role: z.string().trim().max(100).optional().describe('Role by name (Rota setup roles)'),
      pay_type: z.enum(['hourly', 'fixed']).default('hourly'),
      pay_basis: z.enum(['week', 'day', 'shift']).default('week').describe('Fixed pay only: an amount a week, a day or a shift'),
      rate: z.number().min(0).max(100000).optional().describe('£ an hour (hourly), or the fixed amount'),
      pay_method: z.enum(['cash', 'bank', 'split']).default('cash'),
      bank_amount: z.number().min(0).max(100000).optional().describe('Split only: paid by bank each week, the rest in cash'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'staff', 'manage')
      const p = await newStaffPlan(ctx, input)
      return {
        title: 'Add ' + input.name + '?',
        lines: p.lines,
        ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: 'Add',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'staff', 'manage')
      return audited(ctx, 'add_staff_member', input, async () => {
        const p = await newStaffPlan(ctx, input)
        const row = await callApi(ctx, 'POST', `/api/rota/venues/${p.venue.id}/staff`, { body: p.body })
        return { staff_id: row.id, name: input.name, venue: p.venue.name, message: 'Added to the staff.' }
      })
    },
  },

  {
    name: 'update_staff_member',
    section: 'rota',
    title: 'Change a staff member',
    description:
      'Changes a person\'s name, role, pay (hourly or fixed, rate) or how they are paid. Only what is given changes. ' +
      'For someone leaving use set_staff_leaving.',
    input: z.object({
      venue: VenueText,
      person: PersonText,
      name: z.string().trim().min(1).max(200).optional(),
      role: z.string().trim().max(100).nullable().optional().describe('Role by name; null for no role'),
      pay_type: z.enum(['hourly', 'fixed']).optional(),
      pay_basis: z.enum(['week', 'day', 'shift']).optional(),
      rate: z.number().min(0).max(100000).nullable().optional(),
      pay_method: z.enum(['cash', 'bank', 'split']).optional(),
      bank_amount: z.number().min(0).max(100000).nullable().optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'staff', 'manage')
      const p = await editStaffPlan(ctx, input)
      return { title: 'Change ' + p.person.name + '?', lines: p.lines, confirmLabel: 'Save' }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'staff', 'manage')
      return audited(ctx, 'update_staff_member', input, async () => {
        const p = await editStaffPlan(ctx, input)
        await callApi(ctx, 'PATCH', `/api/rota/venues/${p.venue.id}/staff/${p.person.id}`, { body: p.body })
        return { name: input.name || p.person.name, changes: p.lines.slice(1), message: 'Saved.' }
      })
    },
  },

  {
    name: 'set_staff_leaving',
    section: 'rota',
    title: 'Set a leaving date',
    description:
      'Sets a person\'s last working day. Their rota entries after it come off the rota and they drop off later weeks; ' +
      'earlier weeks keep them. last_working_day null takes the date away (entries already taken off aren\'t put back).',
    input: z.object({
      venue: VenueText,
      person: PersonText,
      last_working_day: DateStr.nullable(),
      note: z.string().trim().max(500).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'staff', 'manage')
      const p = await leavingPlan(ctx, input)
      const day = input.last_working_day
      return {
        title: day ? 'Set ' + p.person.name + '\'s leaving date?' : 'Take away ' + p.person.name + '\'s leaving date?',
        lines: day
          ? [p.venue.name, 'Last working day: ' + longDate(day), ...(input.note ? ['Note: ' + input.note] : [])]
          : [p.venue.name, 'They go back on the rota for later weeks.', ...(p.person.left_on ? ['Was: ' + longDate(p.person.left_on)] : [])],
        ...(p.entries ? {
          warningTitle: 'Rota entries come off',
          warnings: [plural(p.entries, 'rota entry', 'rota entries') + ' after ' + shortDate(day) + ' come off the rota.'],
        } : {}),
        confirmLabel: 'Save',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'staff', 'manage')
      return audited(ctx, 'set_staff_leaving', input, async () => {
        const p = await leavingPlan(ctx, input)
        const res = await callApi(ctx, 'PUT', `/api/rota/venues/${p.venue.id}/staff/${p.person.id}/leaving`, {
          body: { left_on: input.last_working_day, note: input.note ?? null },
        })
        return { name: p.person.name, last_working_day: res.left_on, rota_entries_removed: res.removed_entries, message: 'Saved.' }
      })
    },
  },

  {
    name: 'add_time_off',
    section: 'rota',
    title: 'Add time off the rota',
    description:
      'Takes a person off the rota for a period (holiday, long sickness, a break), with a note. Their rota entries in it come off. ' +
      'This is not paid: for paid holiday on the rota use set_rota with status pto.',
    input: z.object({
      venue: VenueText,
      person: PersonText,
      from: DateStr,
      to: DateStr,
      note: z.string().trim().max(200).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'staff', 'manage')
      const p = await offPlan(ctx, input)
      return {
        title: 'Take ' + p.person.name + ' off the rota?',
        lines: [p.venue.name, longDate(input.from) + ' to ' + longDate(input.to) + (input.note ? ' (' + input.note + ')' : '')],
        ...(p.entries ? {
          warningTitle: 'Rota entries come off',
          warnings: [plural(p.entries, 'rota entry', 'rota entries') + ' in those days come off the rota.'],
        } : {}),
        confirmLabel: 'Save',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'staff', 'manage')
      return audited(ctx, 'add_time_off', input, async () => {
        const p = await offPlan(ctx, input)
        const res = await callApi(ctx, 'POST', `/api/rota/venues/${p.venue.id}/staff/${p.person.id}/off-periods`, {
          body: { from_date: input.from, to_date: input.to, note: input.note ?? null },
        })
        return { name: p.person.name, from: res.from_date, to: res.to_date, rota_entries_removed: res.removed_entries, message: 'Saved.' }
      })
    },
  },

  {
    name: 'remove_time_off',
    section: 'rota',
    title: 'Remove time off the rota',
    description:
      'Removes one of a person\'s periods off the rota, named by any date in it. Rota entries taken off when it was added aren\'t put back.',
    input: z.object({ venue: VenueText, person: PersonText, date: DateStr.describe('Any date in the period') }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'staff', 'manage')
      const p = await removeOffPlan(ctx, input)
      return {
        title: 'Remove this time off?',
        lines: [p.person.name + ', ' + p.venue.name, longDate(p.period.from_date) + ' to ' + longDate(p.period.to_date) + (p.period.note ? ' (' + p.period.note + ')' : '')],
        warningTitle: 'Not put back',
        warnings: ['Rota entries taken off when it was added aren\'t put back; add them with set_rota.'],
        confirmLabel: 'Remove',
        destructive: true,
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'staff', 'manage')
      return audited(ctx, 'remove_time_off', input, async () => {
        const p = await removeOffPlan(ctx, input)
        await callApi(ctx, 'DELETE', `/api/rota/venues/${p.venue.id}/staff/${p.person.id}/off-periods/${p.period.id}`)
        return { name: p.person.name, removed: p.period.from_date + ' to ' + p.period.to_date, message: 'Removed.' }
      })
    },
  },
]

// ── Plans ───────────────────────────────────────────────────

async function copyPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const to = weekOf(venue, input.week)
  const from = input.from_week ? mondayOf(input.from_week) : addDays(to, -7)
  if (from === to) throw new ToolError('Pick a different week to copy from.', 422)
  const [source, target] = await Promise.all([loadWeek(ctx, venue, from), loadWeek(ctx, venue, to)])
  const worked = source.entries.filter(e => (e.status || 'on') === 'on').length
  if (!worked) throw new ToolError('Nobody worked on the rota in the week of ' + weekText(from) + '.', 422)
  return { venue, from, to, worked, existing: target.entries.length }
}

async function adjustPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const monday = weekOf(venue, input.week)
  const [{ person }, pay] = await Promise.all([staffPerson(ctx, venue, input.person), loadPay(ctx, venue, monday)])
  const row = pay.rows.find(r => r.staff_id === person.id) ?? null
  let newPay = null, short = 0
  if (row && row.pay !== undefined) {
    const raw = row.pay + (input.kind === 'deduction' ? -input.amount : input.amount)
    newPay = r2(Math.max(0, raw))
    short = raw < 0 ? r2(-raw) : 0
  }
  const [filled] = await withTenant(ctx.tenantId, tx => tx`
    SELECT 1 FROM cash_wage_entries e
      JOIN cash_wage_reports r ON r.id = e.wage_report_id AND r.tenant_id = ${ctx.tenantId}
     WHERE e.tenant_id = ${ctx.tenantId} AND r.venue_id = ${venue.id}
       AND r.week_start = ${monday}::date AND e.staff_id = ${person.id}
     LIMIT 1
  `)
  return { venue, monday, person, row: row && row.pay !== undefined ? row : null, newPay, short, filled: !!filled }
}

async function fillPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const monday = weekOf(venue, input.week)
  const pay = await loadPay(ctx, venue, monday)
  const rows = pay.rows.filter(r => r.entry_count > 0 || r.pay_override != null || (r.adjustments || []).length > 0 || r.carried_owed > 0)
  if (!rows.length) throw new ToolError('Nobody is on the rota in the week of ' + weekText(monday) + '.', 422)
  const ids = rows.map(r => r.staff_id)
  const [{ n }] = await withTenant(ctx.tenantId, tx => tx`
    SELECT count(*)::int AS n FROM cash_wage_entries e
      JOIN cash_wage_reports r ON r.id = e.wage_report_id AND r.tenant_id = ${ctx.tenantId}
     WHERE e.tenant_id = ${ctx.tenantId} AND r.venue_id = ${venue.id}
       AND r.week_start = ${monday}::date AND e.staff_id = ANY(${ids}::uuid[])
  `)
  return { venue, monday, rows, total: r2(rows.reduce((s, r) => s + r.pay, 0)), existing: n }
}

async function tipPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const monday = weekOf(venue, input.week)
  const w = await loadPay(ctx, venue, monday)
  const people = w.rows.map(r => ({ id: r.staff_id, name: r.name, points: r.points, tip_share: r.tip_share }))
  const lines = tipLines(input, people)
  const total = r2(lines.reduce((s, l) => s + l.amount, 0))
  const balance = p => (input.kind === 'money' ? p.tip_share : p.points)
  let from = null
  if (input.action === 'move') {
    if (!input.from) throw new ToolError('Who do the ' + (input.kind === 'money' ? 'tips' : 'points') + ' come from?', 422)
    from = pickPerson(people, input.from)
    if (lines.some(l => l.person.id === from.id)) throw new ToolError('Can\'t move to the same person.', 422)
    if (total > balance(from) + 1e-9) throw new ToolError(from.name + ' only has ' + unitText(input.kind, balance(from), venue.currency) + ' this week.', 422)
  } else {
    if (input.from) throw new ToolError('Only a move has someone to take from.', 422)
    if (!input.note) throw new ToolError('Give a reason (note) for adding or taking off ' + (input.kind === 'money' ? 'tips' : 'points') + '.', 422)
  }
  if (input.action === 'remove') {
    const short = lines.find(l => l.amount > balance(l.person) + 1e-9)
    if (short) throw new ToolError(short.person.name + ' only has ' + unitText(input.kind, balance(short.person), venue.currency) + ' this week.', 422)
  }
  return { venue, monday, from, lines, total }
}

async function potLinePlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const monday = weekOf(venue, input.week)
  const [setup, w] = await Promise.all([callApi(ctx, 'GET', '/api/rota/setup'), loadPay(ctx, venue, monday)])
  const all = (setup.pots || []).filter(p => p.is_active).flatMap(p => (p.lines || []).filter(l => l.is_active).map(l => ({ ...l, pot: p.name, full: p.name + ': ' + l.name })))
  const current = new Map()
  for (const pot of w.pots || []) for (const l of pot.lines || []) current.set(l.id, l.amount)
  const rows = input.lines.map(x => {
    const line = /:/.test(x.line)
      ? pickByName(all, x.line, l => l.full, 'tip pot line', 'No tip pots have manual lines (Rota setup).')
      : pickByName(all, x.line, l => l.name, 'tip pot line', 'No tip pots have manual lines (Rota setup).')
    if (x.amount != null && line.kind === 'percent' && (x.amount < -100 || x.amount > 100)) {
      throw new ToolError(line.full + ' is a percentage: give a number between -100 and 100.', 422)
    }
    const fmt = v => (v == null ? 'blank' : line.kind === 'percent' ? v + '%' : money(v, venue.currency))
    const was = current.get(line.id) || null      // 0 = not entered this week
    return { line, amount: x.amount, text: line.full + ': ' + fmt(x.amount) + (was != null && was !== x.amount ? ' (was ' + fmt(was) + ')' : '') }
  })
  if (new Set(rows.map(r => r.line.id)).size !== rows.length) throw new ToolError('A line is named twice.', 422)
  return { venue, monday, rows }
}

async function pickRole(ctx, text) {
  const setup = await callApi(ctx, 'GET', '/api/rota/setup')
  return pickByName((setup.roles || []).filter(r => r.is_active), text, r => r.name, 'role', 'No roles are set up (Staff page, Roles).')
}

function payLines(b, cur) {
  const out = []
  if (b.pay_type === 'hourly') out.push('Pay: ' + (b.default_rate != null ? money(b.default_rate, cur) + ' an hour' : 'hourly, no rate yet'))
  else if (b.pay_type === 'fixed') out.push('Pay: ' + (b.default_rate != null ? money(b.default_rate, cur) + ' a ' + b.pay_basis : 'fixed a ' + b.pay_basis + ', no amount yet'))
  if (b.pay_method) {
    out.push('Paid by: ' + PAY_METHOD[b.pay_method] + (b.pay_method === 'split' && b.bank_amount != null ? ', ' + money(b.bank_amount, cur) + ' by bank each week' : ''))
  }
  return out
}

async function newStaffPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const role = input.role ? await pickRole(ctx, input.role) : null
  if (input.pay_method === 'split' && input.bank_amount == null) throw new ToolError('How much is paid by bank each week (bank_amount)?', 422)
  const body = {
    name: input.name, role_id: role?.id ?? null, pay_type: input.pay_type,
    pay_basis: input.pay_type === 'fixed' ? input.pay_basis : 'week',
    default_rate: input.rate ?? null, pay_method: input.pay_method,
    bank_amount: input.pay_method === 'split' ? input.bank_amount : null,
  }
  const staff = await callApi(ctx, 'GET', `/api/rota/venues/${venue.id}/staff`)
  const same = staff.filter(s => s.name.trim().toLowerCase() === input.name.trim().toLowerCase())
  return {
    venue, body,
    lines: [venue.name, 'Name: ' + input.name, ...(role ? ['Role: ' + role.name] : []), ...payLines(body, venue.currency)],
    warnings: [
      ...(same.length ? [venue.name + ' already has someone called ' + same[0].name + (same[0].is_active ? '' : ' (switched off)') + '.'] : []),
      ...(input.rate == null ? ['No rate: pay works out at ' + money(0, venue.currency) + ' until one is set.'] : []),
    ],
  }
}

async function editStaffPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const { person } = await staffPerson(ctx, venue, input.person)
  const cur = venue.currency
  const body = {}
  const lines = [person.name + ', ' + venue.name]
  if (input.name && input.name !== person.name) { body.name = input.name; lines.push('Name: ' + person.name + ' → ' + input.name) }
  if (input.role !== undefined) {
    const role = input.role ? await pickRole(ctx, input.role) : null
    body.role_id = role?.id ?? null
    lines.push('Role: ' + (person.role_name || 'none') + ' → ' + (role?.name || 'none'))
  }
  const next = {
    pay_type: input.pay_type ?? person.pay_type,
    pay_basis: input.pay_basis ?? person.pay_basis,
    default_rate: input.rate !== undefined ? input.rate : person.default_rate,
    pay_method: input.pay_method ?? person.pay_method,
    bank_amount: input.bank_amount !== undefined ? input.bank_amount : person.bank_amount,
  }
  if (input.pay_type !== undefined) body.pay_type = next.pay_type
  if (input.pay_basis !== undefined) body.pay_basis = next.pay_basis
  if (input.rate !== undefined) body.default_rate = next.default_rate
  if (input.pay_method !== undefined) body.pay_method = next.pay_method
  if (input.bank_amount !== undefined) body.bank_amount = next.bank_amount
  if (next.pay_method === 'split' && next.bank_amount == null) throw new ToolError('How much is paid by bank each week (bank_amount)?', 422)
  if (next.pay_method !== 'split' && input.pay_method !== undefined) body.bank_amount = null
  const payChanged = ['pay_type', 'pay_basis', 'rate'].some(k => input[k] !== undefined)
  const methodChanged = ['pay_method', 'bank_amount'].some(k => input[k] !== undefined)
  if (payChanged) lines.push('Pay: ' + (rateText(person) || 'no rate') + ' → ' + (rateText(next) || 'no rate'))
  if (methodChanged) {
    const was = PAY_METHOD[person.pay_method] + (person.pay_method === 'split' && person.bank_amount != null ? ' (' + money(person.bank_amount, cur) + ' by bank)' : '')
    const now = PAY_METHOD[next.pay_method] + (next.pay_method === 'split' && next.bank_amount != null ? ' (' + money(next.bank_amount, cur) + ' by bank)' : '')
    lines.push('Paid by: ' + was + ' → ' + now)
  }
  if (!Object.keys(body).length) throw new ToolError('Nothing to change.', 422)
  return { venue, person, body, lines }
}

async function leavingPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const { person } = await staffPerson(ctx, venue, input.person)
  if (input.last_working_day == null && !person.left_on) throw new ToolError(person.name + ' has no leaving date.', 422)
  const dry = await callApi(ctx, 'PUT', `/api/rota/venues/${venue.id}/staff/${person.id}/leaving`, {
    body: { left_on: input.last_working_day, note: input.note ?? null, dry_run: true },
  })
  return { venue, person, entries: dry.entries || 0 }
}

async function offPlan(ctx, input) {
  if (input.to < input.from) throw new ToolError('The end date is before the start date.', 422)
  const venue = await venueFor(ctx, input.venue)
  const { person } = await staffPerson(ctx, venue, input.person)
  const dry = await callApi(ctx, 'POST', `/api/rota/venues/${venue.id}/staff/${person.id}/off-periods`, {
    body: { from_date: input.from, to_date: input.to, note: input.note ?? null, dry_run: true },
  })
  return { venue, person, entries: dry.entries || 0 }
}

async function removeOffPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const { person } = await staffPerson(ctx, venue, input.person)
  const period = (person.off_periods || []).find(p => p.from_date <= input.date && p.to_date >= input.date)
  if (!period) {
    const list = (person.off_periods || []).map(p => shortDate(p.from_date) + ' to ' + shortDate(p.to_date))
    throw new ToolError(person.name + ' has no time off the rota on ' + shortDate(input.date) + '.' +
      (list.length ? ' Their periods: ' + list.join(', ') + '.' : ''), 404)
  }
  return { venue, person, period }
}
