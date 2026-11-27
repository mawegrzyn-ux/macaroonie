// src/jobs/stock-usage.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker and repeat.
// Gathered from this folder by loadJobs() (jobs/queues.js).

import { Queue, Worker } from 'bullmq'
import { connection, prefix } from './connection.js'

export const name  = 'stock-usage'
export const label = 'Usage from sales'
// How often it repeats (ms): every 5 minutes.
export const every = 300_000
// Its place on the Status (lowest first).
export const order = 77
export const queue = new Queue(name, { connection, prefix })

// ── Usage from sales ──────────────────────────────────────────
// Every 5 minutes (inventory phase 5, migration 311; services/stockUsageSvc.js
// sweepStockUsage()): each venue of a group with recipes has its trading days
// worked out: what sold on the till, kiosks, online and on other tills,
// broken into items by the recipes (usageOf() in shared/costing.js), kept in
// stock_usage_days and dish_cost_days. A day of the last 14 is worked out
// again only when its sales changed (late sales), a recipe, link, option
// rule or setting marked it, or it never was; closed periods are never
// changed (phase 6). The repeat runs in every API process; each venue is
// claimed with a lease in Postgres (stock_usage_venues.running_until, FOR
// UPDATE SKIP LOCKED), so two processes never work one venue out at once.
// System mode, every query filtered by the venue's group. Idempotent.

export function start(log) {
  const worker = new Worker(name, async () => {
    const { sweepStockUsage } = await import('../services/stockUsageSvc.js')
    const r = await sweepStockUsage(log)
    if (r.days || r.failed) log.info({ venues: r.venues, days: r.days, failed: r.failed }, 'Usage from sales worked out')
  }, { connection, prefix })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Usage from sales job failed')
  })

  queue.add('sweep', {}, {
    repeat: { every },
    removeOnComplete: true,
    removeOnFail: 20,
  }).catch(err => log.warn({ err: err?.message }, 'Usage from sales not scheduled (Redis?)'))

  return worker
}
