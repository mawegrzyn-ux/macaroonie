// src/jobs/queues.js
import { Queue, Worker } from 'bullmq'
import { env } from '../config/env.js'

const connection = { url: env.REDIS_URL }

export const notificationQueue  = new Queue('notifications',    { connection })
export const holdSweepQueue     = new Queue('hold-sweep',       { connection })
export const reviewScrapeQueue  = new Queue('review-scrape',    { connection })
export const publishQueue       = new Queue('website-publish',  { connection })
export const gloriafoodQueue    = new Queue('gloriafood-poll',  { connection })
export const aiCleanupQueue     = new Queue('ai-cleanup',       { connection })

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
    // Scheduled menu publishes that went live: tell tills and screens (migration 165).
    const { announceDueReleases } = await import('../services/menuReleases.js')
    const announced = await announceDueReleases(log)
    if (announced) log.info({ announced }, 'Menu publishes went live')
    // Orders for later whose time has come print at the kitchen printers (migration 191).
    const { kitchenPrintsDue } = await import('../services/kitchenSvc.js')
    const printed = await kitchenPrintsDue(log)
    if (printed) log.info({ printed }, 'Kitchen tickets came due')
    // Card payments a till or kiosk stopped watching: ask the provider once
    // more, so Store tech shows how they ended (migration 193).
    const { sweepPending } = await import('../services/cardSvc.js')
    const cards = await sweepPending().catch(e => { log.warn({ err: e }, 'Card payment sweep failed'); return 0 })
    if (cards) log.info({ cards }, 'Card payments checked')
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

// ── AI clean-up worker ────────────────────────────────────────
// Every hour (migration 174, ai/erase.js cleanUpAi()): delete Pepper and
// website chats idle longer than the tenant's chat_retention_days, clear
// audit inputs older than a year, unsent uploads, used guest codes and old
// per-person usage; and kiosk visits' playbacks after 90 days (the visits
// after 400, services/kioskJourneySvc.js). Idempotent, so a run that
// overlaps another is harmless.

export function startAiCleanupWorker(log) {
  const worker = new Worker('ai-cleanup', async () => {
    const { cleanUpAi } = await import('../ai/erase.js')
    const r = await cleanUpAi(log)
    if (r.chats || r.audit || r.uploads) log.info(r, 'AI clean-up')
    // Kiosk visits (migration 208): playbacks after 90 days, visits after 400.
    const { cleanUpJourneys } = await import('../services/kioskJourneySvc.js')
    const k = await cleanUpJourneys(log)
    if (k.cleared || k.removed) log.info(k, 'Kiosk journey clean-up')
    // Guests' receipt pages from kiosks (migration 209) after 400 days.
    const { cleanUpReceipts } = await import('../services/receiptSvc.js')
    const rc = await cleanUpReceipts(log)
    if (rc.removed) log.info(rc, 'Kiosk receipt clean-up')
  }, { connection })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'AI clean-up job failed')
  })

  aiCleanupQueue.add('cleanup', {}, {
    repeat: { every: 3_600_000 },
    removeOnComplete: true,
    removeOnFail: 20,
  }).catch(err => log.warn({ err: err?.message }, 'AI clean-up not scheduled (Redis?)'))

  return worker
}
