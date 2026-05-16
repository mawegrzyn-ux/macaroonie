// src/services/apifySvc.js
//
// Apify REST API wrapper for the Google Maps Reviews Scraper actor.
// Actor ID: compass/google-maps-reviews-scraper
//
// Caller flow:
//   const runId = await startGoogleReviewsScrape({ placeId, maxReviews, apiKey })
//   const items = await waitForRun(runId, apiKey)   -- polls until done, returns items
//
// Or use the webhook path: Apify calls POST /api/reviews/apify-webhook when run finishes.

const APIFY_BASE = 'https://api.apify.com/v2'
const ACTOR_ID   = 'compass~google-maps-reviews-scraper'

async function apifyFetch(path, { method = 'GET', body, apiKey } = {}) {
  const url  = `${APIFY_BASE}${path}${path.includes('?') ? '&' : '?'}token=${apiKey}`
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(url, opts)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err  = new Error(`Apify ${method} ${path} → ${res.status}: ${text}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

// ── Start a Google Maps reviews scrape ────────────────────────────────────────
// placeId: Google Maps Place ID (e.g. ChIJ...) OR full Google Maps URL.
// maxReviews: how many reviews to fetch (default 200, set to 0 for unlimited).
// Returns the Apify run ID.

export async function startGoogleReviewsScrape({ placeId, maxReviews = 200, apiKey }) {
  if (!apiKey) throw new Error('APIFY_API_KEY is not configured')

  const input = {
    startUrls: [
      placeId.startsWith('http')
        ? { url: placeId }
        : { url: 'https://www.google.com/maps/place/?q=place_id:' + placeId },
    ],
    maxReviews,
    reviewsSort:  'newest',
    language:     'en',
    personalData: true,   // include reviewer name + photo
  }

  const data = await apifyFetch('/acts/' + ACTOR_ID + '/runs', {
    method: 'POST',
    body:   { input, options: { timeoutSecs: 300 } },
    apiKey,
  })

  return data.data.id
}

// ── Get run status ─────────────────────────────────────────────────────────────

export async function getRunStatus(runId, apiKey) {
  const data = await apifyFetch('/actor-runs/' + runId, { apiKey })
  return data.data  // { id, status, stats: { itemCount } }
}

// ── Fetch completed run results ────────────────────────────────────────────────
// Returns raw Apify items. Each item looks like:
//   { reviewId, stars, text, publishAt, reviewerName, reviewerUrl, reviewerNumberOfReviews, ... }

export async function getRunResults(runId, apiKey) {
  const data = await apifyFetch(
    '/actor-runs/' + runId + '/dataset/items?clean=true&format=json',
    { apiKey }
  )
  // Apify returns an array directly for the dataset endpoint
  return Array.isArray(data) ? data : (data.data?.items ?? [])
}

// ── Normalise an Apify Google Maps review item to our DB shape ─────────────────

export function normaliseGoogleReview(item) {
  // Apify actor may return stars as number 1-5 or string. Handle both.
  const rating = parseInt(item.stars ?? item.rating ?? 0, 10)
  const reviewDate = item.publishAt
    ? new Date(item.publishAt)
    : item.publishedAtDate
    ? new Date(item.publishedAtDate)
    : null

  return {
    platform:            'google',
    external_id:         item.reviewId ?? item.id ?? null,
    reviewer_name:       item.reviewerName ?? item.name ?? null,
    reviewer_photo_url:  item.reviewerPhotoUrl ?? null,
    rating:              rating >= 1 && rating <= 5 ? rating : null,
    review_text:         item.text ?? item.reviewText ?? null,
    review_date:         reviewDate ? reviewDate.toISOString() : null,
    reply_text:          item.reviewerResponse?.text ?? null,
    source:              'scraped',
    raw_data:            item,
  }
}
