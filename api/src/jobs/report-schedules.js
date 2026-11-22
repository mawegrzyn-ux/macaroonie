// src/jobs/report-schedules.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker and repeat.
// Gathered from this folder by loadJobs() (jobs/queues.js).

import { Queue, Worker } from 'bullmq'
import { connection, prefix } from './connection.js'

export const name  = 'report-schedules'
export const label = 'Scheduled reports'
// How often it repeats (ms); null for a queue that runs only when a job is added.
export const every = 60_000
// Its place on the Status (lowest first).
export const order = 30
export const queue = new Queue(name, { connection, prefix })

// ── Report schedules worker ───────────────────────────────────
// Every minute (migration 251, reports/schedules.js): send the report
// schedules that are due, each as its owner. The repeat job runs across all
// API processes; each schedule is claimed with running_until (SKIP LOCKED),
// so two processes never send one at once.

export function start(log) {
  const worker = new Worker(name, async () => {
    const { sweepSchedules } = await import('../reports/schedules.js')
    const r = await sweepSchedules(log)
    if (r.claimed) log.info(r, 'Report schedules sent')
  }, { connection, prefix })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Report schedules job failed')
  })

  queue.add('sweep', {}, {
    repeat: { every },
    removeOnComplete: true,
    removeOnFail: 20,
  }).catch(err => log.warn({ err: err?.message }, 'Report schedules not scheduled (Redis?)'))

  return worker
}
