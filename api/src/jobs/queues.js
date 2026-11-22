// src/jobs/queues.js
//
// The background jobs, gathered from this folder (docs/PARALLEL_WORK.md 3.9).
// Each job is a file of its own, api/src/jobs/<name>.js, named after its
// BullMQ queue, exporting:
//
//   name    the queue's name (the file's name too)
//   label   its row on the Platform page's Status
//   every   how often it repeats in ms, or null when it runs only when a job is added
//   order   its place on the Status (lowest first; ties by name)
//   queue   its Queue (other code adds jobs to it)
//   start(log, { app })   starts its worker (and its repeat), returns the worker
//
// loadJobs() reads them: server.js starts every worker and watches it, and
// JOBS (services/platformStatus.js) is the Status's list. Files without a
// name and start() are helpers (connection.js, emailWorker.js, ...).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export { connection, prefix } from './connection.js'

// The queues other code adds jobs to, by the names it has always imported.
// A new job's queue is imported from its own file instead
// (import { queue } from '../jobs/<name>.js').
export { queue as notificationQueue }   from './notifications.js'
export { queue as holdSweepQueue }      from './hold-sweep.js'
export { queue as reviewScrapeQueue }   from './review-scrape.js'
export { queue as publishQueue }        from './website-publish.js'
export { queue as gloriafoodQueue }     from './gloriafood-poll.js'
export { queue as aiCleanupQueue }      from './ai-cleanup.js'
export { queue as localInfoQueue }      from './local-info.js'
export { queue as reportScheduleQueue } from './report-schedules.js'
export { queue as cashAutoFillQueue }   from './cash-autofill.js'
export { queue as taskNoticeQueue }     from './task-notices.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SELF = path.basename(fileURLToPath(import.meta.url))

let loading = null

/** Every job in this folder, in Status order. Read once per process. */
export function loadJobs() {
  loading ||= (async () => {
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js') && f !== SELF).sort()
    const jobs = []
    for (const file of files) {
      const m = await import(pathToFileURL(path.join(DIR, file)).href)
      if (typeof m.name !== 'string' || typeof m.start !== 'function') continue
      if (m.name + '.js' !== file) throw new Error('jobs/' + file + ': the job is named ' + m.name + '; a job\'s file is named after its queue')
      if (!m.queue || m.queue.name !== m.name) throw new Error('jobs/' + file + ': export the job\'s Queue as `queue`')
      jobs.push({ name: m.name, label: m.label, every: m.every ?? null, order: m.order ?? 0, queue: m.queue, start: m.start })
    }
    return jobs.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  })()
  return loading
}
