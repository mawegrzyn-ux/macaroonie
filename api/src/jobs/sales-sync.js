// src/jobs/sales-sync.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker and repeat.
// Gathered from this folder by loadJobs() (jobs/queues.js).

import { Queue, Worker } from 'bullmq'
import { connection, prefix } from './connection.js'

export const name  = 'sales-sync'
export const label = 'Sales from other tills'
// How often it repeats (ms); null for a queue that runs only when a job is added.
export const every = 60_000
// Its place on the Status (lowest first).
export const order = 55
export const queue = new Queue(name, { connection, prefix })

// ── Sales from other tills (docs/SALES_IMPORT.md, migrations 288 to 290) ──
// Every minute, the sweep syncs each connection whose 15-minute catch-up is
// due, that was asked for (Sync now, the webhook, a new venue link), or has
// history left (services/salesImportSvc.js sweepDue()); a 'sync' job added by
// requestSync() runs one connection straight away. The repeat runs once
// across all API processes, and each connection is claimed
// (pos_connections.sync_claimed_until) so two processes never sync it at once.
// A 'remap' job (itemMappingSvc.requestRemap(), after an item mapping rule is
// saved or deleted, migration 292) maps a connection's stored lines again
// from the rule's effective_from; the sweep also runs any whose job was lost.

export function start(log) {
  const worker = new Worker(name, async job => {
    const svc = await import('../services/salesImportSvc.js')
    if (job.name === 'sync' && job.data?.connectionId) {
      const r = await svc.syncConnection(job.data.tenantId, job.data.connectionId, { log })
      if (r.error) log.warn({ connectionId: job.data.connectionId, err: r.error }, 'Sales sync failed')
      return
    }
    if (job.name === 'remap' && job.data?.connectionId) {
      const mapping = await import('../services/itemMappingSvc.js')
      await mapping.remapConnection(job.data.tenantId, job.data.connectionId, { log })
      return
    }
    const ran = await svc.sweepDue(log)
    if (ran) log.info({ ran }, 'Sales from other tills synced')
  }, { connection, prefix })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Sales sync job failed')
  })

  queue.add('sweep', {}, {
    repeat: { every },
    removeOnComplete: true,
    removeOnFail: 20,
  }).catch(err => log.warn({ err: err?.message }, 'Sales sync not scheduled (Redis?)'))

  return worker
}
