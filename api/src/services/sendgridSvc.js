// src/services/sendgridSvc.js
//
// SendGrid Web API wrapper for the email monitoring page.
//
// Uses the venue's SendGrid API key (stored in venue_email_settings)
// to fetch aggregate stats, suppression lists, and remove suppressions.
//
// Auth: Authorization: Bearer <api_key>
// Docs: https://docs.sendgrid.com/api-reference/

const BASE = 'https://api.sendgrid.com/v3'

async function sgFetch({ apiKey, path, method = 'GET', query }) {
  if (!apiKey) throw new Error('SendGrid API key missing')
  const qs = query ? '?' + new URLSearchParams(query).toString() : ''
  const res = await fetch(`${BASE}${path}${qs}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let parsed
    try { parsed = JSON.parse(text) } catch { /* not json */ }
    const msg = parsed?.errors?.[0]?.message || parsed?.error || text || `HTTP ${res.status}`
    const err = new Error(`SendGrid ${method} ${path} failed: ${msg}`)
    err.status = res.status
    throw err
  }
  // 204 No Content for DELETE
  if (res.status === 204) return null
  return res.json()
}

/**
 * Get aggregate stats grouped by day.
 *   apiKey: SendGrid API key
 *   startDate / endDate: 'YYYY-MM-DD'
 *
 * Returns an array of { date, metrics } where metrics includes:
 *   requests, delivered, bounces, bounce_drops, blocks, spam_reports,
 *   spam_report_drops, opens, unique_opens, clicks, unique_clicks,
 *   invalid_emails, deferred.
 */
export async function getStats({ apiKey, startDate, endDate }) {
  const data = await sgFetch({
    apiKey,
    path:  '/stats',
    query: {
      aggregated_by: 'day',
      start_date:    startDate,
      end_date:      endDate,
    },
  })
  // SendGrid returns: [{ date, stats: [{ metrics: {...} }] }, ...]
  // Flatten to: [{ date, ...metrics }]
  return (data ?? []).map(d => ({
    date: d.date,
    ...((d.stats?.[0]?.metrics) ?? {}),
  }))
}

/**
 * Get a suppression list. type: 'bounces' | 'blocks' | 'spam_reports' | 'invalid_emails'.
 * Returns array of { email, reason, status, created }.
 */
export async function getSuppressions({ apiKey, type, limit = 100 }) {
  if (!['bounces', 'blocks', 'spam_reports', 'invalid_emails'].includes(type)) {
    throw new Error(`Invalid suppression type: ${type}`)
  }
  const data = await sgFetch({
    apiKey,
    path:  `/suppression/${type}`,
    query: { limit: String(limit) },
  })
  return data ?? []
}

/**
 * Remove an email from a suppression list. Used by ops to retry sending
 * to a previously bounced/blocked address.
 */
export async function removeSuppression({ apiKey, type, email }) {
  if (!['bounces', 'blocks', 'spam_reports', 'invalid_emails'].includes(type)) {
    throw new Error(`Invalid suppression type: ${type}`)
  }
  await sgFetch({
    apiKey,
    path:   `/suppression/${type}/${encodeURIComponent(email)}`,
    method: 'DELETE',
  })
  return { ok: true }
}

/**
 * Quick connectivity / auth check — fetches the SendGrid /user/profile
 * endpoint to verify the API key works. Used by the monitoring page on
 * load to surface auth errors clearly instead of misleading "no data".
 */
export async function pingApiKey({ apiKey }) {
  await sgFetch({ apiKey, path: '/user/profile' })
  return { ok: true }
}
