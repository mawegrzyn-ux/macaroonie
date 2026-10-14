// src/jobs/queues.js
import { Queue, Worker } from 'bullmq'
import { env } from '../config/env.js'

const connection = { url: env.REDIS_URL }

export const notificationQueue  = new Queue('notifications',    { connection })
export const holdSweepQueue     = new Queue('hold-sweep',       { connection })
export const reviewScrapeQueue  = new Queue('review-scrape',    { connection })
export const publishQueue       = new Queue('website-publish',  { connection })
export const gloriafoodQueue    = new Queue('gloriafood-poll',  { connection })

// ── Notification worker ───────────────────────────────────────
// Routes booking emails through the new pluggable email system
// (emailWorker.processEmailJob) which supports per-venue provider
// selection, template overrides, and merge-field rendering.

export function startNotificationWorker(log) {
  const worker = new Worker('notifications', async job => {
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
    // Unpaid online orders give their collection slot back too.
    const { expireStaleOrders } = await import('../services/orderSvc.js')
    const expired = await expireStaleOrders(log)
    if (expired) log.info({ expired }, 'Expired unpaid orders')
    log.debug('Hold sweep complete')
  }, { connection })

  // Schedule repeating sweep every 60 seconds
  holdSweepQueue.add('sweep', {}, {
    repeat: { every: 60_000 },
    removeOnComplete: true,
  })

  return worker
}

// ── GloriaFood poll worker ────────────────────────────────────
// Every minute: collect accepted orders for venues set to poll GloriaFood
// (migration 159), and clear guest details from old GloriaFood orders.
// The repeat job runs once per minute across all API processes; each venue
// is also guarded by an advisory lock (gloriafoodSvc.pollVenue).

export function startGloriaFoodPollWorker(log) {
  const worker = new Worker('gloriafood-poll', async () => {
    const { pollAll } = await import('../services/gloriafoodSvc.js')
    const r = await pollAll(log)
    if (r.stored) log.info(r, 'GloriaFood orders collected')
  }, { connection })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'GloriaFood poll job failed')
  })

  gloriafoodQueue.add('poll', {}, {
    repeat: { every: 60_000 },
    removeOnComplete: true,
    removeOnFail: 50,
  }).catch(err => log.warn({ err: err?.message }, 'GloriaFood poll not scheduled (Redis?)'))

  return worker
}
