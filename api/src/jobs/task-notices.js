// src/jobs/task-notices.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker and repeat.
// Gathered from this folder by loadJobs() (jobs/queues.js).

import { Queue, Worker } from 'bullmq'
import { connection, prefix } from './connection.js'

export const name  = 'task-notices'
export const label = 'Task notices'
// How often it repeats (ms); null for a queue that runs only when a job is added.
export const every = 300_000
// Its place on the Status (lowest first).
export const order = 60
export const queue = new Queue(name, { connection, prefix })

// ── Task notices ──────────────────────────────────────────────
// Every five minutes (migration 262, services/notices.js): late and
// due-soon Today tasks pushed to the people who can do them, each once
// (task_notices is claimed before sending, so overlapping runs or several
// API processes never send one twice). `app` runs the routes the feed reads.

export function start(log, { app } = {}) {
  const worker = new Worker(name, async () => {
    const { sweepNotices } = await import('../services/notices.js')
    const r = await sweepNotices(app, log)
    if (r.sent) log.info(r, 'Task notices sent')
  }, { connection, prefix })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Task notices job failed')
  })

  queue.add('sweep', {}, {
    repeat: { every },
    removeOnComplete: true,
    removeOnFail: 20,
  }).catch(err => log.warn({ err: err?.message }, 'Task notices not scheduled (Redis?)'))

  return worker
}
