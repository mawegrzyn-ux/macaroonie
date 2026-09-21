// src/jobs/publishWorker.js
//
// BullMQ worker that fires a scheduled website publish. Scheduling itself
// (delay computation + jobId) lives in the route handler
// (POST /website/tenant-site/schedule-publish) — this file only processes
// the job when it comes due. Job data: { tenantId }. jobId is always
// `publish-{tenantId}` so re-scheduling replaces the pending job rather
// than stacking a second one (BullMQ dedups adds by jobId).

import { Worker } from 'bullmq'
import { env } from '../config/env.js'

const connection = { url: env.REDIS_URL }

export function startPublishWorker(log) {
  const worker = new Worker('website-publish', async job => {
    const { tenantId } = job.data
    log.info({ tenantId }, 'Running scheduled website publish')

    const { publishTenantSite } = await import('../services/publishSvc.js')
    await publishTenantSite(tenantId)
  }, { connection })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Scheduled publish job failed')
  })

  return worker
}
