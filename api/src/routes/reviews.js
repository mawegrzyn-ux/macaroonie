// src/routes/reviews.js
//
// Customer reviews: list, manual add, approve/reject, scrape trigger, CSV import.
// Mounted at /api/reviews in app.js.

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import { env }        from '../config/env.js'
import { reviewScrapeQueue } from '../jobs/queues.js'

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

// ── Plugin ───────────────────────────────────────────────────

export default async function reviewsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── GET /reviews ─────────────────────────────────────────
  // Params: venue_id, platform, is_approved, is_featured, min_rating, limit, offset
  app.get('/', async (req) => {
    const {
      venue_id, platform, is_approved, is_featured, min_rating,
      limit = '50', offset = '0', sort = 'newest',
    } = req.query

    return withTenant(req.tenantId, tx => {
      const vFilter  = venue_id    ? tx`AND r.venue_id  = ${venue_id}`               : tx``
      const pFilter  = platform    ? tx`AND r.platform  = ${platform}`                : tx``
      const aFilter  = is_approved !== undefined ? tx`AND r.is_approved = ${is_approved === 'true'}` : tx``
      const fFilter  = is_featured !== undefined ? tx`AND r.is_featured = ${is_featured === 'true'}` : tx``
      const rFilter  = min_rating  ? tx`AND r.rating >= ${parseIntParam(min_rating, 1)}`            : tx``

      const orderBy = sort === 'highest' ? tx`r.rating DESC, r.review_date DESC`
                    : sort === 'lowest'  ? tx`r.rating ASC, r.review_date DESC`
                    :                      tx`r.review_date DESC NULLS LAST`

      return tx`
        SELECT r.*,
               v.name AS venue_name
          FROM reviews r
          LEFT JOIN venues v ON v.id = r.venue_id
         WHERE r.tenant_id = ${req.tenantId}
           ${vFilter} ${pFilter} ${aFilter} ${fFilter} ${rFilter}
         ORDER BY ${orderBy}
         LIMIT  ${parseIntParam(limit, 50)}
         OFFSET ${parseIntParam(offset, 0)}
      `
    })
  })

  // ── GET /reviews/stats ────────────────────────────────────
  app.get('/stats', async (req) => {
    const { venue_id } = req.query
    return withTenant(req.tenantId, tx => {
      const vFilter = venue_id ? tx`AND r.venue_id = ${venue_id}` : tx``
      return tx`
        SELECT
          COUNT(*)                                   AS total,
          COUNT(*) FILTER (WHERE r.is_approved)      AS approved,
          COUNT(*) FILTER (WHERE NOT r.is_approved)  AS pending,
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

  // ── GET /reviews/scrape-jobs ──────────────────────────────
  app.get('/scrape-jobs', async (req) => {
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
  app.get('/:id', async (req) => {
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
  // Manual review entry.
  app.post('/', async (req) => {
    const body = ReviewBody.parse(req.body)
    const rows = await withTenant(req.tenantId, tx => tx`
      INSERT INTO reviews
        (tenant_id, venue_id, platform, reviewer_name, reviewer_photo_url,
         rating, review_text, review_date, reply_text, is_approved, is_featured, source)
      VALUES
        (${req.tenantId}, ${body.venue_id ?? null}, ${body.platform},
         ${body.reviewer_name ?? null}, ${body.reviewer_photo_url ?? null},
         ${body.rating}, ${body.review_text ?? null}, ${body.review_date ?? null},
         ${body.reply_text ?? null}, ${body.is_approved}, ${body.is_featured}, 'manual')
      RETURNING *
    `)
    return rows[0]
  })

  // ── PATCH /reviews/:id ────────────────────────────────────
  app.patch('/:id', async (req) => {
    const body   = ReviewPatch.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const rows = await withTenant(req.tenantId, tx => tx`
      UPDATE reviews
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!rows.length) throw httpError(404, 'Review not found')
    return rows[0]
  })

  // ── DELETE /reviews/:id ───────────────────────────────────
  app.delete('/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
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
  app.post('/bulk-approve', async (req) => {
    const { ids, is_approved } = z.object({
      ids:         z.array(z.string().uuid()).min(1).max(200),
      is_approved: z.boolean(),
    }).parse(req.body)

    const rows = await withTenant(req.tenantId, tx => tx`
      UPDATE reviews
         SET is_approved = ${is_approved}, updated_at = now()
       WHERE id = ANY(${ids}::uuid[])
         AND tenant_id = ${req.tenantId}
       RETURNING id
    `)
    return { updated: rows.length }
  })

  // ── POST /reviews/scrape ──────────────────────────────────
  // Triggers an Apify scrape job. Returns immediately; results arrive async.
  app.post('/scrape', { preHandler: requireRole('admin', 'owner') }, async (req) => {
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
  app.post('/import-csv', { preHandler: requireRole('admin', 'owner') }, async (req) => {
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
