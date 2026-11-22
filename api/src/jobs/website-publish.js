// src/jobs/website-publish.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker.
// Gathered from this folder by loadJobs() (jobs/queues.js).
//
// BullMQ worker that fires a scheduled website publish. Scheduling itself
// (delay computation + jobId) lives in the route handler
// (POST /website/tenant-site/schedule-publish) — this file only processes
// the job when it comes due. Job data: { tenantId }. jobId is always
// `publish-{tenantId}` so re-scheduling replaces the pending job rather
// than stacking a second one (BullMQ dedups adds by jobId).

import { Queue, Worker } from 'bullmq'
import { connection, prefix } from './connection.js'

export const name  = 'website-publish'
export const label = 'Website publishing'
// How often it repeats (ms); null for a queue that runs only when a job is added.
export const every = null
// Its place on the Status (lowest first).
export const order = 90
export const queue = new Queue(name, { connection, prefix })

export function start(log) {
  const worker = new Worker(name, async job => {
    const { tenantId } = job.data
    log.info({ tenantId }, 'Running scheduled website publish')

    const { publishTenantSite } = await import('../services/publishSvc.js')
    await publishTenantSite(tenantId)
  }, { connection, prefix })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Scheduled publish job failed')
  })

  return worker
}
