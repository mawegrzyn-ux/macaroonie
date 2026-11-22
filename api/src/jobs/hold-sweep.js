// src/jobs/hold-sweep.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker and repeat.
// Gathered from this folder by loadJobs() (jobs/queues.js).

import { Queue, Worker } from 'bullmq'
import { systemSql } from '../config/db.js'
import { connection, prefix } from './connection.js'

export const name  = 'hold-sweep'
export const label = 'Booking holds sweep'
// How often it repeats (ms); null for a queue that runs only when a job is added.
export const every = 60_000
// Its place on the Status (lowest first).
export const order = 10
export const queue = new Queue(name, { connection, prefix })

// The sweep reads every tenant (system mode), as server.js passed it.
const sql = systemSql

// ── Hold sweep worker ─────────────────────────────────────────
// Belt-and-suspenders: pg_cron handles it in DB,
// this handles edge cases where pg_cron isn't available.

export function start(log) {
  const worker = new Worker(name, async () => {
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
    // Kiosk receipts waiting for a counter order to be paid (migration 210):
    // sent once paid, given up when cancelled or unpaid after a day.
    const { sendWaitingReceipts } = await import('../services/receiptSvc.js')
    const mailed = await sendWaitingReceipts({ log })
    if (mailed) log.info({ mailed }, 'Kiosk receipts emailed after payment')
    // Loyalty (migration 211): unused rewards put back, sales settled again,
    // points past their expiry, then wallet cards that changed.
    const { sweepLoyalty, tenantSite } = await import('../services/loyaltySvc.js')
    const settled = await sweepLoyalty({ log })
    if (settled) log.info({ settled }, 'Loyalty settled')
    const { pushWalletUpdates } = await import('../services/walletSvc.js')
    const wallets = await pushWalletUpdates({ log, siteOf: tenantSite })
    if (wallets) log.info({ wallets }, 'Wallet cards updated')
    log.debug('Hold sweep complete')
  }, { connection, prefix })

  // Schedule repeating sweep every 60 seconds
  queue.add('sweep', {}, {
    repeat: { every },
    removeOnComplete: true,
  })

  return worker
}
