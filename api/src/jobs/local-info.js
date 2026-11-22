// src/jobs/local-info.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker and repeat.
// Gathered from this folder by loadJobs() (jobs/queues.js).

import { Queue, Worker } from 'bullmq'
import { connection, prefix } from './connection.js'

export const name  = 'local-info'
export const label = 'Local info captures'
// How often it repeats (ms); null for a queue that runs only when a job is added.
export const every = 300_000
// Its place on the Status (lowest first).
export const order = 40
export const queue = new Queue(name, { connection, prefix })

// ── Local info worker ─────────────────────────────────────────
// Every few minutes (migration 240, services/localInfoSvc.js): run the
// local-information captures that are due — weather from Open-Meteo, the
// web-search kinds through Pepper's model. The repeat job runs across all
// API processes; each source is claimed with running_until (SKIP LOCKED),
// so two processes never run one source at once.

export function start(log) {
  const worker = new Worker(name, async () => {
    const { sweepLocalInfo } = await import('../services/localInfoSvc.js')
    const ran = await sweepLocalInfo(log)
    if (ran) log.info({ ran }, 'Local info captures run')
  }, { connection, prefix })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Local info job failed')
  })

  queue.add('sweep', {}, {
    repeat: { every },
    removeOnComplete: true,
    removeOnFail: 20,
  }).catch(err => log.warn({ err: err?.message }, 'Local info sweep not scheduled (Redis?)'))

  return worker
}
