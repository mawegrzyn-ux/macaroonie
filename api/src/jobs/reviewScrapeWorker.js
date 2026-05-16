// src/jobs/reviewScrapeWorker.js
//
// BullMQ worker that processes review-scrape jobs.
// Job data: { jobId, tenantId, venueId, platform, placeId, maxReviews, apiKey }
//
// Flow:
//   1. Start the Apify actor run
//   2. Update review_scrape_jobs: status = running, apify_run_id
//   3. Poll Apify every 15 s until done (or timeout after 10 min)
//   4. Fetch results, normalise, upsert into reviews table
//   5. Update review_scrape_jobs: status = done, result_count

import { Worker } from 'bullmq'
import { env }    from '../config/env.js'
import { withTenant, sql } from '../config/db.js'
import {
  startGoogleReviewsScrape,
  getRunStatus,
  getRunResults,
  normaliseGoogleReview,
} from '../services/apifySvc.js'

const connection = { url: env.REDIS_URL }
const POLL_INTERVAL_MS = 15_000
const MAX_WAIT_MS      = 600_000  // 10 min

async function pollUntilDone(runId, apiKey, log) {
  const deadline = Date.now() + MAX_WAIT_MS
  while (Date.now() < deadline) {
    const run = await getRunStatus(runId, apiKey)
    if (run.status === 'SUCCEEDED') return run
    if (run.status === 'FAILED' || run.status === 'ABORTED' || run.status === 'TIMED-OUT') {
      throw new Error(`Apify run ${run.status}`)
    }
    log(`Apify run ${runId} is ${run.status}, waiting...`)
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error('Timed out waiting for Apify run')
}

export function startReviewScrapeWorker(log) {
  const worker = new Worker('review-scrape', async job => {
    const { jobId, tenantId, venueId, platform, placeId, maxReviews, apiKey } = job.data
    const logMsg = (m) => log.info({ jobId, venue: venueId }, m)

    try {
      // ── 1. Start actor ───────────────────────────────────
      logMsg('Starting Apify review scrape')
      let apifyRunId
      if (platform === 'google') {
        apifyRunId = await startGoogleReviewsScrape({ placeId, maxReviews, apiKey })
      } else {
        throw new Error('Unsupported platform: ' + platform)
      }

      // ── 2. Mark running ──────────────────────────────────
      await sql`
        UPDATE review_scrape_jobs
           SET status = 'running', apify_run_id = ${apifyRunId}
         WHERE id = ${jobId}
      `

      // ── 3. Poll until done ───────────────────────────────
      await pollUntilDone(apifyRunId, apiKey, logMsg)

      // ── 4. Fetch + upsert reviews ────────────────────────
      const items = await getRunResults(apifyRunId, apiKey)
      logMsg(`Apify returned ${items.length} items`)

      let saved = 0
      for (const item of items) {
        const r = normaliseGoogleReview(item)
        if (!r.rating) continue  // skip malformed rows

        await withTenant(tenantId, tx => tx`
          INSERT INTO reviews
            (tenant_id, venue_id, platform, external_id, reviewer_name,
             reviewer_photo_url, rating, review_text, review_date,
             reply_text, is_approved, source, raw_data)
          VALUES
            (${tenantId}, ${venueId ?? null}, ${r.platform}, ${r.external_id},
             ${r.reviewer_name}, ${r.reviewer_photo_url}, ${r.rating},
             ${r.review_text}, ${r.review_date ?? null},
             ${r.reply_text ?? null}, false, 'scraped', ${r.raw_data})
          ON CONFLICT (tenant_id, platform, external_id)
          WHERE external_id IS NOT NULL
          DO UPDATE SET
            reviewer_name      = EXCLUDED.reviewer_name,
            reviewer_photo_url = EXCLUDED.reviewer_photo_url,
            rating             = EXCLUDED.rating,
            review_text        = EXCLUDED.review_text,
            review_date        = EXCLUDED.review_date,
            reply_text         = EXCLUDED.reply_text,
            raw_data           = EXCLUDED.raw_data,
            updated_at         = now()
        `)
        saved++
      }

      // ── 5. Mark done ─────────────────────────────────────
      await sql`
        UPDATE review_scrape_jobs
           SET status = 'done', result_count = ${saved}, finished_at = now()
         WHERE id = ${jobId}
      `
      logMsg(`Scrape complete: ${saved} reviews upserted`)

    } catch (err) {
      log.error({ jobId, err }, 'Review scrape job failed')
      await sql`
        UPDATE review_scrape_jobs
           SET status = 'failed', error_message = ${err.message}, finished_at = now()
         WHERE id = ${jobId}
      `.catch(() => {})
      throw err
    }
  }, { connection, concurrency: 2 })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Review scrape worker failure')
  })

  return worker
}
