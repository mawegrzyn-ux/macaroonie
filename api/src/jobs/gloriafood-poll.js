// src/jobs/gloriafood-poll.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker and repeat.
// Gathered from this folder by loadJobs() (jobs/queues.js).

import { Queue, Worker } from 'bullmq'
import { connection, prefix } from './connection.js'

export const name  = 'gloriafood-poll'
export const label = 'GloriaFood orders'
// How often it repeats (ms); null for a queue that runs only when a job is added.
export const every = 60_000
// Its place on the Status (lowest first).
export const order = 20
export const queue = new Queue(name, { connection, prefix })

// ── GloriaFood poll worker ────────────────────────────────────
// Every minute: collect accepted orders for venues set to poll GloriaFood
// (migration 159), and clear guest details from old GloriaFood orders.
// The repeat job runs once per minute across all API processes; each venue
// is also guarded by an advisory lock (gloriafoodSvc.pollVenue).

export function start(log) {
  const worker = new Worker(name, async () => {
    const { pollAll } = await import('../services/gloriafoodSvc.js')
    const r = await pollAll(log)
    if (r.stored) log.info(r, 'GloriaFood orders collected')
  }, { connection, prefix })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'GloriaFood poll job failed')
  })

  queue.add('poll', {}, {
    repeat: { every },
    removeOnComplete: true,
    removeOnFail: 50,
  }).catch(err => log.warn({ err: err?.message }, 'GloriaFood poll not scheduled (Redis?)'))

  return worker
}
