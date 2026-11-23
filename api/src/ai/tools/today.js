// src/ai/tools/today.js
//
// Pepper reads the Today feed and changes a task's state (Pepper-first step
// 5e): the same feed and task store Home shows (GET /api/ops/today, POST
// /api/ops/tasks, routes/ops.js), read and changed as the person, so the
// feed's own permissions hold (a task the person can't see can't be found;
// changing one needs Use on its module where it has Use, else View).
//
//   my_tasks       the person's tasks at a venue for a day, grouped late /
//                  now / next / later, each with its owner and state, and
//                  what is off the list (skipped with why, snoozed until when)
//                                                               read
//   snooze_task    hide tasks from today's list for a while or until a time
//                                                               reversible (Undo brings them back)
//   skip_task      take tasks off the day's list, with a reason (required:
//                  docs/PEPPER_FIRST.md 13, decision 7)          consequential
//   assign_task    give tasks to a team member who can do them  consequential
//
// Tasks are named in words ("the fridge checks", "the weekly checklist") and
// matched to the feed's titles (matchTasks()); the model never sees a task's
// key. The card pins the keys and the day it was worked out for, so Confirm
// changes what the card showed.

import { z } from 'zod'
import { ToolError, callApi, isStaff } from '../context.js'
import { venueFor, VenueText, TimeStr, plural, audited, pickByName } from './util.js'
import { SKIP_REASONS, REASON_MAX } from '../../../../shared/todayTasks.js'

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD; defaults to today at the venue')
const MAX_MATCH = 6

// Words that say nothing about which task: left out of a match.
const STOP = new Set(['the', 'a', 'an', 'all', 'my', 'our', 'today', 'todays', 'tonight', 'task', 'tasks', 'for', 'of', 'to', 'and', 'this', 'at', 'on', 'please'])
const SAME = { weekly: 'week', daily: 'day', monthly: 'month', temps: 'fridge', temperature: 'fridge', temperatures: 'fridge', cashup: 'cash' }
// What each kind of task is called, beside its title.
const KIND_WORDS = {
  fridge_check: 'fridge freezer temperature check', hold_check: 'hot cold hold check', cooking_check: 'cooking check',
  corrective_action: 'corrective action', checklist: 'checklist', hs_action: 'action log', po_to_send: 'supplier order send',
  delivery_due: 'delivery book', delivery_not_booked: 'delivery book', orders_to_approve: 'supplier order approve',
  cash_up: 'cash up', cash_week: 'cash up week', wages_to_pay: 'wages pay', online_orders: 'online orders',
  report_alert: 'report alert', failed_email: 'booking email failed', review_to_check: 'review', screen_offline: 'menu screen offline',
  device_offline: 'till device offline', sold_out: 'sold out dish', rota_not_ready: 'rota next week',
}
const stem = w => { const s = SAME[w] || w; return s.length > 3 && s.endsWith('s') && !s.endsWith('ss') ? s.slice(0, -1) : s }
const wordsOf = text => String(text ?? '').toLowerCase().replace(/cash-up/g, 'cash up').split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w)).map(stem)

/**
 * The feed's tasks the words name: every word of `text` in the task's title,
 * detail or kind. Several tasks of one kind are all taken (the morning and
 * afternoon fridge checks), up to MAX_MATCH; tasks of different kinds ask
 * which. `list` is the feed's tasks (and set-aside ones where they count).
 */
export function matchTasks(list, text) {
  const q = wordsOf(text)
  if (!q.length) throw new ToolError('Say which task, in a few words.', 422)
  const hit = t => {
    const hay = wordsOf([t.title, t.detail, KIND_WORDS[t.kind]].join(' '))
    return q.every(w => hay.some(x => x === w || x.startsWith(w) || (w.startsWith(x) && x.length >= 4)))
  }
  const hits = list.filter(hit)
  const names = rows => rows.slice(0, 12).map(t => t.title).join('; ')
  if (!hits.length) {
    throw new ToolError('No task on the list matches "' + text + '".' + (list.length ? ' The list has: ' + names(list) + '.' : ' The list is empty.'), 404)
  }
  if (new Set(hits.map(t => t.kind)).size > 1) {
    throw new ToolError('More than one kind of task matches "' + text + '": ' + names(hits) + '. Which one?', 409)
  }
  return hits.slice(0, MAX_MATCH)
}

async function feedOf(ctx, venue, date) {
  return callApi(ctx, 'GET', '/api/ops/today?venue_id=' + venue.id + (date ? '&date=' + date : ''))
}

/** The tasks a change names (or the card pinned), checked: on the feed, changeable by the person. */
async function picked(ctx, input, { aside = false } = {}) {
  if (!isStaff(ctx)) throw new ToolError('Not available here', 403)
  const venue = await venueFor(ctx, input.venue)
  const feed = await feedOf(ctx, venue, input.date)
  const pool = aside ? [...feed.tasks, ...(feed.aside || [])] : feed.tasks
  const tasks = input.keys?.length
    ? pool.filter(t => input.keys.includes(t.key))
    : matchTasks(pool, input.task)
  if (!tasks.length) throw new ToolError('Those tasks are no longer on the list.', 404)
  const cant = tasks.filter(t => !t.can_change)
  if (cant.length) throw new ToolError('Your role can\'t change ' + cant.map(t => '"' + t.title + '"').join(', ') + '.', 403)
  return { venue, feed, tasks }
}

const send = (ctx, venue, feed, key, body) => callApi(ctx, 'POST', '/api/ops/tasks', { body: { venue_id: venue.id, key, date: feed.date, ...body } })
const titles = tasks => tasks.map(t => t.title + (t.due ? ' (' + t.due + ')' : ''))
const snoozeWords = input => (input.until ? 'until ' + input.until : 'for ' + (input.minutes >= 60 && input.minutes % 60 === 0 ? plural(input.minutes / 60, 'hour') : input.minutes + ' minutes'))

const TaskText = z.string().trim().min(2).max(120).describe('The task in a few words, as on the list: "fridge checks", "the weekly checklist", "send the Fresh Co order"')
const Keys = z.array(z.string().max(200)).max(MAX_MATCH).optional().describe('Leave out: the card pins them')

export { todayTools as tools }
export const order = 145
export const sections = {
  today: { label: 'Today\'s tasks: the list on Home, who has them, snoozed and skipped', open: true },
}
export const promptLines = [
  'Today\'s tasks: my_tasks (the person\'s list at a venue: late, now, next, later, who has each and what is snoozed or ' +
    'skipped), snooze_task, skip_task (always with the reason the person gave; ask for one if they gave none) and ' +
    'assign_task. Name tasks in words as they appear on the list.',
]

export const todayTools = [
  {
    name: 'my_tasks',
    activity: 'Looked at today\'s tasks',
    title: 'Today\'s tasks',
    description:
      'The person\'s task list at a venue for a day (default today), as Home shows it: grouped late, now, next and later, ' +
      'each with its due time, what is left to do, who it is assigned to, and whether they can do it; plus what is off the ' +
      'list for the day (skipped with the reason, snoozed until when, marked done) and areas their role can\'t see. ' +
      'mine: only tasks assigned to them. Worked out from the data, so it is the same list with the AI switched off.',
    input: z.object({
      venue: VenueText,
      date: DAY.optional(),
      mine: z.boolean().default(false).describe('Only the tasks assigned to the person'),
    }),
    readOnly: true,
    async run(ctx, input) {
      if (!isStaff(ctx)) throw new ToolError('Not available here', 403)
      const venue = await venueFor(ctx, input.venue)
      const feed = await feedOf(ctx, venue, input.date)
      const list = input.mine ? feed.tasks.filter(t => t.owner?.me) : feed.tasks
      return {
        venue: venue.name, day: feed.day, now: feed.now,
        counts: input.mine ? undefined : feed.counts,
        tasks: list.map(t => ({
          task: t.title, group: t.group, ...(t.due ? { due: t.due } : {}), detail: t.detail,
          ...(t.owner ? { assigned_to: t.owner.me ? 'you' : t.owner.name } : {}),
          ...(t.compliance ? { compliance: true } : {}),
          you_can_do_it: !!t.can_act,
        })),
        ...(list.length ? {} : { note: input.mine ? 'Nothing is assigned to them here.' : 'Nothing to do on the list.' }),
        ...((feed.aside || []).length ? {
          off_the_list: feed.aside.map(t => ({
            task: t.title, state: t.state, ...(t.reason ? { reason: t.reason } : {}), ...(t.until_text ? { snoozed: t.until_text } : {}),
          })),
        } : {}),
        ...(feed.not_included?.length ? { not_included: { areas: feed.not_included, why: 'The person\'s role can\'t see these areas.' } } : {}),
      }
    },
  },

  {
    name: 'snooze_task',
    class: 'reversible',
    title: 'Snooze a task',
    description:
      'Hides tasks from today\'s list at a venue for a while (minutes) or until a time today (until, HH:MM at the venue); ' +
      'they come back then. For "remind me later" or "not now". Several tasks of one kind (the morning and afternoon fridge ' +
      'checks) are snoozed together. Undo brings them back.',
    preconditions: ['The tasks must be on today\'s list and the person\'s role must be able to change them.'],
    input: z.object({
      venue: VenueText,
      task: TaskText,
      minutes: z.number().int().min(5).max(1440).optional().describe('How long; or give until'),
      until: TimeStr.optional().describe('Until this time today at the venue, HH:MM; or give minutes'),
      date: DAY.optional(),
      keys: Keys,
    }),
    confirm: true,
    async inverse(ctx, undo) {
      for (const key of undo.keys) {
        await callApi(ctx, 'POST', '/api/ops/tasks', { body: { venue_id: undo.venue_id, key, date: undo.date, action: 'unsnooze' } })
          .catch(err => { if (err?.status !== 409) throw err })
      }
      return { message: 'Back on the list.' }
    },
    async describe(ctx, input) {
      if (!input.minutes && !input.until) throw new ToolError('Say how long to snooze it for, or until when.', 422)
      const { venue, feed, tasks } = await picked(ctx, input)
      if (!feed.is_today) throw new ToolError('Only today\'s tasks can be snoozed.', 422)
      if (input.until && input.until <= feed.now) throw new ToolError('It is ' + feed.now + ' at ' + venue.name + ' already: pick a later time.', 422)
      return {
        title: 'Snooze ' + (tasks.length === 1 ? 'this task' : plural(tasks.length, 'task')) + ' ' + snoozeWords(input) + '?',
        lines: [venue.name, ...titles(tasks)],
        confirmLabel: 'Snooze',
        pin: { venue: venue.id, date: feed.date, keys: tasks.map(t => t.key) },
      }
    },
    async run(ctx, input) {
      const { venue, feed, tasks } = await picked(ctx, input)
      return audited(ctx, 'snooze_task', { venue: venue.name, tasks: tasks.map(t => t.title), minutes: input.minutes, until: input.until }, async () => {
        for (const t of tasks) await send(ctx, venue, feed, t.key, { action: 'snooze', ...(input.until ? { until: input.until } : { minutes: input.minutes }) })
        return {
          snoozed: tasks.map(t => t.title), for: snoozeWords(input), message: 'Off the list ' + snoozeWords(input) + '.',
          _undo: { venue_id: venue.id, date: feed.date, keys: tasks.map(t => t.key) },
        }
      })
    },
  },

  {
    name: 'skip_task',
    class: 'consequential',
    title: 'Skip a task for the day',
    description:
      'Takes tasks off a venue\'s list for the day, with the reason the person gave (required: a skip is kept with the ' +
      'day\'s records and shown to managers, by site). Use the person\'s own words for the reason; when they gave none, ' +
      'ask them why, e.g. ' + SKIP_REASONS.slice(0, 3).map(r => '"' + r + '"').join(', ') + '. Never invent a reason.',
    preconditions: ['A reason from the person.', 'The tasks must be on the day\'s list and the person\'s role must be able to change them.'],
    input: z.object({
      venue: VenueText,
      task: TaskText,
      reason: z.string().trim().min(3).max(REASON_MAX).describe('Why, in the person\'s words'),
      date: DAY.optional(),
      keys: Keys,
    }),
    confirm: true,
    editable: { reason: { label: 'Reason', kind: 'note' } },
    async describe(ctx, input) {
      const { venue, feed, tasks } = await picked(ctx, input)
      return {
        title: 'Skip ' + (tasks.length === 1 ? 'this task' : plural(tasks.length, 'task')) + ' for ' + (feed.is_today ? 'today' : feed.day) + '?',
        lines: [venue.name, ...titles(tasks), 'Reason: ' + input.reason],
        ...(tasks.some(t => t.compliance) ? { warningTitle: 'A compliance task', warnings: ['The skip and its reason are kept with the day\'s records and shown to managers.'] } : {}),
        confirmLabel: 'Skip',
        pin: { venue: venue.id, date: feed.date, keys: tasks.map(t => t.key) },
      }
    },
    async run(ctx, input) {
      const { venue, feed, tasks } = await picked(ctx, input)
      return audited(ctx, 'skip_task', { venue: venue.name, tasks: tasks.map(t => t.title), reason: input.reason }, async () => {
        for (const t of tasks) await send(ctx, venue, feed, t.key, { action: 'skip', reason: input.reason })
        return { skipped: tasks.map(t => t.title), reason: input.reason, message: 'Off the list for the day. The task\'s page can still be used.' }
      })
    },
  },

  {
    name: 'assign_task',
    class: 'consequential',
    title: 'Give a task to someone',
    description:
      'Assigns tasks at a venue to a team member (by name, or "me"), shown on the task on Home; only people whose role can ' +
      'do the task can have it. person "nobody" clears it.',
    preconditions: ['The person must be an active team member whose role can do the task.'],
    input: z.object({
      venue: VenueText,
      task: TaskText,
      person: z.string().trim().min(1).max(100).describe('A team member\'s name, "me", or "nobody" to clear it'),
      date: DAY.optional(),
      keys: Keys,
      owner_id: z.string().uuid().nullable().optional().describe('Leave out: the card pins it'),
    }),
    confirm: true,
    async describe(ctx, input) {
      const { venue, feed, tasks } = await picked(ctx, input)
      const who = await personFor(ctx, venue, feed, tasks[0], input.person)
      return {
        title: (who ? 'Give ' + (tasks.length === 1 ? 'this task' : plural(tasks.length, 'task')) + ' to ' + who.name : 'Clear who has ' + (tasks.length === 1 ? 'this task' : 'these tasks')) + '?',
        lines: [venue.name, ...titles(tasks.map(t => ({ ...t, title: t.title + (t.owner ? ' (now ' + (t.owner.me ? 'you' : t.owner.name) + ')' : '') })))],
        confirmLabel: who ? 'Assign' : 'Clear',
        pin: { venue: venue.id, date: feed.date, keys: tasks.map(t => t.key), owner_id: who ? who.id : null },
      }
    },
    async run(ctx, input) {
      const { venue, feed, tasks } = await picked(ctx, input)
      const ownerId = input.owner_id !== undefined ? input.owner_id : ((await personFor(ctx, venue, feed, tasks[0], input.person))?.id ?? null)
      return audited(ctx, 'assign_task', { venue: venue.name, tasks: tasks.map(t => t.title), person: input.person }, async () => {
        for (const t of tasks) await send(ctx, venue, feed, t.key, { action: 'assign', owner_id: ownerId })
        return { assigned: tasks.map(t => t.title), to: ownerId ? input.person : 'nobody', message: 'Shown on the task on Home.' }
      })
    },
  },
]

/** The team member `text` names for a task (people who can do it), or null for "nobody". */
async function personFor(ctx, venue, feed, task, text) {
  const t = String(text).trim().toLowerCase()
  if (['nobody', 'no one', 'noone', 'none', 'clear'].includes(t)) return null
  const { people } = await callApi(ctx, 'GET', '/api/ops/tasks/people?venue_id=' + venue.id + '&date=' + feed.date + '&key=' + encodeURIComponent(task.key))
  if (['me', 'myself', 'i'].includes(t)) {
    const me = people.find(p => p.me)
    if (!me) throw new ToolError('Your role can\'t do this task, so it can\'t be given to you.', 422)
    return me
  }
  return pickByName(people, text, p => p.name, 'team member who can do this task', 'Nobody on the team can do this task.')
}

