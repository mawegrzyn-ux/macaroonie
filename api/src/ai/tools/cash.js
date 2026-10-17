// src/ai/tools/cash.js
//
// Cash reconciliation tools for Pepper (staff assistant and staff MCP).
// Permission: the cash_recon module, like the Cash Recon pages.
//
//   cash_day             a day's income, takings, service charge, expenses,
//                        variance and status                          view
//   cash_week            the week's days and the week's variance         view
//   record_cash_day      enter income / takings / service charge figures
//                        for a day (only the fields named change)       manage
//   add_expense          a petty cash (or card-paid) expense             manage
//   submit_cash_day      submit a day's declaration                      manage
//   wages_week           the week's wages: total, bank, cash paid        view
//   mark_wages_paid      record cash wages handed out                    manage
//   fill_cash_from_till  fill days from Loyverse or GloriaFood           manage
//
// Figures come from the Cash Recon routes: variance is the /week route's
// own per-day figure (Takings + cash paid out of the till - (Income + SC
// adjustment)), never worked out here. Writes go through the routes too:
// the whole-day PUT gets the day as it is with only the named fields
// changed (every expense sent back with its VAT and card flag, the note
// left alone unless one is given), the whole-week wages PUT gets every
// entry back with only the cash paid / paid on changed.

import { z } from 'zod'
import { ToolError, callApi, requireStaffPermission } from '../context.js'
import { splitIncome } from '../../services/reconFill.js'
import {
  DateStr, VenueText, venueFor, venueToday, longDate, shortDate, mondayOf, addDays,
  money, plural, pickByName, audited,
} from './util.js'

const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v)
const r2 = n => Math.round(Number(n || 0) * 100) / 100
const GROUP = { income: 'Income', takings: 'Takings', sc: 'Service charge' }
const STATUS = { draft: 'started, not submitted', submitted: 'submitted' }
const EFFECT = { add: 'added to', subtract: 'taken off', none: null }

const DayDate = DateStr.optional().describe('Defaults to today at the venue')
const WeekDate = DateStr.optional().describe('Any date in the week (Monday to Sunday). Defaults to this week.')

const base = venue => `/api/venues/${venue.id}/cash-recon`

/** The day's Cash Recon fields (active ones), named as on the day view. */
function fieldsOf(config) {
  return [
    ...config.income_sources.filter(s => s.is_active).map(s => ({ group: 'income', id: s.id, name: s.name, source: s })),
    ...config.payment_channels.filter(s => s.is_active).map(s => ({ group: 'takings', id: s.id, name: s.name, source: s })),
    ...config.sc_sources.filter(s => s.is_active).map(s => ({ group: 'sc', id: s.id, name: s.name, source: s })),
  ].map(f => ({ ...f, full: GROUP[f.group] + ': ' + f.name }))
}

function pickField(fields, text) {
  const none = 'No income sources, payment channels or service charge sources are set up (Cash Recon settings).'
  return /:/.test(text)
    ? pickByName(fields, text, f => f.full, 'Cash Recon field', none)
    : pickByName(fields, text, f => f.name, 'Cash Recon field', none)
}

/** The day's saved amount per field: { [id]: amount }. */
function currentAmounts(report) {
  const out = {}
  for (const e of report?.income_entries || []) out[e.source_id] = num(e.gross_amount)
  for (const e of report?.takings_entries || []) out[e.channel_id] = num(e.amount)
  for (const e of report?.sc_entries || []) out[e.source_id] = num(e.amount)
  return out
}

async function dayData(ctx, venue, date) {
  const [config, report, week] = await Promise.all([
    callApi(ctx, 'GET', base(venue) + '/config'),
    callApi(ctx, 'GET', base(venue) + '/daily/' + date),
    callApi(ctx, 'GET', base(venue) + '/week/' + mondayOf(date)),
  ])
  const summary = week.days.find(d => d.date === date) || { date, status: null }
  return { config, report, summary }
}

const varianceText = (v, cur) => (v == null ? null
  : Math.abs(v) < 0.005 ? money(0, cur) + ' (balances)'
    : money(v, cur) + (v > 0 ? ' (more cash than expected)' : ' (short)'))

// ── record_cash_day ─────────────────────────────────────────

async function recordPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const date = input.date || venueToday(venue)
  const { config, report, summary } = await dayData(ctx, venue, date)
  if (report?.status === 'submitted') {
    throw new ToolError(longDate(date) + ' is submitted. An owner or admin has to unsubmit it before it can change.', 422)
  }
  const fields = fieldsOf(config)
  const now = currentAmounts(report)
  const changes = input.figures.map(x => ({ field: pickField(fields, x.field), amount: r2(x.amount) }))
  if (new Set(changes.map(c => c.field.id)).size !== changes.length) throw new ToolError('A field is named twice.', 422)
  const byId = new Map(changes.map(c => [c.field.id, c]))

  // The whole day back to the PUT: saved entries as they are, named fields replaced.
  const income = (report?.income_entries || []).filter(e => !byId.has(e.source_id))
    .map(e => ({ source_id: e.source_id, gross_amount: num(e.gross_amount), vat_amount: num(e.vat_amount), net_amount: num(e.net_amount), notes: e.notes ?? null }))
  const takings = (report?.takings_entries || []).filter(e => !byId.has(e.channel_id))
    .map(e => ({ channel_id: e.channel_id, amount: num(e.amount), notes: e.notes ?? null }))
  const sc = (report?.sc_entries || []).filter(e => !byId.has(e.source_id))
    .map(e => ({ source_id: e.source_id, amount: num(e.amount), notes: e.notes ?? null }))
  const noteOf = (list, key, id) => (list || []).find(e => e[key] === id)?.notes ?? null
  for (const c of changes) {
    const f = c.field
    if (f.group === 'income') {
      const { gross, vat, net } = splitIncome(c.amount, f.source)
      income.push({ source_id: f.id, gross_amount: gross, vat_amount: vat, net_amount: net, notes: noteOf(report?.income_entries, 'source_id', f.id) })
    } else if (f.group === 'takings') {
      takings.push({ channel_id: f.id, amount: c.amount, notes: noteOf(report?.takings_entries, 'channel_id', f.id) })
    } else {
      sc.push({ source_id: f.id, amount: c.amount, notes: noteOf(report?.sc_entries, 'source_id', f.id) })
    }
  }
  const expenses = (report?.expenses || []).map(e => ({
    id: e.id, description: e.description, category: e.category ?? null, category_id: e.category_id ?? null,
    amount: num(e.amount), vat_amount: num(e.vat_amount), paid_by_card: !!e.paid_by_card, notes: e.notes ?? null,
  }))
  const body = { income, takings, sc, expenses, ...(input.note !== undefined ? { notes: input.note || null } : {}) }
  const cur = venue.currency
  const lines = changes.map(c => c.field.full + ': ' + money(c.amount, cur) +
    (now[c.field.id] != null && now[c.field.id] !== c.amount ? ' (was ' + money(now[c.field.id], cur) + ')' : ''))
  if (input.note !== undefined) lines.push('Note: ' + (input.note || '(none)'))
  return { venue, date, body, lines, variance: report ? summary.variance : null }
}

// ── wages ───────────────────────────────────────────────────

function wageView(e, cur) {
  const total = num(e.total), bank = num(e.bank_amount), cash = num(e.cash_amount)
  const due = r2(Math.max(0, total - bank))
  return {
    name: e.name,
    total: money(total, cur),
    ...(bank > 0 ? { by_bank: money(bank, cur) } : {}),
    cash_due: money(due, cur),
    cash_paid: money(cash, cur),
    ...(e.paid_date ? { paid_on: shortDate(e.paid_date) } : {}),
    ...(due - cash > 0.004 ? { still_to_pay: money(due - cash, cur) } : {}),
    ...(e.notes ? { notes: e.notes } : {}),
  }
}

async function wagesPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const monday = mondayOf(input.week || venueToday(venue))
  const report = await callApi(ctx, 'GET', base(venue) + '/wages/' + monday)
  if (!report?.entries?.length) {
    throw new ToolError('The wages for the week of ' + shortDate(monday) + ' haven\'t been saved yet. Fill them from the rota (fill_wages_from_rota) or on the Wages page first.', 422)
  }
  const today = venueToday(venue)
  const paidOn = input.paid_on || (today >= monday && today <= addDays(monday, 6) ? today : null)
  if (!paidOn) throw new ToolError('Which day were they paid (paid_on)? It has to be a day in the week of ' + shortDate(monday) + '.', 422)
  if (paidOn < monday || paidOn > addDays(monday, 6)) throw new ToolError('Paid on has to be a day in the week of ' + shortDate(monday) + '.', 422)
  const everyone = input.people.length === 1 && /^(everyone|all|everybody)$/i.test(input.people[0].trim())
  const picked = everyone
    ? report.entries.filter(e => num(e.total) - num(e.bank_amount) - num(e.cash_amount) > 0.004)
    : input.people.map(n => pickByName(report.entries, n, e => e.name, 'person on this week\'s wages'))
  if (!picked.length) throw new ToolError('Everyone on this week\'s wages is already paid.', 422)
  if (new Set(picked.map(e => e.id)).size !== picked.length) throw new ToolError('A person is named twice.', 422)
  if (input.amount != null && picked.length > 1) throw new ToolError('Give an amount only when marking one person.', 422)
  const cur = venue.currency
  const lines = [], warnings = []
  const changes = new Map()
  for (const e of picked) {
    const due = r2(Math.max(0, num(e.total) - num(e.bank_amount)))
    const amount = input.amount != null ? r2(input.amount) : due
    if (amount > due + 0.004) warnings.push(e.name + ': ' + money(amount, cur) + ' is more than the ' + money(due, cur) + ' due in cash.')
    if (Math.abs(num(e.cash_amount) - amount) < 0.005 && e.paid_date === paidOn) {
      warnings.push(e.name + ' already has ' + money(amount, cur) + ' paid on ' + shortDate(paidOn) + '.')
      continue
    }
    changes.set(e.id, { cash_amount: amount, paid_date: amount > 0 ? paidOn : null })
    lines.push(e.name + ': ' + money(amount, cur) + ' in cash, paid on ' + shortDate(paidOn) +
      (num(e.cash_amount) ? ' (was ' + money(num(e.cash_amount), cur) + ')' : ''))
  }
  if (!changes.size) throw new ToolError('Nothing to change: ' + warnings.join(' '), 422)
  const body = {
    notes: report.notes ?? null,
    entries: report.entries.map(e => ({
      id: e.id, staff_id: e.staff_id ?? null, name: e.name, entry_type: e.entry_type,
      hours: e.hours == null ? null : num(e.hours), rate: e.rate == null ? null : num(e.rate),
      total: num(e.total), bank_amount: num(e.bank_amount),
      cash_amount: changes.has(e.id) ? changes.get(e.id).cash_amount : num(e.cash_amount),
      paid_date: changes.has(e.id) ? changes.get(e.id).paid_date : (e.paid_date ?? null),
      notes: e.notes ?? null,
    })),
  }
  return { venue, monday, paidOn, body, lines, warnings }
}

// ── fill from Loyverse / GloriaFood ─────────────────────────

const SOURCES = { loyverse: 'Loyverse', gloriafood: 'GloriaFood' }

async function fillPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const today = venueToday(venue)
  const from = input.from || today
  const to = input.to || from
  if (to < from) throw new ToolError('The end date is before the start date.', 422)
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1
  if (days > 14) throw new ToolError('Fill up to 14 days at a time.', 422)
  if (to > today) throw new ToolError('Days after today can\'t be filled yet.', 422)
  const preview = await callApi(ctx, 'POST', `/api/${input.source}/venues/${venue.id}/preview`, { body: { from, to } })
  if (!preview.fields.length) {
    throw new ToolError('Nothing is mapped from ' + SOURCES[input.source] + ' yet: map fields in Cash Recon settings > ' + SOURCES[input.source] + '.', 422)
  }
  const cur = preview.currency || venue.currency
  const key = input.source === 'loyverse' ? 'loyverse' : 'source'
  const fill = preview.days.filter(d => d.status !== 'submitted')
  const lines = [], warnings = []
  for (const d of preview.days) {
    if (d.status === 'submitted') { warnings.push(shortDate(d.date) + ' is submitted and is left as it is.'); continue }
    const parts = preview.fields.map(f => {
      const v = d.values[f.key]
      return f.name + ' ' + money(v?.[key] ?? 0, cur) + (v?.current != null && Math.abs(v.current - (v?.[key] ?? 0)) > 0.004 ? ' (now ' + money(v.current, cur) + ')' : '')
    })
    lines.push(shortDate(d.date) + ': ' + parts.join(', '))
    const unmapped = (d.payments || []).filter(p => !p.mapped && p.amount)
    if (unmapped.length) warnings.push(shortDate(d.date) + ': payments not mapped to anything: ' + unmapped.map(p => p.name + ' ' + money(p.amount, cur)).join(', ') + '.')
  }
  if (preview.poll_error) warnings.push('Couldn\'t check GloriaFood for new orders just now: ' + preview.poll_error)
  if (!fill.length) throw new ToolError('Every day asked for is submitted; nothing to fill.', 422)
  return { venue, dates: fill.map(d => d.date), lines, warnings, from, to }
}

export const cashTools = [
  {
    name: 'cash_day',
    section: 'cash',
    title: 'Cash Recon day',
    description:
      'A day\'s cash reconciliation at a venue (default today): status, income per source, takings per payment channel, ' +
      'service charge and how it adjusts the figures, expenses (cash and card), wages paid from the till that day, ' +
      'and the variance (takings + cash paid out - expected; negative = short). Lists fields not entered yet.',
    input: z.object({ venue: VenueText, date: DayDate }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'cash_recon', 'view')
      const venue = await venueFor(ctx, input.venue)
      const date = input.date || venueToday(venue)
      const { config, report, summary } = await dayData(ctx, venue, date)
      const cur = venue.currency
      const amounts = currentAmounts(report)
      const fields = fieldsOf(config)
      const listOf = group => fields.filter(f => f.group === group && amounts[f.id] != null)
        .map(f => ({ name: f.name, amount: money(amounts[f.id], cur),
          ...(group === 'takings' && f.source.counts_as_cash === false ? { not_cash: true } : {}),
          ...(group === 'sc' ? { effect: [EFFECT[f.source.takings_effect] && EFFECT[f.source.takings_effect] + ' takings', EFFECT[f.source.income_effect] && EFFECT[f.source.income_effect] + ' income'].filter(Boolean).join(', ') || 'no effect' } : {}),
        }))
      const expenses = (report?.expenses || []).filter(e => num(e.amount) > 0 || e.receipt_url)
      return {
        venue: venue.name, date, day: longDate(date),
        status: report ? STATUS[report.status] || report.status : 'not started',
        income: listOf('income'),
        takings: listOf('takings'),
        service_charge: listOf('sc'),
        expenses: expenses.map(e => ({
          what: e.description, ...(e.category ? { category: e.category } : {}),
          amount: money(num(e.amount), cur), ...(num(e.vat_amount) ? { vat: money(num(e.vat_amount), cur) } : {}),
          ...(e.paid_by_card ? { paid_by_card: true } : {}),
        })),
        totals: report ? {
          income: money(summary.total_income, cur),
          takings: money(summary.total_takings, cur),
          cash_expenses: money(summary.total_expenses, cur),
          ...(summary.wages_cash ? { wages_paid_from_till: money(summary.wages_cash, cur) } : {}),
          variance: varianceText(summary.variance, cur),
        } : null,
        ...(report?.notes ? { note: report.notes } : {}),
        not_entered: fields.filter(f => amounts[f.id] == null).map(f => f.full),
      }
    },
  },

  {
    name: 'cash_week',
    section: 'cash',
    title: 'Cash Recon week',
    description:
      'A week of cash reconciliation (Monday to Sunday): each day\'s status, income, takings, cash expenses, wages paid ' +
      'from the till and variance, cash wages with no day, and the week\'s variance. Says which days aren\'t started or submitted.',
    input: z.object({ venue: VenueText, week: WeekDate }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'cash_recon', 'view')
      const venue = await venueFor(ctx, input.venue)
      const monday = mondayOf(input.week || venueToday(venue))
      const [week, detail] = await Promise.all([
        callApi(ctx, 'GET', base(venue) + '/week/' + monday),
        callApi(ctx, 'GET', base(venue) + '/week-detail/' + monday),
      ])
      const cur = venue.currency
      const open = detail.open_dates ? new Set(detail.open_dates) : null
      const reported = week.days.filter(d => d.status)
      const sum = k => r2(reported.reduce((s, d) => s + num(d[k]), 0))
      const variance = r2(sum('variance') + num(week.wages.unassigned_cash_wages))
      return {
        venue: venue.name,
        week: shortDate(monday) + ' to ' + shortDate(addDays(monday, 6)),
        days: week.days.map(d => d.status ? {
          day: shortDate(d.date), status: STATUS[d.status] || d.status,
          income: money(d.total_income, cur), takings: money(d.total_takings, cur),
          cash_expenses: money(d.total_expenses, cur),
          ...(d.wages_cash ? { wages_paid: money(d.wages_cash, cur) } : {}),
          variance: varianceText(d.variance, cur),
        } : { day: shortDate(d.date), status: open && !open.has(d.date) ? 'closed' : 'not started' }),
        totals: {
          income: money(sum('total_income'), cur),
          takings: money(sum('total_takings'), cur),
          cash_expenses: money(sum('total_expenses'), cur),
          wages: money(week.wages.total_wages, cur),
          cash_wages: money(week.wages.total_cash_wages, cur),
          ...(num(week.wages.unassigned_cash_wages) ? { cash_wages_with_no_day: money(week.wages.unassigned_cash_wages, cur) } : {}),
          variance: varianceText(variance, cur),
        },
        not_started: week.days.filter(d => !d.status && (!open || open.has(d.date))).map(d => shortDate(d.date)),
        not_submitted: week.days.filter(d => d.status === 'draft').map(d => shortDate(d.date)),
      }
    },
  },

  {
    name: 'record_cash_day',
    section: 'cash',
    title: 'Enter Cash Recon figures',
    description:
      'Enters a day\'s figures (default today): income sources, payment channels (takings) and service charge sources, by name ' +
      '("Card machine", or "Takings: Card" when a name is used twice). Only the fields given change; income is split into net and VAT ' +
      'like the day view. A submitted day can\'t change. note replaces the day\'s note.',
    input: z.object({
      venue: VenueText,
      date: DayDate,
      figures: z.array(z.object({
        field: z.string().trim().min(1).max(200),
        amount: z.number().min(-10000000).max(10000000).describe('In pounds; may be negative (refunds bigger than sales)'),
      })).min(1).max(60),
      note: z.string().max(2000).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'cash_recon', 'manage')
      const p = await recordPlan(ctx, input)
      return {
        title: 'Enter these figures?',
        lines: [p.venue.name + ', ' + longDate(p.date), ...p.lines,
          ...(p.variance != null ? ['Variance now: ' + varianceText(p.variance, p.venue.currency)] : [])],
        confirmLabel: 'Save',
        pin: { date: p.date },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'cash_recon', 'manage')
      return audited(ctx, 'record_cash_day', input, async () => {
        const p = await recordPlan(ctx, input)
        await callApi(ctx, 'PUT', base(p.venue) + '/daily/' + p.date, { body: p.body })
        const week = await callApi(ctx, 'GET', base(p.venue) + '/week/' + mondayOf(p.date))
        const day = week.days.find(d => d.date === p.date)
        return { venue: p.venue.name, date: p.date, saved: p.lines, variance: varianceText(day?.variance, p.venue.currency), message: 'Saved.' }
      })
    },
  },

  {
    name: 'add_expense',
    section: 'cash',
    title: 'Add an expense',
    description:
      'Adds a petty cash expense to a day (default today): what it was, the gross amount, VAT, category, and whether it was paid ' +
      'by card (then it is recorded but not counted as cash out of the till). A submitted day can\'t take more expenses.',
    input: z.object({
      venue: VenueText,
      date: DayDate,
      description: z.string().trim().min(1).max(500),
      amount: z.number().min(0).max(1000000).describe('Gross amount in pounds'),
      vat_amount: z.number().min(0).max(1000000).optional(),
      category: z.string().trim().max(100).optional().describe('Expense category by name'),
      paid_by_card: z.boolean().default(false),
      notes: z.string().max(1000).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'cash_recon', 'manage')
      const p = await expensePlan(ctx, input)
      return {
        title: 'Add this expense?', lines: p.lines, ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: 'Add', pin: { date: p.date },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'cash_recon', 'manage')
      return audited(ctx, 'add_expense', input, async () => {
        const p = await expensePlan(ctx, input)
        const row = await callApi(ctx, 'POST', base(p.venue) + '/expenses', { body: p.body })
        return { expense_id: row.id, date: p.date, amount: money(input.amount, p.venue.currency), message: 'Added.' }
      })
    },
  },

  {
    name: 'submit_cash_day',
    section: 'cash',
    title: 'Submit a Cash Recon day',
    description:
      'Submits a day\'s cash declaration (default today), after which it can\'t change until an owner or admin unsubmits it. ' +
      'The card shows the day\'s totals and variance and what is not entered.',
    input: z.object({ venue: VenueText, date: DayDate }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'cash_recon', 'manage')
      const p = await submitPlan(ctx, input)
      const cur = p.venue.currency
      const warnings = [
        ...(Math.abs(num(p.summary.variance)) >= 0.005 ? ['Variance ' + varianceText(p.summary.variance, cur) + '.'] : []),
        ...(p.missing.length ? ['Not entered: ' + p.missing.join(', ') + '.'] : []),
      ]
      return {
        title: 'Submit ' + shortDate(p.date) + '?',
        lines: [p.venue.name + ', ' + longDate(p.date),
          'Income ' + money(p.summary.total_income, cur) + ', takings ' + money(p.summary.total_takings, cur) +
          ', cash expenses ' + money(p.summary.total_expenses, cur)],
        ...(warnings.length ? { warningTitle: 'Check', warnings } : {}),
        confirmLabel: 'Submit',
        pin: { date: p.date },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'cash_recon', 'manage')
      return audited(ctx, 'submit_cash_day', input, async () => {
        const p = await submitPlan(ctx, input)
        await callApi(ctx, 'POST', base(p.venue) + '/daily/' + p.date + '/submit', { body: {} })
        return { venue: p.venue.name, date: p.date, message: 'Submitted.' }
      })
    },
  },

  {
    name: 'wages_week',
    section: 'cash',
    title: 'Wages for a week',
    description:
      'The week\'s wages from Cash Recon: each person\'s total, the part paid by bank, the cash due, cash paid and the day it was ' +
      'paid, and who still has cash to come.',
    input: z.object({ venue: VenueText, week: WeekDate }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'cash_recon', 'view')
      const venue = await venueFor(ctx, input.venue)
      const monday = mondayOf(input.week || venueToday(venue))
      const report = await callApi(ctx, 'GET', base(venue) + '/wages/' + monday)
      const cur = venue.currency
      const entries = report?.entries || []
      const t = k => r2(entries.reduce((s, e) => s + num(e[k]), 0))
      const due = r2(entries.reduce((s, e) => s + Math.max(0, num(e.total) - num(e.bank_amount)), 0))
      return {
        venue: venue.name,
        week: shortDate(monday) + ' to ' + shortDate(addDays(monday, 6)),
        ...(entries.length ? {} : { note: 'No wages saved for this week yet. fill_wages_from_rota fills them from the rota.' }),
        people: entries.map(e => wageView(e, cur)),
        totals: {
          total: money(t('total'), cur), by_bank: money(t('bank_amount'), cur),
          cash_due: money(due, cur), cash_paid: money(t('cash_amount'), cur),
          still_to_pay: money(Math.max(0, due - t('cash_amount')), cur),
        },
      }
    },
  },

  {
    name: 'mark_wages_paid',
    section: 'cash',
    title: 'Mark wages paid',
    description:
      'Records cash wages handed out for a week: named people (or "everyone" still owed), the cash amount (default: their full ' +
      'cash due) and the day it came out of the till (default today, must be in that week). The day\'s variance then counts it.',
    input: z.object({
      venue: VenueText,
      week: WeekDate,
      people: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
      amount: z.number().min(0).max(100000).optional().describe('Only when marking one person: the cash paid'),
      paid_on: DateStr.optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'cash_recon', 'manage')
      const p = await wagesPlan(ctx, input)
      return {
        title: 'Mark these wages paid?',
        lines: [p.venue.name + ', week of ' + shortDate(p.monday), ...p.lines],
        ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: 'Save',
        pin: { week: p.monday, paid_on: p.paidOn },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'cash_recon', 'manage')
      return audited(ctx, 'mark_wages_paid', input, async () => {
        const p = await wagesPlan(ctx, input)
        await callApi(ctx, 'PUT', base(p.venue) + '/wages/' + p.monday, { body: p.body })
        return { week: shortDate(p.monday), paid: p.lines, message: 'Saved.' }
      })
    },
  },

  {
    name: 'fill_cash_from_till',
    section: 'cash',
    title: 'Fill Cash Recon from Loyverse or GloriaFood',
    description:
      'Fills days of Cash Recon (default today; up to 14 days) from Loyverse or GloriaFood, using the venue\'s field mapping ' +
      '(set up in Cash Recon settings). Only mapped fields change; submitted days are left as they are. The card shows the ' +
      'figures per day and payments not mapped to anything.',
    input: z.object({
      venue: VenueText,
      source: z.enum(['loyverse', 'gloriafood']),
      from: DateStr.optional(),
      to: DateStr.optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'cash_recon', 'manage')
      const p = await fillPlan(ctx, input)
      return {
        title: 'Fill from ' + SOURCES[input.source] + '?',
        lines: [p.venue.name, ...p.lines],
        ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: 'Fill',
        pin: { from: p.from, to: p.to },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'cash_recon', 'manage')
      return audited(ctx, 'fill_cash_from_till', input, async () => {
        const p = await fillPlan(ctx, input)
        const res = await callApi(ctx, 'POST', `/api/${input.source}/venues/${p.venue.id}/apply`, { body: { dates: p.dates } })
        return {
          filled: res.filled.map(shortDate),
          ...(res.skipped?.length ? { skipped: res.skipped.map(s => shortDate(s.date) + ' (' + s.reason + ')') } : {}),
          message: 'Filled ' + plural(res.filled.length, 'day') + '.',
        }
      })
    },
  },
]

async function expensePlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const date = input.date || venueToday(venue)
  const [config, report] = await Promise.all([
    callApi(ctx, 'GET', base(venue) + '/config'),
    callApi(ctx, 'GET', base(venue) + '/daily/' + date),
  ])
  if (report?.status === 'submitted') throw new ToolError(longDate(date) + ' is submitted. An owner or admin has to unsubmit it first.', 422)
  const cats = (config.expense_categories || []).filter(c => c.is_active !== false)
  const category = input.category ? pickByName(cats, input.category, c => c.name, 'expense category', 'No expense categories are set up (Cash Recon settings).') : null
  const cur = venue.currency
  const warnings = []
  if ((input.vat_amount || 0) > input.amount) warnings.push('The VAT is more than the gross amount.')
  return {
    venue, date,
    body: {
      date, description: input.description, category: category?.name ?? null, category_id: category?.id ?? null,
      amount: input.amount, vat_amount: input.vat_amount || 0, paid_by_card: input.paid_by_card, notes: input.notes ?? null,
    },
    lines: [
      venue.name + ', ' + longDate(date),
      input.description + ': ' + money(input.amount, cur) + (input.vat_amount ? ' (VAT ' + money(input.vat_amount, cur) + ')' : ''),
      ...(category ? ['Category: ' + category.name] : []),
      input.paid_by_card ? 'Paid by card: recorded, not counted as cash out of the till' : 'Paid in cash from the till',
      ...(input.notes ? ['Notes: ' + input.notes] : []),
    ],
    warnings,
  }
}

async function submitPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const date = input.date || venueToday(venue)
  const { config, report, summary } = await dayData(ctx, venue, date)
  if (!report) throw new ToolError('Nothing is entered for ' + longDate(date) + ' yet.', 422)
  if (report.status === 'submitted') throw new ToolError(longDate(date) + ' is already submitted.', 422)
  const amounts = currentAmounts(report)
  const missing = fieldsOf(config).filter(f => amounts[f.id] == null).map(f => f.full)
  return { venue, date, summary, missing }
}
