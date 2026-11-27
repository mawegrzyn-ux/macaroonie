// src/jobs/cost-targets.js
//
// One background job (docs/PARALLEL_WORK.md 3.9): its queue, its row on the
// Platform page's Status (services/platformStatus.js JOBS), and start(),
// which server.js calls once per API process for its worker and repeat.
// Gathered from this folder by loadJobs() (jobs/queues.js).

import { Queue, Worker } from 'bullmq'
import { connection, prefix } from './connection.js'

export const name  = 'cost-targets'
export const label = 'Dishes over their cost target'
// How often it repeats (ms): every hour.
export const every = 3_600_000
// Its place on the Status (lowest first).
export const order = 78
export const queue = new Queue(name, { connection, prefix })

// ── Dishes over their cost target ─────────────────────────────
// Every hour (inventory phase 6b, migration 313; services/stockFoodCostSvc.js
// sweepCostTargets()): each group with recipe links has every venue's live
// menus costed at today's standard prices (menuMargins() in shared/costing.js
// at each order type); a dish newly over its cost target (or moved from over
// the target to over the limit) is kept in cost_target_states and offered to
// the group's rules once (the trigger dish_over_target), and so is a kept dish
// whose cost % went up (for a rule with a % of its own, as the rise passes it);
// a dish back under is forgotten, so going over again is a new event. Each group is one
// transaction under an advisory lock, so two processes never sweep one group
// at once, and a rule claims each event once (pepper_rule_firings). `app` runs
// the rules' actions through the routes, as the person who made each rule.

export function start(log, { app } = {}) {
  const worker = new Worker(name, async () => {
    const { sweepCostTargets } = await import('../services/stockFoodCostSvc.js')
    const r = await sweepCostTargets(app, log)
    if (r.crossed || r.rose || r.failed) log.info(r, 'Dishes over their cost target swept')
  }, { connection, prefix })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Cost targets job failed')
  })

  queue.add('sweep', {}, {
    repeat: { every },
    removeOnComplete: true,
    removeOnFail: 20,
  }).catch(err => log.warn({ err: err?.message }, 'Cost targets not scheduled (Redis?)'))

  return worker
}
