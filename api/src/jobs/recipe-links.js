// src/jobs/recipe-links.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker and repeat.
// Gathered from this folder by loadJobs() (jobs/queues.js).

import { Queue, Worker } from 'bullmq'
import { connection, prefix } from './connection.js'

export const name  = 'recipe-links'
export const label = 'Recipe links sweep'
// How often it repeats (ms): once a day.
export const every = 86_400_000
// Its place on the Status (lowest first).
export const order = 75
export const queue = new Queue(name, { connection, prefix })

// ── Recipe links sweep ────────────────────────────────────────
// Once a day (inventory phase 2, migration 302; services/dishCostSvc.js
// sweepRecipeLinks()): a recipe link or a dish's own option rule whose dish
// is on no menu, draft or live, is marked missing_since; one whose dish is
// back is cleared; what has been missing for 30 days is deleted. Menu dishes
// are pointed at by plain ids (the menu save re-inserts them), so nothing
// else takes the links of a dish that is gone. System mode, each tenant in
// its own transaction, every query filtered by that tenant. Idempotent.

export function start(log) {
  const worker = new Worker(name, async () => {
    const { sweepRecipeLinks } = await import('../services/dishCostSvc.js')
    const r = await sweepRecipeLinks(log)
    if (r.marked || r.back || r.deleted) log.info(r, 'Recipe links sweep')
  }, { connection, prefix })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Recipe links sweep failed')
  })

  queue.add('sweep', {}, {
    repeat: { every },
    removeOnComplete: true,
    removeOnFail: 20,
  }).catch(err => log.warn({ err: err?.message }, 'Recipe links sweep not scheduled (Redis?)'))

  return worker
}
