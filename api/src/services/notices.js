// src/services/notices.js
//
// Push notices for the Today tasks (migration 262, OUTSTANDING 44 item 13,
// docs/PEPPER_FIRST.md 4.8 and phase 6a). Every five minutes
// (jobs/task-notices.js) sweepNotices() works out each venue's Today
// tasks, the same feed the Today page shows (opsToday()), and sends:
//   - due soon: a task with a time that is due within the next half hour
//   - late:     a task the feed has gone late on
//   - escalated: a task late by more than ESCALATE_MINUTES (by its time,
//               else since the sweep first saw it late), to the venue's
//               managers: Manage on the task's module (Pepper-first step 5b)
// each once per venue, task, day and kind (task_notices, claimed before
// sending), to the people who can do it (Use where the module offers it,
// else Manage: the feed's can_act rule) and who want it (user_notify:
// on, the venue, the area, the kind, outside their quiet hours; an
// escalation follows the late switch).
//
// The sweep also keeps the feed's record for every group (ops_task_days,
// recordFeed() in services/opsTasks.js): each task seen per venue and day,
// when it went late and when it left the list, for the report on
// completion by site and for escalation. Snoozed and skipped tasks are off
// the feed (the task store), so they send nothing.
//
// The feed is worked out as the group's owner, in-process (the internal
// act-as sign-in in middleware/auth.js), so it holds every area; each
// person then only gets the tasks they can act on.
//
// Delivery: browser push (Web Push with VAPID keys made once and kept
// sealed in platform_secrets) and the Macaroonie Office app's push (Expo's
// push service). A device the push service says is gone is removed.

import { createHash } from 'node:crypto'
import webpush from 'web-push'
import { sql, systemSql, withTenant } from '../config/db.js'
import { seal, unseal } from './vault.js'
import { officeOrigin } from './platformHost.js'
import { makeContext } from '../ai/context.js'
import { permissionLevels, INTERNAL_AS_PREFIX } from '../middleware/auth.js'
import { permissionAtLeast, workLevel } from '../config/modules.js'
import { opsToday, OPS_MODULES, moduleOf, taskLevel } from './opsToday.js'
import { localParts } from '../ai/tools/util.js'
import { TASK_AREAS, ESCALATE_MINUTES } from '../../../shared/todayTasks.js'
import { recordFeed, lateSince } from './opsTasks.js'
import { fireRules } from '../ai/ruleRunner.js'

export const NOTICE_KINDS = ['due_soon', 'late', 'escalated']
export const DUE_SOON_MINUTES = 30
// The feed's areas in words: one list (shared/todayTasks.js).
export const AREA_LABELS = TASK_AREAS
export const DEFAULT_SETTINGS = {
  enabled: true, venue_ids: [], areas: [], due_soon: true, late: true, quiet_from: null, quiet_to: null,
}

const mins = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m }
export const tokenHash = token => createHash('sha256').update(String(token)).digest('hex')

// ── VAPID keys (browser push) ─────────────────────────────────
const VAPID_SECRET = 'web_push_vapid'
let vapid = null
/** The platform's VAPID keys, made the first time they are needed. */
export async function vapidKeys() {
  if (vapid) return vapid
  const read = async () => {
    const [row] = await sql`SELECT value FROM platform_secrets WHERE name = ${VAPID_SECRET}`
    return row ? JSON.parse(unseal(row.value)) : null
  }
  let keys = await read()
  if (!keys) {
    const made = webpush.generateVAPIDKeys()
    await sql`
      INSERT INTO platform_secrets (name, value, hint, updated_by)
      VALUES (${VAPID_SECRET}, ${seal(JSON.stringify(made))}, ${made.publicKey.slice(-4)}, 'notices')
      ON CONFLICT (name) DO NOTHING`
    keys = await read()   // another process may have made them first
  }
  return (vapid = keys)
}

// ── Which notice a task is due, if any ────────────────────────
/** 'late', 'due_soon' or null for a feed task at `now` (HH:MM, venue time). */
export function noticeKind(task, now) {
  if (task.group === 'late') return 'late'
  if (task.due && task.group !== 'later') {
    const ahead = mins(task.due) - mins(now)
    if (ahead > 0 && ahead <= DUE_SOON_MINUTES) return 'due_soon'
  }
  return null
}

/** Whether `time` (HH:MM) falls in quiet hours from..to (either may run past midnight). */
export function inQuietHours(time, from, to) {
  if (!from || !to) return false
  const t = mins(time), a = mins(from), b = mins(to)
  if (a === b) return false
  return a < b ? (t >= a && t < b) : (t >= a || t < b)
}

/** Whether a person wants this notice and can act on the task. */
export function wants(person, { venueId, task, kind, time }) {
  const s = person.settings
  if (!s.enabled) return false
  if (s.venue_ids.length && !s.venue_ids.includes(venueId)) return false
  if (s.areas.length && !s.areas.includes(task.area)) return false
  if (kind === 'due_soon' && !s.due_soon) return false
  if (kind === 'late' && !s.late) return false
  if (inQuietHours(time, s.quiet_from, s.quiet_to)) return false
  // The task's module and the level its work needs there (opsToday's moduleOf() and taskLevel()).
  const module = moduleOf(task)
  return !!module && permissionAtLeast(person.levels[module], taskLevel(task) || workLevel(module))
}

/**
 * How many minutes a late task has been late at `now` (HH:MM, venue time):
 * by its own time when it has one, else since the sweep first saw it late
 * (`since`, a Date), else 0.
 */
export function minutesLate(task, now, since, nowMs = Date.now()) {
  if (task.group !== 'late') return 0
  if (task.due) return Math.max(0, mins(now) - mins(task.due))
  return since ? Math.max(0, Math.floor((nowMs - since.getTime()) / 60_000)) : 0
}

/** Whether a manager wants an escalation: their settings (the late switch) and Manage on the task's module. */
export function wantsEscalation(person, { venueId, task, time }) {
  const s = person.settings
  if (!s.enabled || !s.late) return false
  if (s.venue_ids.length && !s.venue_ids.includes(venueId)) return false
  if (s.areas.length && !s.areas.includes(task.area)) return false
  if (inQuietHours(time, s.quiet_from, s.quiet_to)) return false
  const module = moduleOf(task)
  return !!module && permissionAtLeast(person.levels[module], 'manage')
}

/** A person's settings, defaults filled in. */
export function settingsOf(row) {
  if (!row) return { ...DEFAULT_SETTINGS }
  return {
    enabled: row.enabled ?? true, venue_ids: row.venue_ids || [], areas: row.areas || [],
    due_soon: row.due_soon ?? true, late: row.late ?? true,
    quiet_from: row.quiet_from ? String(row.quiet_from).slice(0, 5) : null,
    quiet_to: row.quiet_to ? String(row.quiet_to).slice(0, 5) : null,
  }
}

// ── Delivery ──────────────────────────────────────────────────
const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send'

async function sendWeb(token, payload) {
  const keys = await vapidKeys()
  try {
    await webpush.sendNotification(JSON.parse(token), JSON.stringify(payload), {
      TTL: 60 * 60,
      vapidDetails: { subject: officeOrigin(), publicKey: keys.publicKey, privateKey: keys.privateKey },
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, gone: e.statusCode === 404 || e.statusCode === 410, error: e.body || e.message }
  }
}

async function sendApp(token, payload) {
  try {
    const res = await fetch(EXPO_PUSH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ to: token, title: payload.title, body: payload.body, data: { url: payload.url }, sound: 'default', channelId: 'tasks' }),
      signal: AbortSignal.timeout(10_000),
    })
    const out = await res.json().catch(() => ({}))
    const ticket = Array.isArray(out.data) ? out.data[0] : out.data
    if (res.ok && ticket?.status === 'ok') return { ok: true }
    const err = ticket?.details?.error || ticket?.message || out.errors?.[0]?.message || ('HTTP ' + res.status)
    return { ok: false, gone: err === 'DeviceNotRegistered', error: err }
  } catch (e) {
    return { ok: false, gone: false, error: e.message }
  }
}

/** How each kind of device is sent to. Tests replace these. */
export const pushSenders = { web: sendWeb, app: sendApp }

/** Sends one notice to a person's devices; removes devices that are gone. Returns how many it reached. */
export async function sendToDevices(tenantId, devices, payload) {
  let reached = 0
  for (const d of devices) {
    const r = await pushSenders[d.kind](unseal(d.token), payload)
    if (r.ok) {
      reached++
      await withTenant(tenantId, tx => tx`
        UPDATE push_devices SET last_seen_at = now(), last_error = NULL WHERE id = ${d.id} AND tenant_id = ${tenantId}`)
    } else if (r.gone) {
      await withTenant(tenantId, tx => tx`DELETE FROM push_devices WHERE id = ${d.id} AND tenant_id = ${tenantId}`)
    } else {
      await withTenant(tenantId, tx => tx`
        UPDATE push_devices SET last_error = ${String(r.error || 'Not sent').slice(0, 300)} WHERE id = ${d.id} AND tenant_id = ${tenantId}`)
    }
  }
  return reached
}

// ── The people a group's notices can go to ────────────────────
/** People with a device and a login here: [{ sub, settings, levels, devices }]. */
export async function noticePeople(tenantId) {
  const rows = await withTenant(tenantId, tx => tx`
    SELECT d.id, d.user_sub, d.kind, d.token,
           n.enabled, n.venue_ids, n.areas, n.due_soon, n.late, n.quiet_from::text AS quiet_from, n.quiet_to::text AS quiet_to,
           (n.user_sub IS NOT NULL) AS has_settings
      FROM push_devices d
      JOIN users u ON u.auth0_user_id = d.user_sub AND u.tenant_id = d.tenant_id AND u.is_active
      LEFT JOIN user_notify n ON n.tenant_id = d.tenant_id AND n.user_sub = d.user_sub
     WHERE d.tenant_id = ${tenantId}`)
  const bySub = new Map()
  for (const r of rows) {
    const p = bySub.get(r.user_sub) || { sub: r.user_sub, settings: settingsOf(r.has_settings ? r : null), devices: [] }
    p.devices.push({ id: r.id, kind: r.kind, token: r.token })
    bySub.set(r.user_sub, p)
  }
  const people = [...bySub.values()]
  for (const p of people) {
    p.levels = await permissionLevels({ tenantId, user: { sub: p.sub }, isPlatformAdmin: false }, OPS_MODULES)
  }
  return people
}

function payloadFor(venue, task, kind) {
  const when = kind === 'escalated' ? 'Late for over ' + Math.round(ESCALATE_MINUTES / 60) + ' hours'
    : kind === 'late' ? 'Late' : 'Due at ' + task.due
  return {
    title: task.title,
    body: [venue.name, when, task.detail].filter(Boolean).join(' · '),
    url: '/',
    tag: venue.id + ':' + task.key + ':' + kind,
  }
}

/**
 * One sweep: every group with a device. `app` runs the routes the feed
 * reads (in-process). `time` / `date` (tests) judge the feed at another
 * moment. Returns { venues, sent }.
 */
export async function sweepNotices(app, log, { time, date } = {}) {
  // Every active group: the feed's record is kept for all of them; notices
  // go only where someone has a device.
  const tenants = await systemSql`
    SELECT t.id AS tenant_id FROM tenants t
     WHERE t.is_active AND EXISTS (SELECT 1 FROM venues v WHERE v.tenant_id = t.id AND v.is_active)`
  let venues = 0, sent = 0
  for (const { tenant_id: tenantId } of tenants) {
    try {
      const r = await sweepTenant(app, log, tenantId, { time, date })
      venues += r.venues; sent += r.sent
    } catch (e) {
      log?.warn?.({ tenantId, err: e?.message }, 'Task notices: a group failed')
    }
  }
  return { venues, sent }
}

async function sweepTenant(app, log, tenantId, { time, date }) {
  const people = await noticePeople(tenantId)
  const notify = people.some(p => p.settings.enabled)
  // The feed is worked out as an owner, so it holds every area.
  const [owner] = await withTenant(tenantId, tx => tx`
    SELECT id, auth0_user_id, email FROM users
     WHERE tenant_id = ${tenantId} AND role = 'owner' AND is_active AND auth0_user_id IS NOT NULL
     ORDER BY created_at LIMIT 1`)
  if (!owner) return { venues: 0, sent: 0 }
  const ctx = makeContext({
    app, channel: 'staff_chat', tenantId, log,
    auth: { authorization: 'Bearer ' + INTERNAL_AS_PREFIX + owner.id },
    principal: { sub: owner.auth0_user_id, email: owner.email }, actor: 'Task notices',
  })
  const ownerLevels = await permissionLevels({ tenantId, user: { sub: owner.auth0_user_id }, isPlatformAdmin: false }, OPS_MODULES)
  const venues = await withTenant(tenantId, tx => tx`
    SELECT id, name, timezone FROM venues WHERE tenant_id = ${tenantId} AND is_active ORDER BY name`)
  let sent = 0
  for (const venue of venues) {
    const feed = await opsToday(ctx, venue, { date, time, levels: ownerLevels })
    await recordFeed(tenantId, venue.id, feed).catch(e => log?.warn?.({ tenantId, venueId: venue.id, err: e?.message }, 'Task notices: the feed record failed'))
    // The group's rules on late tasks (Pepper-first step 8B2): once per task and day, whether or not anyone gets notices.
    for (const task of feed.tasks.filter(t => noticeKind(t, feed.now) === 'late')) {
      await fireRules(app, tenantId, {
        trigger: 'task_late', key: venue.id + ':' + task.key + ':' + feed.date, day: feed.date,
        venue_id: venue.id, venue: venue.name, task: task.title, due: task.due || '', area: TASK_AREAS[task.area] || task.area, area_key: task.area,
      }, log).catch(e => log?.warn?.({ tenantId, venueId: venue.id, err: e?.message }, 'Task notices: a rule failed'))
    }
    if (!notify) continue
    const clock = time || localParts(new Date(), venue.timezone).time
    const since = await lateSince(tenantId, venue.id, feed.date)
    for (const task of feed.tasks) {
      const kinds = [noticeKind(task, feed.now)]
      if (minutesLate(task, feed.now, since.get(task.key)) > ESCALATE_MINUTES) kinds.push('escalated')
      for (const kind of kinds.filter(Boolean)) {
        const to = people.filter(p => kind === 'escalated'
          ? wantsEscalation(p, { venueId: venue.id, task, time: clock })
          : wants(p, { venueId: venue.id, task, kind, time: clock }))
        if (!to.length) continue
        sent += await sendOnce(tenantId, venue, feed, task, kind, to)
      }
    }
  }
  return { venues: venues.length, sent }
}

// Each once: claimed before it is sent, so two processes never both send it.
// An escalation is also a change in the task's history (ops_task_log).
async function sendOnce(tenantId, venue, feed, task, kind, to) {
  const [claimed] = await withTenant(tenantId, tx => tx`
    INSERT INTO task_notices (tenant_id, venue_id, task_key, day, kind, title)
    VALUES (${tenantId}, ${venue.id}, ${task.key}, ${feed.date}::date, ${kind}, ${task.title})
    ON CONFLICT (venue_id, task_key, day, kind) DO NOTHING
    RETURNING task_key`)
  if (!claimed) return 0
  const payload = payloadFor(venue, task, kind)
  let reached = 0
  for (const p of to) reached += await sendToDevices(tenantId, p.devices, payload)
  await withTenant(tenantId, async tx => {
    await tx`
      UPDATE task_notices SET sent_to = ${reached}
       WHERE venue_id = ${venue.id} AND task_key = ${task.key} AND day = ${feed.date}::date AND kind = ${kind}`
    if (kind === 'escalated') {
      await tx`
        INSERT INTO ops_task_log (tenant_id, venue_id, task_key, day, area, kind, title, action, by_name)
        VALUES (${tenantId}, ${venue.id}, ${task.key}, ${feed.date}::date, ${task.area}, ${task.kind}, ${task.title}, 'escalated', 'Task notices')`
    }
  })
  return reached
}

/** Old task_notices go after 30 days (the hourly clean-up). */
export async function cleanUpNotices() {
  await systemSql`DELETE FROM task_notices WHERE sent_at < now() - interval '30 days'`
}
