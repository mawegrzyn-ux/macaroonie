// src/services/platformStatus.js
//
// Whether the platform is up (22 Nov 2026, OUTSTANDING 45 and 44.7): the
// Platform page's Status (platform admins, everything below) and one light
// for each venue's Tech board (everyone signed in: up, degraded or down,
// nothing else).
//
// The API runs as several PM2 processes, so nothing here lives in a module
// variable that another process must see: each process writes a heartbeat
// to Redis every BEAT_MS (gone after BEAT_TTL_S), and each background job
// writes when it last finished or failed (watchWorker()). Checked live on
// each request: Postgres (SELECT 1, size, connections), Redis (PING, memory),
// the job queues' counts, the machine (disk, memory, load) and the deployed
// commit (read from .git).
//
//   startProcessBeat(log)       call once after listen; returns stop()
//   watchWorker(name, worker)   records a BullMQ worker's last finish / failure
//   platformStatus()            the whole picture, for platform admins
//   lightStatus()               { state, checked_at }: cached for LIGHT_TTL_S
// Alerts by email when it turns red: services/platformAlerts.js (its last
// alert is `alert` in platformStatus()).

import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import IORedis from 'ioredis'
import { systemSql } from '../config/db.js'
import { env } from '../config/env.js'

const PREFIX = 'mac:status:'
const BEAT_MS = 30_000
const BEAT_TTL_S = 90
const LIGHT_TTL_S = 20
const STARTED_AT = new Date().toISOString()

// The background jobs and how often each repeats (jobs/queues.js); a job
// counts as late after three of its intervals and a minute more. On-demand
// queues (emails, publishing, review reading) have no interval.
export const JOBS = [
  { name: 'hold-sweep',       label: 'Booking holds sweep',   every: 60_000 },
  { name: 'gloriafood-poll',  label: 'GloriaFood orders',     every: 60_000 },
  { name: 'report-schedules', label: 'Scheduled reports',     every: 60_000 },
  { name: 'local-info',       label: 'Local info captures',   every: 300_000 },
  { name: 'cash-autofill',    label: 'Cash Recon fill',       every: 300_000 },
  { name: 'task-notices',     label: 'Task notices',          every: 300_000 },
  { name: 'ai-cleanup',       label: 'Pepper clean-up',       every: 3_600_000 },
  { name: 'notifications',    label: 'Emails',                every: null },
  { name: 'website-publish',  label: 'Website publishing',    every: null },
  { name: 'review-scrape',    label: 'Review reading',        every: null },
]
const late = (job, lastAt, now) => job.every != null && lastAt != null && now - lastAt > job.every * 3 + 60_000

// The API's own queue objects (jobs/queues.js), by name, loaded when first asked.
let queueMap = null
async function queues() {
  if (!queueMap) {
    const q = await import('../jobs/queues.js')
    queueMap = Object.fromEntries([q.notificationQueue, q.holdSweepQueue, q.reviewScrapeQueue, q.publishQueue,
      q.gloriafoodQueue, q.aiCleanupQueue, q.localInfoQueue, q.reportScheduleQueue, q.cashAutoFillQueue,
      q.taskNoticeQueue].filter(Boolean).map(x => [x.name, x]))
  }
  return queueMap
}

let redis = null
function client() {
  if (!redis) {
    redis = new IORedis(env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1, lazyConnect: false })
    redis.on('error', () => {})   // a Redis outage shows on the board, not in the log every second
  }
  return redis
}

/** Waits (briefly) for the connection: commands before it are refused, not queued. */
async function ready(r, ms = 1500) {
  if (r.status === 'ready') return r
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => { r.off('ready', ok); reject(new Error('Redis didn\'t answer.')) }, ms)
    function ok() { clearTimeout(t); resolve() }
    r.once('ready', ok)
  })
  return r
}

// ── What each process writes ───────────────────────────────────

/** This process's heartbeat in Redis, every BEAT_MS. */
export function startProcessBeat(log = null) {
  const key = PREFIX + 'proc:' + os.hostname() + ':' + process.pid
  const beat = () => {
    const mem = process.memoryUsage()
    ready(client(), 5000).then(r => r.set(key, JSON.stringify({
      host: os.hostname(), pid: process.pid, started_at: STARTED_AT, beat_at: new Date().toISOString(),
      rss_mb: Math.round(mem.rss / 1048576), heap_mb: Math.round(mem.heapUsed / 1048576),
      node: process.version, instance: process.env.NODE_APP_INSTANCE ?? null,
    }), 'EX', BEAT_TTL_S)).catch(err => log?.debug?.({ err }, 'status heartbeat failed'))
  }
  beat()
  const timer = setInterval(beat, BEAT_MS)
  timer.unref?.()
  return () => { clearInterval(timer); client().del(key).catch(() => {}) }
}

/** Records when a worker last finished and failed (with the error), for the board. */
export function watchWorker(name, worker) {
  if (!worker?.on) return
  worker.on('completed', () => { ready(client(), 5000).then(r => r.set(PREFIX + 'job:' + name + ':done', String(Date.now()))).catch(() => {}) })
  worker.on('failed', (_job, err) => {
    ready(client(), 5000).then(r => r.set(PREFIX + 'job:' + name + ':failed', JSON.stringify({ at: Date.now(), error: String(err?.message || err).slice(0, 300) }))).catch(() => {})
  })
}

// ── Reading it ─────────────────────────────────────────────────

const timed = async fn => {
  const t = Date.now()
  try {
    const out = await fn()
    return { ok: true, ...out, ms: Date.now() - t }
  } catch (err) {
    return { ok: false, ms: Date.now() - t, error: String(err?.message || err).slice(0, 200) }
  }
}

async function database() {
  return timed(async () => {
    const [row] = await systemSql`
      SELECT pg_database_size(current_database())::bigint AS size,
             (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections,
             current_setting('server_version') AS version`
    return { size_mb: Math.round(Number(row.size) / 1048576), connections: row.connections, version: row.version }
  })
}

async function redisCheck() {
  return timed(async () => {
    const r = await ready(client())
    const pong = await r.ping()
    if (pong !== 'PONG') throw new Error('Redis answered ' + pong)
    const info = await r.info('memory')
    const used = /used_memory_human:(\S+)/.exec(info)?.[1] || null
    return { used_memory: used }
  })
}

async function processes() {
  const r = client()
  const keys = await r.keys(PREFIX + 'proc:*')
  if (!keys.length) return []
  const vals = await r.mget(keys)
  return vals.filter(Boolean).map(v => { try { return JSON.parse(v) } catch { return null } }).filter(Boolean)
    .sort((a, b) => String(a.host).localeCompare(b.host) || a.pid - b.pid)
}

async function jobs(now) {
  const r = client()
  return Promise.all(JOBS.map(async job => {
    const out = { name: job.name, label: job.label, every_s: job.every ? job.every / 1000 : null }
    try {
      const [done, failed] = await r.mget(PREFIX + 'job:' + job.name + ':done', PREFIX + 'job:' + job.name + ':failed')
      const lastAt = done ? Number(done) : null
      const fail = failed ? JSON.parse(failed) : null
      const q = (await queues())[job.name]
      if (q) out.counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed')
      out.last_done_at = lastAt ? new Date(lastAt).toISOString() : null
      out.last_failed_at = fail ? new Date(fail.at).toISOString() : null
      out.last_error = fail?.error ?? null
      out.late = late(job, lastAt, now)
    } catch (err) {
      out.error = String(err?.message || err).slice(0, 200)
    }
    return out
  }))
}

function machine() {
  let disk = null
  try {
    const s = fs.statfsSync('/')
    const total = s.blocks * s.bsize
    const free = s.bavail * s.bsize
    disk = { total_gb: +(total / 1e9).toFixed(1), free_gb: +(free / 1e9).toFixed(1), free_pct: Math.round(free / total * 100) }
  } catch { /* not every system */ }
  const total = os.totalmem(), free = os.freemem()
  return {
    host: os.hostname(), cpus: os.cpus().length, load: os.loadavg().map(n => +n.toFixed(2)),
    memory: { total_gb: +(total / 1e9).toFixed(1), free_gb: +(free / 1e9).toFixed(1), free_pct: Math.round(free / total * 100) },
    disk, uptime_h: Math.round(os.uptime() / 3600),
  }
}

/** The deployed commit, read from the checkout's .git (no git command). */
function deployed() {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
    const head = fs.readFileSync(path.join(root, '.git/HEAD'), 'utf8').trim()
    if (!head.startsWith('ref:')) return { commit: head.slice(0, 7), branch: null }
    const ref = head.slice(4).trim()
    let sha = null
    try { sha = fs.readFileSync(path.join(root, '.git', ref), 'utf8').trim() } catch {
      const packed = fs.readFileSync(path.join(root, '.git/packed-refs'), 'utf8')
      sha = packed.split('\n').find(l => l.endsWith(' ' + ref))?.split(' ')[0] || null
    }
    return { commit: sha ? sha.slice(0, 7) : null, branch: ref.replace('refs/heads/', '') }
  } catch { return { commit: null, branch: null } }
}

/**
 * The state from the checks: down when the database can't be reached;
 * degraded when Redis can't (pushes, jobs and the queue stop), a repeating
 * job is late, or the disk is nearly full; else up. Reasons say which.
 */
export function stateOf({ db, redis: rd, jobs: js = [], machine: m = null }) {
  const reasons = []
  if (!db?.ok) return { state: 'down', reasons: ['The database can\'t be reached.'] }
  if (!rd?.ok) reasons.push('Redis can\'t be reached: live updates, emails and background jobs wait.')
  for (const j of js) if (j.late) reasons.push(j.label + ' hasn\'t run for a while.')
  if (m?.disk && m.disk.free_pct < 10) reasons.push('The disk is ' + (100 - m.disk.free_pct) + '% full.')
  return { state: reasons.length ? 'degraded' : 'up', reasons }
}

export async function platformStatus() {
  const now = Date.now()
  const [db, rd] = await Promise.all([database(), redisCheck()])
  const [procs, js] = rd.ok ? await Promise.all([processes(), jobs(now)]) : [[], []]
  const m = machine()
  const { state, reasons } = stateOf({ db, redis: rd, jobs: js, machine: m })
  // What the alerts last sent (services/platformAlerts.js), when Redis answers.
  let alert = null
  if (rd.ok) { try { const raw = await client().get(PREFIX + 'alert:last'); alert = raw ? JSON.parse(raw) : null } catch { alert = null } }
  return {
    state, reasons, checked_at: new Date(now).toISOString(), alert,
    deployed: deployed(), node_env: env.NODE_ENV,
    database: db, redis: rd, processes: procs, jobs: js, machine: m,
  }
}

/** The one light a venue sees: up, degraded or down. Kept in Redis for a few seconds, as many screens ask. */
export async function lightStatus() {
  const r = client()
  await ready(r).catch(() => {})
  try {
    const kept = await r.get(PREFIX + 'light')
    if (kept) return JSON.parse(kept)
  } catch { /* Redis down: worked out below */ }
  const now = Date.now()
  const [db, rd] = await Promise.all([database(), redisCheck()])
  let js = []
  if (rd.ok) {
    js = await Promise.all(JOBS.filter(j => j.every).map(async j => {
      const done = await r.get(PREFIX + 'job:' + j.name + ':done').catch(() => null)
      return { label: j.label, late: late(j, done ? Number(done) : null, now) }
    }))
  }
  const out = { state: stateOf({ db, redis: rd, jobs: js, machine: machine() }).state, checked_at: new Date(now).toISOString() }
  if (rd.ok) r.set(PREFIX + 'light', JSON.stringify(out), 'EX', LIGHT_TTL_S).catch(() => {})
  return out
}
