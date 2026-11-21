// src/reports/schedules.js
//
// The minute sweep for report schedules (docs/REPORTS.md 14, migration 251):
// every minute, any API process claims the schedules that are due and sends
// each one as its owner (src/reports/send.js).
//
//   sweepSchedules(log)    send what is due; { claimed, sent, partly,
//                          not_met, failed, late, paused }
//   RETRY_MINUTES          when a send that failed for a passing reason is
//                          tried again, in minutes after it was due
//   MAX_FAILURES           runs in a row that failed before a schedule pauses
//
// The rules:
//   - A schedule is claimed with a lease (running_until, ten minutes) under
//     FOR UPDATE SKIP LOCKED, so two processes never send one at once, and a
//     process that dies mid-send lets it go when the lease runs out.
//   - Its next regular time is worked out and written before anything is
//     sent, so a crash part way never sends the same run twice. Runs missed
//     while the server was down are run once, and only when the last one is
//     under LATE_HOURS (6) late; else it is marked late and not sent.
//   - It runs as its owner, checked at every run: an owner who has left, can
//     no longer open the report, or has lost the access the schedule needs
//     pauses it, and so does a report that needs changing or a send that
//     nothing could go out to. A pause tells the owner and the group's
//     owners (tellPaused()), and stays until someone resumes it.
//   - A send that fails for a passing reason (the email service or the
//     database busy, a time-out) is tried again RETRY_MINUTES after it was
//     due, while that is under LATE_HOURS late and before its next regular
//     run; one refused (a bad key, a bad address) waits for its next run.
//     MAX_FAILURES runs in a row that failed pause it.
//   - The run's "today" is the time it was due (ctx.at), so a retry an hour
//     later still sends the days the run was due for.

import { systemSql } from '../config/db.js'
import { ReportError } from './compile.js'
import { STARTER_PREFIX } from './starters/index.js'
import { loadTarget } from './target.js'
import { reportZone } from './run.js'
import { ownerPerson, prepareSend, deliver, tellPaused, pushOf } from './send.js'
import { nextRunAt, isLate, LATE_HOURS } from '../../../shared/reports/schedule.js'

export const RETRY_MINUTES = [5, 20, 50, 110, 230, 350]
export const MAX_FAILURES = 5
const LEASE_MINUTES = 10
const CLAIM = 20

const problemsOf = e => (Array.isArray(e?.problems) && e.problems.length ? e.problems.join('. ') : e?.message || 'It has a problem')
const timeText = (d, tz) => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  }
}

// The schedules due now, each held for LEASE_MINUTES.
async function claimDue() {
  return systemSql`
    UPDATE report_schedules s
       SET running_until = now() + make_interval(mins => ${LEASE_MINUTES})
     WHERE s.id IN (
       SELECT id FROM report_schedules
        WHERE enabled AND next_run_at <= now()
          AND (running_until IS NULL OR running_until < now())
        ORDER BY next_run_at
        LIMIT ${CLAIM}
        FOR UPDATE SKIP LOCKED)
 RETURNING s.*`
}

// A schedule's change after a run, whatever happened. Lets the lease go.
async function finish(row, set) {
  await systemSql`
    UPDATE report_schedules
       SET last_status = ${set.status}, last_error = ${set.error ? String(set.error).slice(0, 500) : null},
           last_run_at = now(),
           last_sent_at = CASE WHEN ${!!set.sent} THEN now() ELSE last_sent_at END,
           failures = ${set.failures}, running_until = NULL
     WHERE tenant_id = ${row.tenant_id} AND id = ${row.id}`
}

// Stop a schedule until someone resumes it, and say so.
async function pause(row, reason, { title = null, log = null } = {}) {
  await systemSql`
    UPDATE report_schedules
       SET enabled = false, paused_reason = ${String(reason).slice(0, 500)}, last_status = 'paused',
           last_error = ${String(reason).slice(0, 500)}, last_run_at = now(),
           retry_of = NULL, running_until = NULL, updated_at = now()
     WHERE tenant_id = ${row.tenant_id} AND id = ${row.id}`
  log?.info({ schedule: row.id, tenant: row.tenant_id }, 'Report schedule paused')
  await tellPaused(row, reason, { title, log })
}

/** Send one claimed schedule. Never throws: the outcome's word. */
async function runOne(row, log) {
  const now = new Date()
  const owner = await ownerPerson(row.tenant_id, row.owner_sub)
  if (!owner) {
    await pause(row, (row.owner_email || 'The person who set it up') + ' is no longer on the team', { log })
    return 'paused'
  }
  let target
  try {
    target = await loadTarget(row.report_id || STARTER_PREFIX + row.starter_key, owner)
  } catch (e) {
    const why = e instanceof ReportError
      ? 'The report needs changing before it can be sent: ' + problemsOf(e)
      : (owner.email || 'Its owner') + ' can no longer open the report it sends'
    await pause(row, why, { title: row.name, log })
    return 'paused'
  }
  const tz = await reportZone(row.tenant_id, target.spec, row.params).catch(() => 'Europe/London')
  const regular = nextRunAt(row.timing, now, tz)
  if (!regular) {
    await pause(row, 'Its timing has no day to run on', { title: target.name, log })
    return 'paused'
  }
  const due = row.retry_of || row.next_run_at
  // Moved on first: a crash from here on never sends this run twice.
  await systemSql`
    UPDATE report_schedules SET next_run_at = ${regular}, retry_of = NULL
     WHERE tenant_id = ${row.tenant_id} AND id = ${row.id}`

  if (isLate(due, now)) {
    await finish(row, {
      status: 'late', failures: row.failures,
      error: 'Due ' + timeText(due, tz) + ', but the server couldn\'t send it within ' + LATE_HOURS + ' hours, so it wasn\'t sent',
    })
    return 'late'
  }

  let plan
  try {
    plan = await prepareSend(owner, target, {
      kind: 'scheduled', recipients: row.recipients, delivery: row.delivery, condition: row.condition,
      params: row.params, personalOutside: row.personal_outside, name: row.name, message: row.message,
      push: pushOf(row),
    })
  } catch (e) {
    if (e?.statusCode && e.statusCode < 500) {
      await pause(row, e.message, { title: target.name, log })
      return 'paused'
    }
    throw e
  }

  const r = await deliver(owner, target, plan, { schedule: row, due, log })
  if (r.status === 'sent' || r.status === 'partly') {
    await finish(row, { status: r.status, error: r.error, sent: true, failures: 0 })
    return r.status
  }
  if (r.status === 'not_met') {
    await finish(row, { status: 'not_met', error: r.why, failures: 0 })
    return 'not_met'
  }
  if (r.refused) {
    await pause(row, r.error || 'It couldn\'t be sent', { title: target.name, log })
    return 'paused'
  }
  // Failed. A passing reason is tried again a little later, while the run is
  // still under LATE_HOURS late and before its next regular time.
  if (r.transient) {
    const dueMs = new Date(due).getTime()
    const at = RETRY_MINUTES.map(m => new Date(dueMs + m * 60000)).find(d => d.getTime() > now.getTime() + 30000)
    if (at && at.getTime() < regular.getTime() && at.getTime() - dueMs < LATE_HOURS * 3600000) {
      await systemSql`
        UPDATE report_schedules SET next_run_at = ${at}, retry_of = ${due}
         WHERE tenant_id = ${row.tenant_id} AND id = ${row.id} AND next_run_at = ${regular}`
      await finish(row, { status: 'failed', error: (r.error || 'It failed') + '. Trying again at ' + timeText(at, tz), failures: row.failures })
      return 'failed'
    }
  }
  const failures = (row.failures || 0) + 1
  if (failures >= MAX_FAILURES) {
    await pause(row, 'It failed ' + failures + ' times in a row. The last time: ' + (r.error || 'it failed'), { title: target.name, log })
    return 'paused'
  }
  await finish(row, { status: 'failed', error: r.error, failures })
  return 'failed'
}

/**
 * Send the schedules that are due. Never throws: a schedule that breaks is
 * logged, marked failed and let go, and the others carry on.
 */
export async function sweepSchedules(log) {
  const out = { claimed: 0, sent: 0, partly: 0, not_met: 0, failed: 0, late: 0, paused: 0 }
  let rows
  try {
    rows = await claimDue()
  } catch (err) {
    log?.error({ err }, 'Report schedules couldn\'t be claimed')
    return out
  }
  out.claimed = rows.length
  for (const row of rows) {
    try {
      const word = await runOne(row, log)
      out[word] = (out[word] || 0) + 1
    } catch (err) {
      log?.error({ err, schedule: row.id }, 'A report schedule broke')
      const failures = (row.failures || 0) + 1
      try {
        if (failures >= MAX_FAILURES) {
          await pause(row, 'It broke on the server ' + failures + ' times in a row', { title: row.name, log })
          out.paused++
          continue
        }
        // Broken before it moved on: tried again in five minutes, not every minute.
        await systemSql`
          UPDATE report_schedules SET next_run_at = now() + make_interval(mins => 5)
           WHERE tenant_id = ${row.tenant_id} AND id = ${row.id} AND next_run_at <= now()`
        await finish(row, { status: 'failed', error: 'It broke on the server', failures })
      } catch (e) {
        log?.error({ err: e, schedule: row.id }, 'A broken report schedule wasn\'t let go')
      }
      out.failed++
    }
  }
  return out
}
