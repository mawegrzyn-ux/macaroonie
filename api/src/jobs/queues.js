// src/jobs/queues.js
import { Queue, Worker } from 'bullmq'
import { env } from '../config/env.js'

const connection = { url: env.REDIS_URL }

export const notificationQueue  = new Queue('notifications',    { connection })
export const holdSweepQueue     = new Queue('hold-sweep',       { connection })
export const reviewScrapeQueue  = new Queue('review-scrape',    { connection })

// ── Notification worker ───────────────────────────────────────
// Routes booking emails through the new pluggable email system
// (emailWorker.processEmailJob) which supports per-venue provider
// selection, template overrides, and merge-field rendering.

export function startNotificationWorker(log) {
  const worker = new Worker('notifications', async job => {
    const { bookingId, tenantId, venueId, type, manageBaseUrl } = job.data
    log.info({ bookingId, type }, 'Processing notification')

    const { processEmailJob } = await import('./emailWorker.js')
    await processEmailJob({
      data: { bookingId, tenantId, venueId, type, manageBaseUrl },
      log:  (msg) => log.info(msg),
    })

  }, { connection, concurrency: 5 })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Notification job failed')
  })

  return worker
}

// ── Hold sweep worker ─────────────────────────────────────────
// Belt-and-suspenders: pg_cron handles it in DB,
// this handles edge cases where pg_cron isn't available.

export function startHoldSweepWorker(sql, log) {
  const worker = new Worker('hold-sweep', async () => {
    const result = await sql`SELECT sweep_expired_holds()`
    log.debug('Hold sweep complete')
  }, { connection })

  // Schedule repeating sweep every 60 seconds
  holdSweepQueue.add('sweep', {}, {
    repeat: { every: 60_000 },
    removeOnComplete: true,
  })

  return worker
}
