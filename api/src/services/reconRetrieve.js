// src/services/reconRetrieve.js
//
// One Retrieve for every till system a venue's Cash Recon is linked to, and
// the scheduled fill (migration 260, OUTSTANDING 44 item 6).
//
//   RETRIEVE_SOURCES       the systems Retrieve fills from, in order
//   linkedSources()        the ones a venue is linked to
//   retrieveDays()         fills days from each linked system; one failing
//                          doesn't stop the others
//   sweepAutoFill()        every few minutes (startCashAutoFillWorker()):
//                          each venue with the scheduled fill on, once a day
//                          from its auto_fill_at (venue time), fills the day
//                          just ended and the two before, keeping figures
//                          changed by hand (fillReconDay()'s keepHandEdits)
//                          and never a submitted day
//
// The fills themselves are each system's own (applyLoyverseDays(),
// applyGloriaFoodDays()), so a figure is worked out in one place.

import { withTenant, systemSql } from '../config/db.js'
import { applyLoyverseDays } from '../routes/loyverse.js'
import { applyGloriaFoodDays } from '../routes/gloriafood.js'

export const RETRIEVE_SOURCES = [
  { key: 'loyverse',   label: 'Loyverse',   table: 'loyverse_venue_links',   apply: applyLoyverseDays },
  { key: 'gloriafood', label: 'GloriaFood', table: 'gloriafood_venue_links', apply: applyGloriaFoodDays },
]

// The scheduled fill: the day just ended and the two before it.
export const AUTO_FILL_DAYS = 3

/** The systems this venue's Cash Recon is linked to: [{ key, label }]. */
export async function linkedSources(tx, tenantId, venueId) {
  const [row] = await tx`
    SELECT EXISTS (SELECT 1 FROM loyverse_venue_links WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}) AS loyverse,
           EXISTS (SELECT 1 FROM gloriafood_venue_links WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}) AS gloriafood`
  return RETRIEVE_SOURCES.filter(s => row?.[s.key]).map(s => ({ key: s.key, label: s.label }))
}

const errorText = e => e?.message || 'Something went wrong'

/**
 * Fills `dates` from every linked system. Returns { sources: [{ key, label,
 * filled, skipped, kept } | { key, label, error }] }; one system failing
 * (Loyverse down, nothing mapped) is reported and the others still fill.
 */
export async function retrieveDays(tenantId, venueId, dates, { by = null, keepHandEdits = false } = {}) {
  const linked = await withTenant(tenantId, tx => linkedSources(tx, tenantId, venueId))
  const sources = []
  for (const s of linked) {
    const src = RETRIEVE_SOURCES.find(x => x.key === s.key)
    try {
      // Several days: only those with sales, up to today (the preview's own pick).
      const onlyWithSales = dates.length > 1
      sources.push({ ...s, ...(await src.apply(tenantId, venueId, dates, { by, keepHandEdits, onlyWithSales })) })
    } catch (e) {
      sources.push({ ...s, error: errorText(e) })
    }
  }
  return { sources }
}

const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const localNow = (tz, at = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map(p => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

/** The days a scheduled fill on `today` (venue time) fills, oldest first. */
export function autoFillDates(today) {
  return Array.from({ length: AUTO_FILL_DAYS }, (_, i) => addDays(today, i - AUTO_FILL_DAYS))
}

/**
 * Runs the scheduled fills that are due. System mode finds the venues (the
 * work crosses tenants); each venue is claimed for its day with one UPDATE
 * (auto_fill_last_on), so two API processes never run one twice, and the
 * fill itself runs in the venue's tenant. Returns how many venues ran.
 */
export async function sweepAutoFill(log, { at = new Date() } = {}) {
  const rows = await systemSql`
    SELECT s.venue_id, s.tenant_id, s.auto_fill_at::text AS auto_fill_at, s.auto_fill_last_on::text AS last_on, v.timezone
      FROM cash_venue_settings s
      JOIN venues v ON v.id = s.venue_id AND v.tenant_id = s.tenant_id
      JOIN tenants t ON t.id = s.tenant_id AND t.is_active
     WHERE s.auto_fill`
  let ran = 0
  for (const r of rows) {
    const now = localNow(r.timezone, at)
    if (now.time < r.auto_fill_at.slice(0, 5) || r.last_on === now.date) continue
    const [claimed] = await withTenant(r.tenant_id, tx => tx`
      UPDATE cash_venue_settings SET auto_fill_last_on = ${now.date}::date
       WHERE venue_id = ${r.venue_id} AND tenant_id = ${r.tenant_id} AND auto_fill
         AND auto_fill_last_on IS DISTINCT FROM ${now.date}::date
      RETURNING venue_id`)
    if (!claimed) continue
    ran++
    let result = null, error = null
    try {
      result = await retrieveDays(r.tenant_id, r.venue_id, autoFillDates(now.date), { by: 'Scheduled fill', keepHandEdits: true })
      const failed = result.sources.filter(s => s.error)
      if (!result.sources.length) error = 'This venue isn\'t linked to Loyverse or GloriaFood.'
      else if (failed.length) error = failed.map(s => s.label + ': ' + s.error).join(' ')
    } catch (e) {
      error = errorText(e)
    }
    await withTenant(r.tenant_id, tx => tx`
      UPDATE cash_venue_settings
         SET auto_fill_ran_at = now(), auto_fill_result = ${result ? tx.json(result) : null}, auto_fill_error = ${error}
       WHERE venue_id = ${r.venue_id} AND tenant_id = ${r.tenant_id}`).catch(e => log?.warn?.({ err: e?.message }, 'Scheduled fill result not kept'))
    if (error) log?.warn?.({ venueId: r.venue_id, error }, 'Scheduled Cash Recon fill had a problem')
  }
  return ran
}
