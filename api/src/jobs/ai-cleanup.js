// src/jobs/ai-cleanup.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker and repeat.
// Gathered from this folder by loadJobs() (jobs/queues.js).

import { Queue, Worker } from 'bullmq'
import { connection, prefix } from './connection.js'

export const name  = 'ai-cleanup'
export const label = 'Pepper clean-up'
// How often it repeats (ms); null for a queue that runs only when a job is added.
export const every = 3_600_000
// Its place on the Status (lowest first).
export const order = 70
export const queue = new Queue(name, { connection, prefix })

// ── AI clean-up worker ────────────────────────────────────────
// Every hour (migration 174, ai/erase.js cleanUpAi()): delete Pepper and
// website chats idle longer than the tenant's chat_retention_days, clear
// audit inputs older than a year, unsent uploads, used guest codes and old
// per-person usage; and kiosk visits' playbacks after 90 days (the visits
// after 400, services/kioskJourneySvc.js). Idempotent, so a run that
// overlaps another is harmless.

export function start(log) {
  const worker = new Worker(name, async () => {
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
    // Local info items (migration 240) after 400 days.
    const { cleanUpLocalInfo } = await import('../services/localInfoSvc.js')
    await cleanUpLocalInfo()
    // Records of report runs and files (migration 243) after 400 days.
    const { cleanUpReportRuns, cleanUpPrintLinks } = await import('../reports/access.js')
    await cleanUpReportRuns()
    // Print links (migration 244) a day after they ran out.
    await cleanUpPrintLinks()
    // Kept report files (migration 250) after their 7 or 30 days.
    const { cleanUpReportFiles } = await import('../reports/files.js')
    const rf = await cleanUpReportFiles()
    if (rf.removed || rf.folders) log.info(rf, 'Report file clean-up')
    // Sent task notices (migration 262) after 30 days.
    const { cleanUpNotices } = await import('../services/notices.js')
    await cleanUpNotices()
  }, { connection, prefix })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'AI clean-up job failed')
  })

  queue.add('cleanup', {}, {
    repeat: { every },
    removeOnComplete: true,
    removeOnFail: 20,
  }).catch(err => log.warn({ err: err?.message }, 'AI clean-up not scheduled (Redis?)'))

  return worker
}
