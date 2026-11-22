// src/jobs/cash-autofill.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker and repeat.
// Gathered from this folder by loadJobs() (jobs/queues.js).

import { Queue, Worker } from 'bullmq'
import { connection, prefix } from './connection.js'

export const name  = 'cash-autofill'
export const label = 'Cash Recon fill'
// How often it repeats (ms); null for a queue that runs only when a job is added.
export const every = 300_000
// Its place on the Status (lowest first).
export const order = 50
export const queue = new Queue(name, { connection, prefix })

// ── Cash Recon scheduled fill ─────────────────────────────────
// Every five minutes (migration 260, services/reconRetrieve.js): each venue
// with the scheduled fill on fills the day just ended and the two before
// from Loyverse and GloriaFood, once a day from its time. The repeat job
// runs across all API processes; each venue's day is claimed with one
// UPDATE (auto_fill_last_on), so it never runs twice.

export function start(log) {
  const worker = new Worker(name, async () => {
    const { sweepAutoFill } = await import('../services/reconRetrieve.js')
    const ran = await sweepAutoFill(log)
    if (ran) log.info({ ran }, 'Scheduled Cash Recon fills run')
  }, { connection, prefix })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Scheduled Cash Recon fill job failed')
  })

  queue.add('sweep', {}, {
    repeat: { every },
    removeOnComplete: true,
    removeOnFail: 20,
  }).catch(err => log.warn({ err: err?.message }, 'Scheduled Cash Recon fill not scheduled (Redis?)'))

  return worker
}
