// src/jobs/notifications.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker.
// Gathered from this folder by loadJobs() (jobs/queues.js).

import { Queue, Worker } from 'bullmq'
import { connection, prefix } from './connection.js'

export const name  = 'notifications'
export const label = 'Emails'
// How often it repeats (ms); null for a queue that runs only when a job is added.
export const every = null
// Its place on the Status (lowest first).
export const order = 80
export const queue = new Queue(name, { connection, prefix })

// ── Notification worker ───────────────────────────────────────
// Routes booking emails through the new pluggable email system
// (emailWorker.processEmailJob) which supports per-venue provider
// selection, template overrides, and merge-field rendering.

export function start(log) {
  const worker = new Worker(name, async job => {
    if (job.name === 'order_email') {
      const { processOrderEmailJob } = await import('./orderEmailWorker.js')
      log.info({ orderId: job.data.orderId, type: job.data.type }, 'Processing order email')
      return processOrderEmailJob({ data: job.data, log: msg => log.info(msg) })
    }
    const { bookingId, tenantId, venueId, type, manageBaseUrl } = job.data
    log.info({ bookingId, type }, 'Processing notification')

    const { processEmailJob } = await import('./emailWorker.js')
    await processEmailJob({
      data: { bookingId, tenantId, venueId, type, manageBaseUrl },
      log:  (msg) => log.info(msg),
    })

  }, { connection, prefix, concurrency: 5 })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Notification job failed')
  })

  return worker
}
