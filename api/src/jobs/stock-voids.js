// src/jobs/stock-voids.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker and repeat.
// Gathered from this folder by loadJobs() (jobs/queues.js).

import { Queue, Worker } from 'bullmq'
import { connection, prefix } from './connection.js'

export const name  = 'stock-voids'
export const label = 'Till voids kept as waste'
// How often it repeats (ms): every 10 minutes.
export const every = 600_000
// Its place on the Status (lowest first).
export const order = 76
export const queue = new Queue(name, { connection, prefix })

// ── Till voids kept as waste ──────────────────────────────────
// Every 10 minutes (inventory phase 4b review fixes, migration 310;
// services/stockSvc.js sweepVoidWaste()): each till void marked wasted in the
// last 14 days with nothing kept for it yet is broken into its items by the
// recipe its dish uses and kept (stock_void_waste), so a dish leaving every
// menu, or a recipe changed, later never takes past waste out of on hand,
// the ledger or the Waste report. A read of stock keeps them too; this makes
// it happen within minutes of the void, whenever stock is read. System mode,
// each group in its own transaction, every query filtered by that group.
// Idempotent.

export function start(log) {
  const worker = new Worker(name, async () => {
    const { sweepVoidWaste } = await import('../services/stockSvc.js')
    const r = await sweepVoidWaste(log)
    if (r.voids) log.info(r, 'Till voids kept as waste')
  }, { connection, prefix })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Till voids sweep failed')
  })

  queue.add('sweep', {}, {
    repeat: { every },
    removeOnComplete: true,
    removeOnFail: 20,
  }).catch(err => log.warn({ err: err?.message }, 'Till voids sweep not scheduled (Redis?)'))

  return worker
}
