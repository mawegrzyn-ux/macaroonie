// src/routes/reviews.js
//
// Customer reviews: list, manual add, approve/reject, scrape trigger, CSV import.
// Mounted at /api/reviews in app.js.

import { z }          from 'zod'
import { createHash } from 'node:crypto'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import { env }        from '../config/env.js'
import { reviewScrapeQueue } from '../jobs/queues.js'
import { webLink }    from '../../../shared/links.js'

// Reviews belong to the website: view reads, manage changes.
const PERM = {
  view:   requirePermission('website', 'view'),
  manage: requirePermission('website', 'manage'),
}

// ── Schemas ──────────────────────────────────────────────────

const ReviewBody = z.object({
  venue_id:           z.string().uuid().nullable().optional(),
  platform:           z.enum(['google', 'tripadvisor', 'justeat', 'deliveroo', 'glovo', 'manual']).default('manual'),
  reviewer_name:      z.string().max(200).nullable().optional(),
  reviewer_photo_url: z.string().url().nullable().optional(),
  rating:             z.number().int().min(1).max(5),
  review_text:        z.string().nullable().optional(),
  review_date:        z.string().datetime({ offset: true }).nullable().optional(),
  reply_text:         z.string().nullable().optional(),
  is_approved:        z.boolean().default(false),
  is_featured:        z.boolean().default(false),
})

const ReviewPatch = z.object({
  reviewer_name:      z.string().max(200).nullable().optional(),
  reviewer_photo_url: z.string().url().nullable().optional(),
  rating:             z.number().int().min(1).max(5).optional(),
  review_text:        z.string().nullable().optional(),
  review_date:        z.string().datetime({ offset: true }).nullable().optional(),
  reply_text:         z.string().nullable().optional(),
  is_approved:        z.boolean().optional(),
  is_featured:        z.boolean().optional(),
  // Not a column: true marks the review as looked at (sets checked_at/_by),
  // without approving it — "keep it off the website" in the To check inbox.
  checked:            z.boolean().optional(),
})

// Reviews read off a review site's page (migration 239). No scraping here:
// the caller (Claude in Chrome through the staff connector, or anything that
// can see the page) sends what the page shows.
const RECORD_PLATFORMS = ['google', 'tripadvisor', 'justeat', 'deliveroo', 'glovo']

const RecordedReview = z.object({
  author:    z.string().max(200).nullable().optional(),
  rating:    z.number().int().min(1).max(5).nullable().optional(),
  text:      z.string().max(8000).nullable().optional(),
  date:      z.string().max(40).nullable().optional(),  // YYYY-MM-DD, or a full ISO date-time
  date_text: z.string().max(80).nullable().optional(),  // as written on the page ("2 weeks ago")
  reply:     z.string().max(8000).nullable().optional(),
})

const RecordBody = z.object({
  venue_id: z.string().uuid(),
  platform: z.enum(RECORD_PLATFORMS),
  // The page the reviews were read from, drawn as a link on the Reviews page:
  // http or https only (Zod's url() alone takes javascript: and data: links).
  page_url: z.string().trim().max(500).refine(u => !!webLink(u), 'Use a web address starting with https://').nullable().optional(),
  reviews:  z.array(RecordedReview).min(1).max(40),
})

const ScrapeBody = z.object({
  venue_id:    z.string().uuid(),
  platform:    z.enum(['google']).default('google'),
  max_reviews: z.number().int().min(1).max(1000).default(200),
})

// ── Helpers ──────────────────────────────────────────────────

function parseIntParam(v, def = undefined) {
  const n = parseInt(v, 10)
  return isNaN(n) ? def : n
}

const squash = s => String(s ?? '').trim().replace(/\s+/g, ' ')

// The dedupe fingerprint for a recorded review, stored as external_id so the
// existing (tenant_id, platform, external_id) unique index does the work.
// Author + text only (normalised): the dates these pages show are often
// relative ("2 weeks ago"), so a date worked out on two different days must
// not make the same review two rows.
function recordKey(venueId, platform, r) {
  const author = squash(r.author).toLowerCase()
  const text   = squash(r.text).toLowerCase().slice(0, 500)
  const hash   = createHash('md5').update([venueId, platform, author, text].join('|')).digest('hex')
  return 'rec:' + hash
}

function recordDate(raw) {
  const s = squash(raw)
  if (!s) return null
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T12:00:00Z' : s)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// ── Plugin ───────────────────────────────────────────────────

export default async function reviewsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── GET /reviews ─────────────────────────────────────────
  // Params: venue_id, platform, is_approved, is_featured, min_rating, limit, offset
  app.get('/', { preHandler: PERM.view }, async (req) => {
    const {
      venue_id, platform, is_approved, is_featured, min_rating, to_check,
      limit = '50', offset = '0', sort = 'newest',
    } = req.query

    return withTenant(req.tenantId, tx => {
      const vFilter  = venue_id    ? tx`AND r.venue_id  = ${venue_id}`               : tx``
      const pFilter  = platform    ? tx`AND r.platform  = ${platform}`                : tx``
      const aFilter  = is_approved !== undefined ? tx`AND r.is_approved = ${is_approved === 'true'}` : tx``
      const fFilter  = is_featured !== undefined ? tx`AND r.is_featured = ${is_featured === 'true'}` : tx``
      const rFilter  = min_rating  ? tx`AND r.rating >= ${parseIntParam(min_rating, 1)}`            : tx``
      const cFilter  = to_check === 'true' || to_check === '1' ? tx`AND r.checked_at IS NULL`       : tx``

      const orderBy = sort === 'highest' ? tx`r.rating DESC, r.review_date DESC`
                    : sort === 'lowest'  ? tx`r.rating ASC, r.review_date DESC`
                    :                      tx`r.review_date DESC NULLS LAST`

      return tx`
        SELECT r.*,
               v.name AS venue_name
          FROM reviews r
          LEFT JOIN venues v ON v.id = r.venue_id
         WHERE r.tenant_id = ${req.tenantId}
           ${vFilter} ${pFilter} ${aFilter} ${fFilter} ${rFilter} ${cFilter}
         ORDER BY ${orderBy}
         LIMIT  ${parseIntParam(limit, 50)}
         OFFSET ${parseIntParam(offset, 0)}
      `
    })
  })

  // ── GET /reviews/stats ────────────────────────────────────
  app.get('/stats', { preHandler: PERM.view }, async (req) => {
    const { venue_id } = req.query
    return withTenant(req.tenantId, tx => {
      const vFilter = venue_id ? tx`AND r.venue_id = ${venue_id}` : tx``
      return tx`
        SELECT
          COUNT(*)                                   AS total,
          COUNT(*) FILTER (WHERE r.is_approved)      AS approved,
          COUNT(*) FILTER (WHERE NOT r.is_approved)  AS pending,
          COUNT(*) FILTER (WHERE r.checked_at IS NULL) AS to_check,
          COUNT(*) FILTER (WHERE r.is_featured)      AS featured,
          ROUND(AVG(r.rating)::numeric, 1)           AS avg_rating,
          COUNT(*) FILTER (WHERE r.platform = 'google')      AS google,
          COUNT(*) FILTER (WHERE r.platform = 'tripadvisor') AS tripadvisor,
          COUNT(*) FILTER (WHERE r.platform = 'justeat')     AS justeat,
          COUNT(*) FILTER (WHERE r.platform = 'deliveroo')   AS deliveroo,
          COUNT(*) FILTER (WHERE r.platform = 'manual')      AS manual
        FROM reviews r
        WHERE r.tenant_id = ${req.tenantId} ${vFilter}
      `
    }).then(rows => rows[0])
  })

  // ── GET /reviews/latest ───────────────────────────────────
  // The newest review held per site (and venue), with what's waiting in the
  // To check inbox — so a client recording reviews from the sites' pages
  // knows which ones Macaroonie already has.
  app.get('/latest', { preHandler: PERM.view }, async (req) => {
    const { venue_id, platform } = req.query
    return withTenant(req.tenantId, tx => {
      const vFilter = venue_id  ? tx`AND r.venue_id = ${venue_id}` : tx``
      const pFilter = platform  ? tx`AND r.platform = ${platform}` : tx``
      return tx`
        SELECT r.venue_id, v.name AS venue_name, r.platform,
               COUNT(*)::int                                          AS total,
               COUNT(*) FILTER (WHERE r.checked_at IS NULL)::int      AS to_check,
               MAX(r.review_date)                                     AS newest_review,
               MAX(r.created_at) FILTER (WHERE r.source = 'recorded') AS last_recorded_at
          FROM reviews r
          LEFT JOIN venues v ON v.id = r.venue_id
         WHERE r.tenant_id = ${req.tenantId} ${vFilter} ${pFilter}
         GROUP BY r.venue_id, v.name, r.platform
         ORDER BY v.name NULLS LAST, r.platform
      `
    })
  })

  // ── GET /reviews/scrape-jobs ──────────────────────────────
  app.get('/scrape-jobs', { preHandler: PERM.view }, async (req) => {
    const { venue_id } = req.query
    return withTenant(req.tenantId, tx => {
      const vFilter = venue_id ? tx`AND j.venue_id = ${venue_id}` : tx``
      return tx`
        SELECT j.*, v.name AS venue_name, u.email AS triggered_by_email
          FROM review_scrape_jobs j
          LEFT JOIN venues v ON v.id = j.venue_id
          LEFT JOIN users  u ON u.id = j.triggered_by
         WHERE j.tenant_id = ${req.tenantId} ${vFilter}
         ORDER BY j.started_at DESC
         LIMIT 50
      `
    })
  })

  // ── GET /reviews/:id ──────────────────────────────────────
  app.get('/:id', { preHandler: PERM.view }, async (req) => {
    const rows = await withTenant(req.tenantId, tx => tx`
      SELECT r.*, v.name AS venue_name
        FROM reviews r
        LEFT JOIN venues v ON v.id = r.venue_id
       WHERE r.id = ${req.params.id}
         AND r.tenant_id = ${req.tenantId}
    `)
    if (!rows.length) throw httpError(404, 'Review not found')
    return rows[0]
  })

  // ── POST /reviews ─────────────────────────────────────────
  // Manual review entry. Typed by the person, so it is born checked
  // (it never needs the To check inbox).
  app.post('/', { preHandler: PERM.manage }, async (req) => {
    const body = ReviewBody.parse(req.body)
    const rows = await withTenant(req.tenantId, tx => tx`
      INSERT INTO reviews
        (tenant_id, venue_id, platform, reviewer_name, reviewer_photo_url,
         rating, review_text, review_date, reply_text, is_approved, is_featured, source,
         checked_at, checked_by)
      VALUES
        (${req.tenantId}, ${body.venue_id ?? null}, ${body.platform},
         ${body.reviewer_name ?? null}, ${body.reviewer_photo_url ?? null},
         ${body.rating}, ${body.review_text ?? null}, ${body.review_date ?? null},
         ${body.reply_text ?? null}, ${body.is_approved}, ${body.is_featured}, 'manual',
         now(), ${req.user?.email ?? null})
      RETURNING *
    `)
    return rows[0]
  })

  // ── POST /reviews/record ──────────────────────────────────
  // Reviews read off a review site's page (Google, TripAdvisor, Just Eat,
  // Deliveroo) by a client that can see the page — Claude in Chrome through
  // the staff connector, or the Pepper chat. No scraping: the caller sends
  // what the page shows; the server dedupes by fingerprint (external_id) and
  // stores new ones unapproved and unchecked, for the To check inbox.
  // Sending the same reviews again is safe (counted as already); a review
  // someone chose to keep off the website stays checked and never resurfaces.
  app.post('/record', { preHandler: PERM.manage }, async (req) => {
    const body = RecordBody.parse(req.body)

    return withTenant(req.tenantId, async tx => {
      const venues = await tx`
        SELECT id, name FROM venues
         WHERE id = ${body.venue_id} AND tenant_id = ${req.tenantId}`
      if (!venues.length) throw httpError(404, 'Venue not found')

      let added = 0, already = 0, unusable = 0
      for (const r of body.reviews) {
        const author = squash(r.author) || null
        const text   = String(r.text ?? '').trim() || null
        if (!author && !text) { unusable++; continue }

        const key  = recordKey(body.venue_id, body.platform, r)
        const raw  = {
          recorded_by: req.user?.email ?? null,
          page_url:    body.page_url ?? null,
          date_text:   squash(r.date_text) || null,
        }
        const rows = await tx`
          INSERT INTO reviews
            (tenant_id, venue_id, platform, external_id, reviewer_name, rating,
             review_text, review_date, reply_text, is_approved, is_featured, source, raw_data)
          VALUES
            (${req.tenantId}, ${body.venue_id}, ${body.platform}, ${key}, ${author},
             ${r.rating ?? null}, ${text}, ${recordDate(r.date)},
             ${String(r.reply ?? '').trim() || null}, false, false, 'recorded', ${tx.json(raw)})
          ON CONFLICT (tenant_id, platform, external_id) WHERE external_id IS NOT NULL
          DO UPDATE SET
            reply_text  = COALESCE(EXCLUDED.reply_text, reviews.reply_text),
            review_date = COALESCE(reviews.review_date, EXCLUDED.review_date),
            rating      = COALESCE(reviews.rating, EXCLUDED.rating),
            updated_at  = now()
          RETURNING (xmax = 0) AS inserted
        `
        if (rows[0]?.inserted) added++
        else already++
      }

      const [st] = await tx`
        SELECT COUNT(*) FILTER (WHERE checked_at IS NULL)::int AS to_check,
               MAX(review_date)                                AS newest_review
          FROM reviews
         WHERE tenant_id = ${req.tenantId}
           AND venue_id = ${body.venue_id} AND platform = ${body.platform}`

      return {
        venue_name: venues[0].name, platform: body.platform,
        added, already, unusable,
        to_check: st.to_check, newest_review: st.newest_review,
      }
    })
  })

  // ── PATCH /reviews/:id ────────────────────────────────────
  // Approving (either way) or `checked: true` counts as a person having
  // looked at the review: the first such decision stamps checked_at/_by,
  // which takes it out of the To check inbox for good.
  app.patch('/:id', { preHandler: PERM.manage }, async (req) => {
    const { checked, ...cols } = ReviewPatch.parse(req.body)
    const decided = checked === true || cols.is_approved !== undefined
    if (!Object.keys(cols).length && !decided) throw httpError(400, 'No fields to update')

    // The dynamic-columns helper can't sit inside a fragment, so updated_at
    // rides in it and the checked stamp is its own fragment after it.
    const all    = { ...cols, updated_at: new Date() }
    const fields = Object.keys(all)
    const stamp  = decided
      ? tx => tx`, checked_at = COALESCE(checked_at, now()), checked_by = COALESCE(checked_by, ${req.user?.email ?? null})`
      : tx => tx``
    const rows = await withTenant(req.tenantId, tx => tx`
      UPDATE reviews
         SET ${tx(all, ...fields)} ${stamp(tx)}
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!rows.length) throw httpError(404, 'Review not found')
    return rows[0]
  })

  // ── DELETE /reviews/:id ───────────────────────────────────
  app.delete('/:id', { preHandler: PERM.manage}, async (req) => {
    const rows = await withTenant(req.tenantId, tx => tx`
      DELETE FROM reviews
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING id
    `)
    if (!rows.length) throw httpError(404, 'Review not found')
    return { deleted: true }
  })

  // ── POST /reviews/bulk-approve ────────────────────────────
  app.post('/bulk-approve', { preHandler: PERM.manage }, async (req) => {
    const { ids, is_approved } = z.object({
      ids:         z.array(z.string().uuid()).min(1).max(200),
      is_approved: z.boolean(),
    }).parse(req.body)

    const rows = await withTenant(req.tenantId, tx => tx`
      UPDATE reviews
         SET is_approved = ${is_approved},
             checked_at  = COALESCE(checked_at, now()),
             checked_by  = COALESCE(checked_by, ${req.user?.email ?? null}),
             updated_at  = now()
       WHERE id = ANY(${ids}::uuid[])
         AND tenant_id = ${req.tenantId}
       RETURNING id
    `)
    return { updated: rows.length }
  })

  // ── POST /reviews/scrape ──────────────────────────────────
  // Triggers an Apify scrape job. Returns immediately; results arrive async.
  app.post('/scrape', { preHandler: PERM.manage}, async (req) => {
    const body = ScrapeBody.parse(req.body)

    const apiKey = env.APIFY_API_KEY
    if (!apiKey) throw httpError(422, 'APIFY_API_KEY is not configured on this server')

    // Resolve place_id from venue
    const venues = await withTenant(req.tenantId, tx => tx`
      SELECT id, name, google_place_id FROM venues
       WHERE id = ${body.venue_id} AND tenant_id = ${req.tenantId}
    `)
    if (!venues.length) throw httpError(404, 'Venue not found')
    const venue = venues[0]

    if (!venue.google_place_id) {
      throw httpError(422, 'This venue has no Google Place ID configured. Set it in the venue settings.')
    }

    // Create job tracking row
    const [job] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO review_scrape_jobs
        (tenant_id, venue_id, platform, status, triggered_by)
      VALUES
        (${req.tenantId}, ${body.venue_id}, ${body.platform}, 'pending', ${req.user.id})
      RETURNING id
    `)

    // Queue the BullMQ job (fire and forget)
    reviewScrapeQueue.add('scrape-reviews', {
      jobId:       job.id,
      tenantId:    req.tenantId,
      venueId:     body.venue_id,
      platform:    body.platform,
      placeId:     venue.google_place_id,
      maxReviews:  body.max_reviews,
      apiKey,
    }).catch(err => req.log.warn({ err }, 'Failed to queue review scrape'))

    return { job_id: job.id, status: 'pending', venue_name: venue.name }
  })

  // ── POST /reviews/import-csv ──────────────────────────────
  // Accepts a CSV upload. Columns: reviewer_name, rating, review_text, review_date, attr (alias for reviewer_name)
  // Returns: { imported, skipped }
  app.post('/import-csv', { preHandler: PERM.manage}, async (req) => {
    const { venue_id, platform = 'manual' } = req.query

    const file = await req.file()
    if (!file) throw httpError(400, 'No file uploaded')
    if (!file.mimetype.includes('csv') && !file.mimetype.includes('text')) {
      throw httpError(400, 'File must be a CSV')
    }

    const text = (await file.toBuffer()).toString('utf-8')
    const lines = text.split(/\r?\n/).filter(Boolean)
    if (lines.length < 2) throw httpError(400, 'CSV must have a header row and at least one data row')

    // Parse header
    const rawHeaders = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''))
    const getCol = (row, ...names) => {
      for (const name of names) {
        const idx = rawHeaders.indexOf(name)
        if (idx >= 0 && row[idx]) return row[idx].trim().replace(/^"|"$/g, '')
      }
      return null
    }

    let imported = 0
    let skipped   = 0

    for (let i = 1; i < lines.length; i++) {
      // Naive CSV split (no quoted-comma support needed for reviews)
      const cols = lines[i].split(',')
      const rating = parseInt(getCol(cols, 'rating', 'stars') ?? '0', 10)
      if (!rating || rating < 1 || rating > 5) { skipped++; continue }

      const reviewerName = getCol(cols, 'reviewer_name', 'name', 'attr', 'author') ?? 'Anonymous'
      const reviewText   = getCol(cols, 'review_text', 'text', 'review', 'comment') ?? null
      const rawDate      = getCol(cols, 'review_date', 'date', 'published_at') ?? null
      let   reviewDate   = null
      if (rawDate) {
        const d = new Date(rawDate)
        if (!isNaN(d.getTime())) reviewDate = d.toISOString()
      }

      await withTenant(req.tenantId, tx => tx`
        INSERT INTO reviews
          (tenant_id, venue_id, platform, reviewer_name, rating, review_text, review_date, is_approved, source)
        VALUES
          (${req.tenantId}, ${venue_id ?? null}, ${platform},
           ${reviewerName}, ${rating}, ${reviewText}, ${reviewDate ?? null},
           false, 'csv')
      `).catch(() => { skipped++ })
      imported++
    }

    return { imported, skipped }
  })
}
