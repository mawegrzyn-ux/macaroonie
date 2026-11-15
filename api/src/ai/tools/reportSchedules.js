// src/ai/tools/reportSchedules.js
//
// Report schedules and sends (docs/REPORTS.md 14 and 16) for Pepper (staff
// assistant and staff MCP). Permissions are the Reports module's:
//
//   schedule_report  email a saved report or a starter on a schedule: days
//                    and a time, the people, what it sends, when it sends
//                    (always, only with rows, only when a figure crosses
//                    a line)                                              reports, use
//   change_schedule  change one: who it goes to, when, the period and
//                    venues, what and when it sends, its title and note   reports, use
//   pause_schedule   pause one (its owner, or Manage), or resume it        reports, view
//                    (resume needs Use)
//   send_report      email a report now to named people, or send a
//                    schedule now whatever its condition                  reports, use
//
// Everything goes through the schedule routes (src/routes/reportSchedules.js)
// with callApi(), as the person, so who may send to whom (other people need
// Manage, addresses outside the team an owner or admin, people's details
// outside the team an owner or admin who asks) is the routes' own. Every card
// is the route's own dry run (`dry_run: true`), so it says exactly what
// Confirm saves or sends, and pins the body it was worked out with. Dry runs
// send nothing and carry no Pepper mark; real sends do (AS_PEPPER), so they
// are recorded as Pepper's and count towards Pepper's runs a minute. The
// audit keeps counts, never an address.
//
// Past runs and what is scheduled are read by report_runs and get_report
// (reports.js), with the helpers this file imports.

import { z } from 'zod'
import { ToolError, callApi, requireStaffPermission, staffPermissionLevel, levelAtLeast, audit } from '../context.js'
import { pickByName } from './util.js'
import { CATALOGUE } from '../../reports/catalogue/index.js'
import { watchable } from '../../reports/send.js'
import { valueName, valueType, storedNumber } from '../../../../shared/reports/build.js'
import { isEmail, WEEKS, OPS, ATTACH, MAX_RECIPIENTS } from '../../../../shared/reports/schedule.js'
import { RELATIVE_PERIODS } from '../../../../shared/reports/period.js'
import {
  loadReport, runParams, linkTo, runsPath, AS_PEPPER, ReportRef, Pinned, PeriodInput, clip, lowerFirst,
  scheduleLine, schedulesPath, whenText, recipientWords, STATUS_WORDS,
} from './reports.js'

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_NUM = Object.fromEntries(WEEKDAYS.map((d, i) => [d, i + 1]))
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Words that mean the person asking.
const ME = new Set(['me', 'myself', 'i', 'my email', 'my inbox', 'my address', 'my own email', 'my own address', 'my email address'])

const enc = encodeURIComponent

// ── Inputs ────────────────────────────────────────────────────

const TimingInput = z.object({
  every: z.enum(['day', 'week', 'month']).describe('day: every day; week: on the days given; month: once a month'),
  days: z.array(z.enum([...WEEKDAYS, 'weekdays', 'weekends'])).min(1).max(9).optional()
    .describe('With every week: the days, monday to sunday, or weekdays / weekends'),
  day_of_month: z.union([z.number().int().min(1).max(31), z.literal('last')]).optional()
    .describe('With every month: 1 to 31 (a shorter month takes its last day), or last'),
  week_of_month: z.enum(WEEKS).optional()
    .describe('With every month, instead of day_of_month: first, second, third, fourth or last, with weekday'),
  weekday: z.enum(WEEKDAYS).optional().describe('With week_of_month: which day, like monday'),
  time: z.string().regex(TIME).optional().describe('HH:MM at the venue, 24-hour (08:00 unless given)'),
})
// A schedule's period must move with the date: fixed days would send the same days every time.
const MovingPeriod = z.object({
  relative: z.enum(RELATIVE_PERIODS),
  n: z.number().int().min(1).max(3660).optional().describe('With last_n_days and next_n_days'),
}).describe('A period that moves with the date, like yesterday, last_week, this_month or last_n_days with n. Leave out to keep the report\'s own')
const Venues = z.array(z.string().trim().min(1).max(120)).max(50).optional()
  .describe('Venue names; leave out to keep the report\'s own')
const Person = z.string().trim().min(1).max(254)
const People = z.array(Person).max(MAX_RECIPIENTS)
const To = People.min(1).describe(
  'Who it goes to: "me", people on the team by name, or email addresses. Sending to other people needs Manage on Reports, ' +
  'and an address outside the team an owner or admin')
const ScheduleRef = z.string().trim().min(1).max(200)
  .describe('The schedule: its report\'s name (with its title or days when there are several), or its id from report_runs or get_report')

const DeliveryFields = {
  in_email: z.boolean().optional().describe('The report in the email itself (yes unless said)'),
  attach: z.enum(ATTACH).optional().describe('A file attached: csv, xlsx (Excel) or none (none unless said)'),
  keep_file: z.boolean().optional()
    .describe('Also keep the attached file in Past runs for the person it sends as (30 days, 7 when it holds people\'s details)'),
}
const ConditionFields = {
  when: z.enum(['always', 'rows', 'figure']).optional()
    .describe('always (every time: the usual), rows (only when the report has rows) or figure (only when a figure crosses a line)'),
  figure: z.string().trim().min(1).max(120).optional().describe('With when figure: the report\'s figure to watch, by its name'),
  op: z.enum(OPS).optional()
    .describe('With when figure: over, at_least, under, at_most, or outside (more than the line either way of 0, like a variance)'),
  than: z.number().optional()
    .describe('With when figure: the line, in everyday units: pounds for money, per cent for a percentage, minutes for a length of time'),
  on: z.enum(['total', 'any']).optional().describe('With when figure: total (the total row) or any (any row: the usual)'),
}
const WordsFields = {
  title: z.string().trim().max(120).optional().describe('The email\'s title (the report\'s name unless given)'),
  message: z.string().trim().max(1000).optional().describe('A short note at the top of the email'),
  peoples_details_outside: z.boolean().optional().describe(
    'Let people\'s details (names, emails, phone numbers) go to addresses outside the team: only when an owner or admin asks for it'),
}

// ── Shared steps ──────────────────────────────────────────────

const cantRun = r => new ToolError('Your role can\'t run "' + r.name + '": it needs ' + (r.needs || 'another area') + '. Ask an owner or admin.', 403)

/** A timing from the tool's words: { every, days | on, time }. */
function timingOf(t, current = null) {
  const time = t.time || current?.time || '08:00'
  if (t.every === 'day') return { every: 'day', time }
  if (t.every === 'week') {
    if (!t.days?.length) throw new ToolError('With every week, give the days it sends: monday to sunday, or weekdays or weekends.', 422)
    const days = new Set()
    for (const d of t.days) {
      if (d === 'weekdays') [1, 2, 3, 4, 5].forEach(n => days.add(n))
      else if (d === 'weekends') [6, 7].forEach(n => days.add(n))
      else days.add(DAY_NUM[d])
    }
    return { every: 'week', days: [...days].sort((a, b) => a - b), time }
  }
  if (t.week_of_month || t.weekday) {
    if (!t.week_of_month || !t.weekday) throw new ToolError('Give week_of_month and weekday together, like first and monday.', 422)
    return { every: 'month', on: { week: t.week_of_month, weekday: DAY_NUM[t.weekday] }, time }
  }
  if (t.day_of_month == null) {
    throw new ToolError('With every month, give day_of_month (1 to 31, or last), or week_of_month and weekday.', 422)
  }
  return { every: 'month', on: { day: t.day_of_month }, time }
}

const NO_DELIVERY = { in_message: true, attach: 'none', keep_file: false }

/** What a send carries, from the tool's words: null when none were given on a change. */
function deliveryOf(input, current = null) {
  const given = input.in_email !== undefined || input.attach !== undefined || input.keep_file !== undefined
  if (!given) return current ? null : { ...NO_DELIVERY }
  const base = current || NO_DELIVERY
  const attach = input.attach ?? base.attach
  if (input.keep_file === true && attach === 'none') {
    throw new ToolError('A file is kept only when one is attached: give attach csv or xlsx too.', 422)
  }
  return {
    in_message: input.in_email ?? base.in_message,
    attach,
    keep_file: attach === 'none' ? false : (input.keep_file ?? base.keep_file),
  }
}

const CONDITION_KEYS = ['when', 'figure', 'op', 'than', 'on']

/**
 * When a schedule sends, from the tool's words: null when none were given.
 * A figure is one of the report's own numeric values, by its name; the line
 * is typed in everyday units and kept as the report keeps the figure.
 */
function conditionFrom(spec, input, current = null) {
  if (!CONDITION_KEYS.some(k => input[k] !== undefined)) return null
  const cur = current || { when: 'always' }
  const figureWords = ['figure', 'op', 'than', 'on'].some(k => input[k] !== undefined)
  const when = input.when || (figureWords ? 'figure' : cur.when)
  if (when !== 'figure') return { when }
  const values = watchable(spec)
  if (spec.kind !== 'summary' || !values.length) {
    throw new ToolError('Only a summary report with figures can send when a figure crosses a line: use when rows (only when there are rows) or always.', 422)
  }
  const name = v => valueName(CATALOGUE, spec, v)
  const was = cur.when === 'figure' ? values.find(v => v.key === cur.value) : null
  const value = input.figure
    ? pickByName(values.map(v => ({ ...v, id: v.key })), input.figure, name, 'figure of this report')
    : was || (values.length === 1 ? values[0] : null)
  if (!value) throw new ToolError('Say which figure to watch: ' + values.map(name).join(', ') + '.', 422)
  let than = null
  if (input.than !== undefined) {
    than = storedNumber(valueType(CATALOGUE, spec, value), String(input.than))
    if (than == null) throw new ToolError('The line (than) must be a number, like 500 for £500, or 12 for 12%.', 422)
  } else if (was && was.key === value.key && cur.than != null) {
    than = cur.than
  } else {
    throw new ToolError('Say the line to compare ' + name(value) + ' with (than), like 500 for £500, or 12 for 12%.', 422)
  }
  return {
    when: 'figure',
    value: value.key,
    op: input.op || (cur.when === 'figure' ? cur.op : null) || 'over',
    than,
    scope: input.on || (cur.when === 'figure' ? cur.scope : null) || 'any',
  }
}

const recipientKey = x => (x.user_id ? 'u:' + x.user_id : 'e:' + x.email)
// As the routes keep a recipient: someone on the team by id, else an address.
const stored = x => (x.user_id ? { user_id: x.user_id } : { email: x.email })
const uniq = list => {
  const seen = new Set()
  return list.filter(x => { const k = recipientKey(x); if (seen.has(k)) return false; seen.add(k); return true })
}

/**
 * People from names, "me" and addresses ({ user_id, name, email }), from
 * GET /api/reports/recipients. A name is someone on the team, which only
 * Manage can list; the routes decide the rest (outside addresses need an
 * owner or admin) and the card's dry run says so.
 */
function recipientsFor(names, who) {
  const team = who.team || []
  const me = who.me
  const out = []
  for (const raw of names) {
    const t = raw.trim()
    const low = t.toLowerCase()
    if (ME.has(low)) {
      if (!me) throw new ToolError('You aren\'t on the group\'s team, so there is no address of yours: give an email address.', 422)
      out.push(me)
    } else if (t.includes('@')) {
      if (!isEmail(t)) throw new ToolError('"' + clip(t, 80) + '" isn\'t an email address.', 422)
      const member = (me && me.email === low ? me : null) || team.find(x => x.email === low)
      out.push(member?.user_id ? member : { user_id: null, name: null, email: low })
    } else if (!who.can_others) {
      if (me && [me.name, me.email].some(v => v && v.toLowerCase() === low)) out.push(me)
      else throw new ToolError('Sending a report to other people needs Manage on Reports. You can send it to yourself (to: ["me"]).', 403)
    } else {
      out.push(pickByName(team.map(x => ({ ...x, id: x.user_id })), t, x => x.name || x.email, 'person on the team',
        'There is nobody on the team with an email address.'))
    }
  }
  return uniq(out)
}

const skippedLine = n => n + (n === 1 ? ' person is' : ' people are') + ' no longer on the team and won\'t get it'
const toLine = list => 'To: ' + (list || []).map(recipientWords).join('; ')
const choiceLines = v => (v.choices || []).map(c => c.label + ': ' + c.text)
const ownerLine = s => 'It is ' + (s.owner_email || 'someone else') + '\'s: it sends what their role can see.'
const titleLine = (v, reportName) => (v.name && v.name !== reportName ? ['Email title: ' + v.name] : [])
const noteLine = v => (v.message ? ['Note in the email: ' + clip(v.message, 200)] : [])
const outsideLine = v => (v.personal_outside ? ['People\'s details (names, emails, phone numbers) go to the addresses outside the team too'] : [])

/** A schedule's card lines: when, its choices, what it sends, when it sends, to whom. */
function scheduleCard(s, { first = false, skipped = 0 } = {}) {
  return [
    'When: ' + s.timing_text + (s.enabled && s.next_run_at
      ? '. ' + (first ? 'The first goes ' : 'Next: ') + whenText(s.next_run_at, s.time_zone) : ''),
    ...choiceLines(s),
    'Sends: ' + s.delivery_text,
    ...(s.condition?.when && s.condition.when !== 'always' ? [s.condition_text] : []),
    toLine(s.recipients),
    ...(skipped ? [skippedLine(skipped)] : []),
    ...titleLine(s, s.report?.name),
    ...noteLine(s),
    ...outsideLine(s),
  ]
}

const scheduleName = s => [s.name && s.name !== s.report?.name ? s.name : null, s.report?.name || 'A report']
  .filter(Boolean).join(': ') + ' (' + lowerFirst(s.timing_text)
  + (s.mine ? '' : ', ' + (s.owner_email || 'someone else') + '\'s') + ')'

/** One schedule the person can see, by its id, or by its report's name or title. */
async function findSchedule(ctx, text) {
  const raw = String(text || '').trim()
  if (UUID.test(raw)) {
    const { schedule } = await callApi(ctx, 'GET', '/api/reports/schedules/' + raw.toLowerCase())
    return schedule
  }
  const manage = levelAtLeast(await staffPermissionLevel(ctx, 'reports'), 'manage')
  const { schedules = [] } = await callApi(ctx, 'GET', '/api/reports/schedules?scope=' + (manage ? 'all' : 'mine'))
  if (!schedules.length) {
    throw new ToolError((manage ? 'There are no schedules yet' : 'You have no schedules yet') + ': schedule_report sets one up.', 404)
  }
  return pickByName(schedules, raw, scheduleName, 'schedule')
}

/** A send's answer in words: how it went and where to see it. */
function sentWords(ctx, reportName, res, link) {
  return {
    report: reportName,
    result: STATUS_WORDS[res.status] || res.status,
    sent_to: res.sent + ' of ' + res.to,
    ...(res.failed ? { failed: res.failed + ' couldn\'t be sent' + (res.error ? ': ' + clip(res.error, 200) : '') } : {}),
    ...(res.held ? { held_back: res.held + ' outside the team got nothing: the report holds people\'s details' } : {}),
    ...(res.kept ? { file: 'The attached file is kept in Past runs for the person it was sent as' } : {}),
    ...linkTo(ctx, 'Past runs', link),
  }
}

// What a send reached, for the audit: counts only, never an address.
const sendCounts = res => ({ status: res.status, to: res.to, sent: res.sent, failed: res.failed, held: res.held, kept: !!res.kept })

// The words of a refusal can name an address (a schedule's owner, an address
// the email service refused): the audit keeps them masked.
export const maskAddresses = s => String(s || '').replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, '[address]')

/** audited() for these tools: the same record, with addresses masked in a refusal. */
async function auditedCounts(ctx, tool, input, fn) {
  try {
    const result = await fn()
    await audit(ctx, { tool, input, ok: true, result })
    return result
  } catch (err) {
    await audit(ctx, { tool, input, ok: false, result: { error: maskAddresses(err.message) } })
    throw err
  }
}

// ── schedule_report ───────────────────────────────────────────

/** A new schedule's body for POST /:id/schedules, from the tool's words. */
async function newScheduleBody(ctx, r, input) {
  const who = await callApi(ctx, 'GET', '/api/reports/recipients')
  return {
    ...(input.title ? { name: input.title } : {}),
    ...(input.message ? { message: input.message } : {}),
    timing: timingOf(input.timing),
    params: await runParams(ctx, r.spec, input),
    delivery: deliveryOf(input),
    condition: conditionFrom(r.spec, input) || { when: 'always' },
    recipients: recipientsFor(input.to, who).map(stored),
    ...(input.peoples_details_outside ? { personal_outside: true } : {}),
  }
}

async function scheduleTarget(ctx, input) {
  await requireStaffPermission(ctx, 'reports', 'use')
  const r = await loadReport(ctx, input.report)
  if (r.runs === false) throw cantRun(r)
  return r
}

// ── change_schedule ───────────────────────────────────────────

// What a change changed, in words, for the audit and Activity (never who it goes to).
const CHANGED_WORDS = {
  recipients: 'who it goes to', timing: 'when', params: 'its choices', delivery: 'what it sends',
  condition: 'when it sends', name: 'the email title', message: 'the note', personal_outside: 'people\'s details outside the team',
}
const changedWords = body => Object.keys(body).map(k => CHANGED_WORDS[k] || k).join(', ')

const CHANGE_KEYS = ['to', 'add_to', 'remove_from', 'timing', 'time', 'period', 'venues', 'in_email', 'attach', 'keep_file',
  ...CONDITION_KEYS, 'title', 'message', 'peoples_details_outside']

// A change with nothing to change: refused on the card and, since the staff
// connector calls run() straight away, in run() too.
function somethingToChange(input) {
  if (!CHANGE_KEYS.some(k => input[k] !== undefined)) {
    throw new ToolError('Say what to change: who it goes to, when, the period or venues, what it sends, when it sends, the title or the note.', 422)
  }
}

/** The PATCH body for a change, from the tool's words: only what changes. */
async function changeBody(ctx, s, input) {
  const body = {}
  const needReport = input.period || input.venues || CONDITION_KEYS.some(k => input[k] !== undefined)
  const r = needReport ? await loadReport(ctx, s.report.id) : null
  if (r && r.runs === false) throw cantRun(r)

  if (input.to || input.add_to?.length || input.remove_from?.length) {
    const who = await callApi(ctx, 'GET', '/api/reports/recipients')
    let list = input.to
      ? recipientsFor(input.to, who)
      : (s.recipients || []).map(x => (x.user_id ? { user_id: x.user_id, name: x.name, email: x.email } : { user_id: null, name: x.name, email: x.email }))
    if (input.add_to?.length) list = uniq([...list, ...recipientsFor(input.add_to, who)])
    for (const raw of input.remove_from || []) {
      const t = raw.trim()
      const low = t.toLowerCase()
      const mine = who.me
      const gone = ME.has(low)
        ? list.find(x => mine && ((x.user_id && x.user_id === mine.user_id) || (x.email && x.email === mine.email)))
        : t.includes('@')
          ? list.find(x => x.email === low)
          : pickByName(list.map((x, i) => ({ ...x, id: 'r' + i })), t, x => x.name || x.email || 'Someone no longer on the team', 'person it goes to')
      if (!gone) throw new ToolError(ME.has(low) ? 'It doesn\'t go to you.' : 'It doesn\'t go to ' + clip(t, 80) + '.', 404)
      list = list.filter(x => recipientKey(x) !== recipientKey(gone))
    }
    if (!list.length) {
      throw new ToolError('That leaves nobody to send it to: pause_schedule stops it, or it can be deleted on the Schedules page.', 422)
    }
    body.recipients = list.map(stored)
  }
  if (input.timing) body.timing = timingOf(input.timing, s.timing)
  else if (input.time) body.timing = { ...s.timing, time: input.time }
  if (input.period || input.venues) body.params = { ...(s.params || {}), ...(await runParams(ctx, r.spec, input)) }
  const delivery = deliveryOf(input, s.delivery)
  if (delivery) body.delivery = delivery
  const condition = r ? conditionFrom(r.spec, input, s.condition) : null
  if (condition) body.condition = condition
  if (input.title !== undefined) body.name = input.title || null
  if (input.message !== undefined) body.message = input.message || null
  if (input.peoples_details_outside !== undefined) body.personal_outside = input.peoples_details_outside
  return body
}

/** What a change changes, before and after, from the route's dry run. */
function changeLines(s, d) {
  const lines = []
  const was = (label, a, b) => { if (a !== b) lines.push(label + ': ' + b + ' (was ' + lowerFirst(a || 'nothing') + ')') }
  was('When', s.timing_text, d.timing_text)
  const ch = v => choiceLines(v).join('; ')
  if (ch(s) !== ch(d)) lines.push('Choices: ' + (ch(d) || 'as the report has them') + (ch(s) ? ' (was ' + ch(s) + ')' : ''))
  was('Sends', s.delivery_text, d.delivery_text)
  was('When it sends', s.condition_text, d.condition_text)
  const to = v => (v.recipients || []).map(recipientWords).join('; ')
  if (to(s) !== to(d)) lines.push('To: ' + to(d) + ' (was ' + to(s) + ')')
  const title = v => v.name || 'the report\'s name'
  if (title(s) !== title(d)) lines.push('Email title: ' + title(d) + ' (was ' + title(s) + ')')
  if ((s.message || '') !== (d.message || '')) lines.push('Note in the email: ' + (d.message ? clip(d.message, 200) : 'none') + (s.message ? ' (was ' + clip(s.message, 80) + ')' : ''))
  if (!!s.personal_outside !== !!d.personal_outside) {
    lines.push(d.personal_outside ? 'People\'s details (names, emails, phone numbers) now go to the addresses outside the team too' : 'People\'s details no longer go outside the team')
  }
  return lines
}

// ── send_report ───────────────────────────────────────────────

/** Email it now: POST /:id/send's body, from the tool's words. */
async function sendBody(ctx, r, input) {
  const who = await callApi(ctx, 'GET', '/api/reports/recipients')
  return {
    ...(input.title ? { name: input.title } : {}),
    ...(input.message ? { message: input.message } : {}),
    params: await runParams(ctx, r.spec, input),
    delivery: deliveryOf(input),
    recipients: recipientsFor(input.to, who).map(stored),
    ...(input.peoples_details_outside ? { personal_outside: true } : {}),
  }
}

function oneTarget(input) {
  if (!!input.report === !!input.schedule) {
    throw new ToolError('Give either report (email a report now, with to) or schedule (send a schedule now), not both.', 422)
  }
  if (input.report && !input.to?.length) {
    throw new ToolError('Say who to email it to (to): "me", people on the team by name, or email addresses.', 422)
  }
}

// ── The tools ─────────────────────────────────────────────────

export const scheduleTools = [
  {
    name: 'schedule_report',
    section: 'reports',
    title: 'Reports: email one on a schedule',
    description:
      'Emails a saved report or a starter on a schedule: every day, on chosen days of the week or once a month, at a time at ' +
      'the venue; to "me", people on the team by name, or email addresses. It can send always, only when the report has rows, ' +
      'or only when one of its figures crosses a line (over 500, under 12%, more than 50 either way). Its period must move with ' +
      'the date (yesterday, last_week, last_n_days), and its venues and period can be set for the schedule. It runs as the ' +
      'person: the people it goes to get what their role can see. The card says when the first one goes.',
    input: z.object({
      report: ReportRef,
      to: To,
      timing: TimingInput,
      period: MovingPeriod.optional(),
      venues: Venues,
      ...DeliveryFields,
      ...ConditionFields,
      ...WordsFields,
      body: Pinned,
    }),
    confirm: true,
    needs: 'use',
    async describe(ctx, input) {
      const r = await scheduleTarget(ctx, input)
      const body = await newScheduleBody(ctx, r, input)
      const out = await callApi(ctx, 'POST', '/api/reports/' + enc(r.id) + '/schedules', { body: { ...body, dry_run: true } })
      return {
        title: 'Email "' + r.name + '" on a schedule?',
        lines: [
          ...scheduleCard(out.schedule, { first: true, skipped: out.skipped }),
          'It sends as you: each time, the people it goes to get what your role can see then.',
        ],
        confirmLabel: 'Schedule it',
        pin: { report: r.id, body },
      }
    },
    async run(ctx, input) {
      const r = await scheduleTarget(ctx, input)
      const body = input.body || await newScheduleBody(ctx, r, input)
      let saved
      await auditedCounts(ctx, 'schedule_report', { report: r.name, recipients: body.recipients?.length || 0 }, async () => {
        const out = await callApi(ctx, 'POST', '/api/reports/' + enc(r.id) + '/schedules', { body })
        saved = out.schedule
        return { report: r.name, when: saved.timing_text, recipients: saved.recipients.length }
      })
      return { scheduled: scheduleLine(ctx, saved), ...linkTo(ctx, 'Schedules', schedulesPath()) }
    },
  },

  {
    name: 'change_schedule',
    section: 'reports',
    title: 'Reports: change a schedule',
    description:
      'Changes a report schedule: who it goes to (to replaces the list; add_to and remove_from change it), when (timing, or ' +
      'just time), the period and venues, what it sends, when it sends (always, rows, or a figure crossing a line), the email\'s ' +
      'title and note. Give only what changes. A schedule someone else set up becomes the person\'s own when they change it ' +
      '(needs Manage on Reports), and then sends what their role can see. A paused one stays paused.',
    input: z.object({
      schedule: ScheduleRef,
      to: To.optional().describe('Everyone it goes to, in place of the list: "me", people on the team by name, or email addresses'),
      add_to: People.optional().describe('People to add: "me", names on the team, or email addresses'),
      remove_from: People.optional().describe('People to take off: "me", their names or their email addresses'),
      timing: TimingInput.optional(),
      time: z.string().regex(TIME).optional().describe('Only a new time (HH:MM at the venue), keeping its days'),
      period: MovingPeriod.optional(),
      venues: Venues,
      ...DeliveryFields,
      ...ConditionFields,
      title: z.string().trim().max(120).nullable().optional().describe('A new email title; empty or null goes back to the report\'s name'),
      message: z.string().trim().max(1000).nullable().optional().describe('A new note at the top of the email; empty or null takes it off'),
      peoples_details_outside: WordsFields.peoples_details_outside,
      body: Pinned,
    }),
    confirm: true,
    needs: 'use',
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'use')
      somethingToChange(input)
      const s = await findSchedule(ctx, input.schedule)
      if (!s.can_change) throw new ToolError('Only the person who set it up, or someone with Manage on Reports, can change it.', 403)
      const body = await changeBody(ctx, s, input)
      const out = await callApi(ctx, 'PATCH', '/api/reports/schedules/' + s.id, { body: { ...body, dry_run: true } })
      const d = out.schedule
      const lines = changeLines(s, d)
      if (!lines.length) throw new ToolError('That changes nothing: it is already set that way.', 422)
      return {
        title: 'Change the schedule of "' + s.report.name + '"?',
        lines: [
          ...lines,
          ...(d.enabled
            ? (d.next_run_at ? ['Next send: ' + whenText(d.next_run_at, d.time_zone)] : [])
            : ['It stays paused: pause_schedule with resume: true starts it again.']),
          ...(out.skipped ? [skippedLine(out.skipped)] : []),
          ...(out.takes_over ? ['It is ' + (s.owner_email || 'someone else') + '\'s: changing it makes it yours, and it will send what your role can see.'] : []),
        ],
        confirmLabel: 'Change it',
        pin: { schedule: s.id, body },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'use')
      if (!input.body) somethingToChange(input)
      const s = await findSchedule(ctx, input.schedule)
      const body = input.body || await changeBody(ctx, s, input)
      let saved
      await auditedCounts(ctx, 'change_schedule', { report: s.report.name, changed: Object.keys(body) }, async () => {
        const out = await callApi(ctx, 'PATCH', '/api/reports/schedules/' + s.id, { body })
        saved = out.schedule
        return { report: s.report.name, changed: changedWords(body), recipients: saved.recipients.length }
      })
      return { changed: scheduleLine(ctx, saved), ...linkTo(ctx, 'Schedules', schedulesPath()) }
    },
  },

  {
    name: 'pause_schedule',
    section: 'reports',
    title: 'Reports: pause or resume a schedule',
    description:
      'Pauses a report schedule (its owner, or someone with Manage on Reports): nothing more is sent until it is resumed. ' +
      'resume: true starts a paused one again (needs Use on Reports), checked as it will run, and the card says when the next ' +
      'one goes. A schedule pauses by itself when it can\'t send (its owner left, or lost access); get_report and report_runs say why.',
    input: z.object({
      schedule: ScheduleRef,
      resume: z.boolean().optional().describe('true to start a paused schedule again'),
    }),
    confirm: true,
    needs: 'view',
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'reports', input.resume ? 'use' : 'view')
      const s = await findSchedule(ctx, input.schedule)
      if (input.resume) {
        if (s.enabled) throw new ToolError('It isn\'t paused: it sends ' + lowerFirst(s.timing_text) + '.', 422)
        const out = await callApi(ctx, 'POST', '/api/reports/schedules/' + s.id + '/resume', { body: { dry_run: true } })
        const d = out.schedule
        return {
          title: 'Resume the schedule of "' + s.report.name + '"?',
          lines: [
            'When: ' + d.timing_text + (d.next_run_at ? '. Next: ' + whenText(d.next_run_at, d.time_zone) : ''),
            ...choiceLines(d),
            'Sends: ' + d.delivery_text,
            toLine(d.recipients),
            ...(out.skipped ? [skippedLine(out.skipped)] : []),
            ...(s.mine ? [] : [ownerLine(s)]),
          ],
          confirmLabel: 'Resume it',
          pin: { schedule: s.id },
        }
      }
      if (!s.can_pause) throw new ToolError('Only the person who set it up, or someone with Manage on Reports, can pause it.', 403)
      if (!s.enabled) throw new ToolError('It is already paused (' + lowerFirst(s.paused_reason || 'Paused') + '). Say resume: true to start it again.', 422)
      return {
        title: 'Pause the schedule of "' + s.report.name + '"?',
        lines: [
          'It sends ' + lowerFirst(s.timing_text) + (s.next_run_at ? ', next ' + whenText(s.next_run_at, s.time_zone) : ''),
          toLine(s.recipients),
          'Nothing more is sent until someone resumes it.',
          ...(s.mine ? [] : ['It is ' + (s.owner_email || 'someone else') + '\'s.']),
        ],
        confirmLabel: 'Pause it',
        pin: { schedule: s.id },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'reports', input.resume ? 'use' : 'view')
      const s = await findSchedule(ctx, input.schedule)
      if (input.resume && s.enabled) throw new ToolError('It isn\'t paused: it sends ' + lowerFirst(s.timing_text) + '.', 422)
      if (!input.resume && !s.enabled) throw new ToolError('It is already paused (' + lowerFirst(s.paused_reason || 'Paused') + ').', 422)
      let after
      await auditedCounts(ctx, 'pause_schedule', { report: s.report.name, resume: !!input.resume }, async () => {
        const out = await callApi(ctx, 'POST', '/api/reports/schedules/' + s.id + (input.resume ? '/resume' : '/pause'), { body: {} })
        after = out.schedule
        return { report: s.report.name, [input.resume ? 'resumed' : 'paused']: true }
      })
      return { [input.resume ? 'resumed' : 'paused']: scheduleLine(ctx, after), ...linkTo(ctx, 'Schedules', schedulesPath()) }
    },
  },

  {
    name: 'send_report',
    section: 'reports',
    title: 'Reports: email one now',
    description:
      'Emails a saved report or a starter now, once, to "me", people on the team by name, or email addresses: in the email, ' +
      'as a CSV or Excel file, or both, for its own period and venues or others (fixed days are fine here). Or sends one of the ' +
      'report schedules now (schedule), whatever its condition; its next send stays as it is. It runs as the person (a ' +
      'schedule as its owner): the people it goes to get what that role can see. Pepper never sees what was emailed.',
    input: z.object({
      report: ReportRef.optional(),
      schedule: ScheduleRef.optional().describe('Send this schedule now instead (leave report and to out)'),
      to: To.optional(),
      period: PeriodInput.optional().describe('Another period: relative (last_week, last_n_days with n) or from and to'),
      venues: Venues,
      ...DeliveryFields,
      ...WordsFields,
      body: Pinned,
    }),
    confirm: true,
    needs: 'use',
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'use')
      oneTarget(input)
      if (input.schedule) {
        const s = await findSchedule(ctx, input.schedule)
        if (!s.can_send) throw new ToolError('Only the person who set it up, or someone with Manage on Reports, can send it now.', 403)
        const out = await callApi(ctx, 'POST', '/api/reports/schedules/' + s.id + '/send', { body: { dry_run: true } })
        const d = out.schedule
        return {
          title: 'Send the schedule of "' + s.report.name + '" now?',
          lines: [
            ...choiceLines(d),
            'Sends: ' + d.delivery_text,
            toLine(d.recipients),
            ...(out.skipped ? [skippedLine(out.skipped)] : []),
            'Now, whatever its condition. Its next send stays as it is'
              + (d.enabled && d.next_run_at ? ' (' + whenText(d.next_run_at, d.time_zone) + ')' : '') + '.',
            ...(s.mine ? [] : [ownerLine(s)]),
          ],
          confirmLabel: 'Send it',
          pin: { schedule: s.id },
        }
      }
      const r = await scheduleTarget(ctx, input)
      const body = await sendBody(ctx, r, input)
      const out = await callApi(ctx, 'POST', '/api/reports/' + enc(r.id) + '/send', { body: { ...body, dry_run: true } })
      const d = out.send
      return {
        title: 'Email "' + r.name + '" now?',
        lines: [
          ...choiceLines(d),
          'Sends: ' + d.delivery_text,
          toLine(d.recipients),
          ...(out.skipped ? [skippedLine(out.skipped)] : []),
          ...titleLine(d, r.name),
          ...noteLine(d),
          ...outsideLine(d),
          'It runs as you: the people it goes to get what your role can see.',
        ],
        confirmLabel: 'Send it',
        pin: { report: r.id, body },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'reports', 'use')
      oneTarget(input)
      let res
      if (input.schedule) {
        const s = await findSchedule(ctx, input.schedule)
        await auditedCounts(ctx, 'send_report', { report: s.report.name, schedule: true }, async () => {
          res = await callApi(ctx, 'POST', '/api/reports/schedules/' + s.id + '/send', { body: {}, headers: AS_PEPPER })
          return { report: s.report.name, ...sendCounts(res) }
        })
        return sentWords(ctx, s.report.name, res, runsPath({ schedule: s.id }))
      }
      const r = await scheduleTarget(ctx, input)
      const body = input.body || await sendBody(ctx, r, input)
      await auditedCounts(ctx, 'send_report', { report: r.name, recipients: body.recipients?.length || 0 }, async () => {
        res = await callApi(ctx, 'POST', '/api/reports/' + enc(r.id) + '/send', { body, headers: AS_PEPPER })
        return { report: r.name, ...sendCounts(res) }
      })
      return sentWords(ctx, r.name, res, runsPath({ report: r.id }))
    },
  },
]
