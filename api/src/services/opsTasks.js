// src/services/opsTasks.js
//
// The task store (Pepper-first step 5a, migration 278): what people decided
// about a Today task, kept by venue and the feed's stable key, and applied
// to the feed (opsToday()):
//
//   owner     a team member (users.id) the task is assigned to; shown on it
//   snoozed   hidden on today's feed until snoozed_until
//   skipped   off the list for that day, with a reason (required, decision 7
//             of docs/PEPPER_FIRST.md 13) and who skipped it
//   done      off the list for that day: only the kinds the feed can't see
//             finish (MANUAL_DONE_KINDS); the rest leave by evidence
//
// Every change is one ops_task_log row (the task's history, and the report
// on skips and completion by site). Changes come through POST /api/ops/tasks
// (routes/ops.js), which first finds the task on the person's own feed, so a
// task they can't see can't be changed, and Pepper's task tools call that
// route. The feed's record per day (ops_task_days) is kept by the notices
// sweep: recordFeed() here.

import { withTenant } from '../config/db.js'
import { levelsOf, permissionAtLeast } from '../config/modules.js'
import {
  MANUAL_DONE_KINDS, SNOOZE_MAX_MINUTES, cleanReason, snoozeText,
} from '../../../shared/todayTasks.js'

/** { date, time, weekday } of an instant at a venue (time zone `tz`). */
export function localParts(instant, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'long',
  }).formatToParts(new Date(instant)).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, weekday: p.weekday }
}

export class TaskError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

/** "Sam" from a users row: the full name, else the start of the email. */
export function personName(u) {
  const name = String(u?.full_name || '').trim()
  if (name) return name
  const mail = String(u?.email || '').split('@')[0]
  return mail || 'Someone'
}

/** The level a person needs to change a task's state: Use where its module offers Use, else Manage
 *  (CLAUDE.md rule 5: changes need Manage, everyday work Use where the module has it; View never changes). */
export const stateLevel = module => (levelsOf(module).includes('use') ? 'use' : 'manage')

/** Whether a person with `levels` may change a task of `module` (at `level` when the task needs more
 *  than its module's own: taskLevel() in services/opsToday.js). */
export const canChange = (levels, module, level = null) => !!module && permissionAtLeast(levels[module], level || stateLevel(module))

/** Each venue task's state, with its owner's name. */
export async function loadStates(tenantId, venueId) {
  return withTenant(tenantId, tx => tx`
    SELECT s.task_key, s.area, s.kind, s.title, s.owner_id, s.snoozed_until,
           s.skipped_on::text AS skipped_on, s.skip_reason, s.skipped_at,
           s.done_on::text AS done_on, s.done_at,
           u.full_name AS owner_full_name, u.email AS owner_email, u.auth0_user_id AS owner_sub,
           COALESCE(u.is_active, false) AS owner_active
      FROM ops_task_states s
      LEFT JOIN users u ON u.id = s.owner_id AND u.tenant_id = s.tenant_id
     WHERE s.tenant_id = ${tenantId} AND s.venue_id = ${venueId}
  `)
}

const ownerOf = (s, me) => (s.owner_id && s.owner_active
  ? { id: s.owner_id, name: personName({ full_name: s.owner_full_name, email: s.owner_email }), me: !!me && s.owner_sub === me }
  : null)

/**
 * The feed with the store applied. `tasks`: the feed's tasks for `date`;
 * returns { tasks, aside }: the tasks still on the list (with `owner`) and
 * the ones set aside for the day (skipped, done or snoozed), each with its
 * state, so the person can bring one back. A snooze counts only on today's
 * feed (`isToday`), against the real clock.
 */
export function applyStates(tasks, states, { date, isToday, me = null, now = Date.now(), tz = 'UTC', today = date }) {
  const byKey = new Map(states.map(s => [s.task_key, s]))
  const shown = []
  const aside = []
  for (const t of tasks) {
    const s = byKey.get(t.key)
    if (!s) { shown.push(t); continue }
    const owner = ownerOf(s, me)
    const task = owner ? { ...t, owner } : t
    const brief = { key: t.key, title: t.title, area: t.area, kind: t.kind, compliance: !!t.compliance, can_act: t.can_act, can_change: t.can_change, ...(owner ? { owner } : {}) }
    if (s.skipped_on === date) aside.push({ ...brief, state: 'skipped', reason: s.skip_reason, at: s.skipped_at })
    else if (s.done_on === date) aside.push({ ...brief, state: 'done', at: s.done_at })
    else if (isToday && s.snoozed_until && new Date(s.snoozed_until).getTime() > now) {
      aside.push({ ...brief, state: 'snoozed', until: new Date(s.snoozed_until).toISOString(), until_text: snoozeText(localParts(s.snoozed_until, tz), today) })
    } else shown.push(task)
  }
  return { tasks: shown, aside }
}

const by = who => ({ sub: who.sub || null, name: who.name || who.email || null })

/**
 * One change to a task, checked: `who` { sub, name }, `venue` { id, timezone },
 * `task` the feed's task (or its set-aside entry) found on the person's own
 * feed for `date`, `isToday`, `change` { action, owner?, minutes?, until?, reason? }
 * (owner: a users row the route has checked). Returns the state row.
 */
export async function changeTask(tenantId, who, venue, task, date, isToday, change) {
  const { action } = change
  const actor = by(who)
  return withTenant(tenantId, async tx => {
    const [cur] = await tx`
      SELECT *, skipped_on::text AS skipped_on, done_on::text AS done_on FROM ops_task_states
       WHERE tenant_id = ${tenantId} AND venue_id = ${venue.id} AND task_key = ${task.key} FOR UPDATE`
    const skipped = cur?.skipped_on === date
    const done = cur?.done_on === date
    const snoozed = !!cur?.snoozed_until && new Date(cur.snoozed_until).getTime() > Date.now()
    const set = {}
    const log = { action }
    if (action === 'assign') {
      const ownerId = change.owner?.id ?? null
      if ((cur?.owner_id ?? null) === ownerId) return cur
      set.owner_id = ownerId
      log.action = ownerId ? 'assigned' : 'unassigned'
      log.owner_id = ownerId
      log.owner_name = ownerId ? personName(change.owner) : null
    } else if (action === 'snooze') {
      if (!isToday) throw new TaskError(422, 'Only today\'s tasks can be snoozed.')
      if (skipped || done) throw new TaskError(409, 'This task is already off today\'s list.')
      const until = await snoozeUntil(tx, venue, change)
      set.snoozed_until = until
      set.snoozed_by = actor.name
      log.action = 'snoozed'
      log.until_at = until
    } else if (action === 'unsnooze') {
      if (!snoozed) throw new TaskError(409, 'This task isn\'t snoozed.')
      set.snoozed_until = null
      set.snoozed_by = null
      log.action = 'unsnoozed'
    } else if (action === 'skip') {
      const reason = cleanReason(change.reason)
      if (!reason) throw new TaskError(422, 'Say why it is being skipped (up to 300 characters).')
      if (skipped) throw new TaskError(409, 'This task is already skipped for the day.')
      if (done) throw new TaskError(409, 'This task is already marked done for the day.')
      Object.assign(set, { skipped_on: date, skip_reason: reason, skipped_by: actor.name, skipped_at: new Date() })
      log.reason = reason
      log.action = 'skipped'
    } else if (action === 'unskip') {
      if (!skipped) throw new TaskError(409, 'This task isn\'t skipped.')
      Object.assign(set, { skipped_on: null, skip_reason: null, skipped_by: null, skipped_at: null })
      log.action = 'unskipped'
    } else if (action === 'done') {
      if (!MANUAL_DONE_KINDS.includes(task.kind)) throw new TaskError(422, 'This task leaves the list by itself once it is done: open it and do it there.')
      if (done) throw new TaskError(409, 'This task is already marked done.')
      if (skipped) throw new TaskError(409, 'This task is skipped for the day: bring it back first.')
      Object.assign(set, { done_on: date, done_by: actor.name, done_at: new Date() })
    } else if (action === 'undone') {
      if (!done) throw new TaskError(409, 'This task isn\'t marked done.')
      Object.assign(set, { done_on: null, done_by: null, done_at: null })
    } else {
      throw new TaskError(422, 'Unknown change.')
    }
    const row = {
      tenant_id: tenantId, venue_id: venue.id, task_key: task.key,
      area: task.area ?? null, kind: task.kind ?? null, title: task.title ?? null,
      updated_at: new Date(), ...set,
    }
    const [saved] = await tx`
      INSERT INTO ops_task_states ${tx(row)}
      ON CONFLICT (venue_id, task_key) DO UPDATE SET ${tx(row, Object.keys(row).filter(k => !['tenant_id', 'venue_id', 'task_key'].includes(k)))}
      RETURNING *, skipped_on::text AS skipped_on, done_on::text AS done_on`
    await tx`
      INSERT INTO ops_task_log ${tx({
        tenant_id: tenantId, venue_id: venue.id, task_key: task.key, day: date,
        area: task.area ?? null, kind: task.kind ?? null, title: task.title ?? null,
        action: log.action, reason: log.reason ?? null, until_at: log.until_at ?? null,
        owner_id: log.owner_id ?? null, owner_name: log.owner_name ?? null,
        by_sub: actor.sub, by_name: actor.name,
      })}`
    return saved
  })
}

/** When a snooze ends: `minutes` from now, or `until` HH:MM today at the venue (later than now). */
async function snoozeUntil(tx, venue, { minutes, until }) {
  const now = Date.now()
  let at
  if (until) {
    const today = localParts(new Date(now), venue.timezone).date
    const [{ ts }] = await tx`SELECT (${today + ' ' + until + ':00'}::timestamp AT TIME ZONE ${venue.timezone || 'UTC'}) AS ts`
    at = new Date(ts)
    if (at.getTime() <= now) throw new TaskError(422, 'Pick a time later than now.')
  } else {
    const m = Number(minutes)
    if (!Number.isInteger(m) || m < 5) throw new TaskError(422, 'Snooze for at least 5 minutes.')
    at = new Date(now + m * 60_000)
  }
  if (at.getTime() - now > SNOOZE_MAX_MINUTES * 60_000) throw new TaskError(422, 'A task can be snoozed for a day at most.')
  return at
}

/** A task's history, newest first. */
export async function taskHistory(tenantId, venueId, key, limit = 30) {
  return withTenant(tenantId, tx => tx`
    SELECT action, day::text AS day, reason, until_at, owner_name, by_name, at
      FROM ops_task_log
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND task_key = ${key}
     ORDER BY at DESC
     LIMIT ${limit}
  `)
}

/**
 * The feed's record for a venue and day (ops_task_days), from a feed worked
 * out with every area (the notices sweep, as the group's owner): each task
 * seen; the first time it was seen late; when it left the list (finished,
 * found missing on a later sweep, and cleared if it comes back); skipped
 * ones marked. Areas that failed to load are left alone.
 */
export async function recordFeed(tenantId, venueId, feed) {
  const failed = new Set((feed.errors || []).map(e => e.area))
  const seen = feed.tasks.filter(t => !failed.has(t.area))
  const skipped = (feed.aside || []).filter(t => t.state === 'skipped')
  const snoozed = (feed.aside || []).filter(t => t.state === 'snoozed' || t.state === 'done')
  const rows = [...seen.map(t => ({ t, skipped: false })), ...skipped.map(t => ({ t, skipped: true })), ...snoozed.map(t => ({ t, skipped: false }))]
  await withTenant(tenantId, async tx => {
    for (const { t, skipped: skip } of rows) {
      const late = seen.includes(t) && t.group === 'late'
      const finished = (feed.aside || []).some(a => a.key === t.key && a.state === 'done')
      await tx`
        INSERT INTO ops_task_days (tenant_id, venue_id, day, task_key, area, kind, title, compliance, due, late_at, skipped, finished_at)
        VALUES (${tenantId}, ${venueId}, ${feed.date}::date, ${t.key}, ${t.area}, ${t.kind}, ${t.title}, ${!!t.compliance},
                ${t.due ?? null}::time, ${late ? new Date() : null}, ${skip}, ${finished ? new Date() : null})
        ON CONFLICT (venue_id, day, task_key) DO UPDATE SET
          title = EXCLUDED.title, last_seen_at = now(), skipped = EXCLUDED.skipped,
          late_at = COALESCE(ops_task_days.late_at, EXCLUDED.late_at),
          finished_at = CASE WHEN EXCLUDED.finished_at IS NOT NULL THEN COALESCE(ops_task_days.finished_at, EXCLUDED.finished_at) ELSE NULL END`
    }
    const keys = rows.map(r => r.t.key)
    await tx`
      UPDATE ops_task_days SET finished_at = now()
       WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND day = ${feed.date}::date
         AND finished_at IS NULL AND NOT skipped
         AND NOT (task_key = ANY(${keys}::text[]))
         AND NOT (area = ANY(${[...failed, ...(feed.not_included || [])]}::text[]))`
  })
}

/** Tasks late by more than `minutes` on a feed: by their time when they have one, else since first seen late. */
export async function lateSince(tenantId, venueId, date) {
  const rows = await withTenant(tenantId, tx => tx`
    SELECT task_key, late_at FROM ops_task_days
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND day = ${date}::date AND late_at IS NOT NULL`)
  return new Map(rows.map(r => [r.task_key, new Date(r.late_at)]))
}
