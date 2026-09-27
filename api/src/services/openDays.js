// src/services/openDays.js
//
// Which dates a venue is open, from its booking schedule. Shared by Cash
// Recon (closed days in the week grid / day tiles) and the Rota (hide
// closed days on the rota and printouts), so both agree on "closed".

/**
 * Determine which dates in `dates` the venue is actually open, applying the
 * same priority resolution as /schedule/sittings-for-date:
 *   1. Named schedule exceptions  2. Single-date overrides  3. Weekly templates
 * Returns the subset of `dates` (in original order) where the venue has sittings.
 * Must be called from inside a withTenant callback.
 */
export async function resolveOpenDaysForWeek(tx, tenantId, venueId, dates) {
  const weekStart = dates[0]
  const weekEnd   = dates[dates.length - 1]

  // Bulk-load all three schedule layers for the week in parallel
  const [exceptions, overrides, templates] = await Promise.all([
    tx`
      SELECT id, is_closed, date_from::text, date_to::text
        FROM schedule_exceptions
       WHERE venue_id   = ${venueId}
         AND tenant_id  = ${tenantId}
         AND date_from <= ${weekEnd}::date
         AND date_to   >= ${weekStart}::date
       ORDER BY priority DESC, (date_to - date_from) ASC
    `,
    tx`
      SELECT override_date::text AS date, is_open
        FROM schedule_date_overrides
       WHERE venue_id      = ${venueId}
         AND tenant_id     = ${tenantId}
         AND override_date BETWEEN ${weekStart}::date AND ${weekEnd}::date
    `,
    tx`
      SELECT day_of_week, is_open
        FROM venue_schedule_templates
       WHERE venue_id  = ${venueId}
         AND tenant_id = ${tenantId}
    `,
  ])

  const overrideByDate = Object.fromEntries(overrides.map(o => [o.date, o.is_open]))
  const templateByDow  = Object.fromEntries(templates.map(t => [t.day_of_week, t.is_open]))

  // Bulk-load exception day-of-week templates for any relevant exceptions
  const excIds = exceptions.map(e => e.id)
  const excDayTemplates = excIds.length > 0
    ? await tx`
        SELECT exception_id, day_of_week, is_open
          FROM exception_day_templates
         WHERE exception_id = ANY(${excIds}::uuid[])
      `
    : []
  // excDowMap[excId][dow] = is_open (boolean)
  const excDowMap = {}
  for (const edt of excDayTemplates) {
    ;(excDowMap[edt.exception_id] ??= {})[edt.day_of_week] = edt.is_open
  }

  const openDates = []
  for (const date of dates) {
    // JS getUTCDay(): 0=Sun … 6=Sat — same convention as PostgreSQL EXTRACT(DOW)
    const dow = new Date(date + 'T12:00:00Z').getUTCDay()

    // Priority 1: named exception (array is already sorted highest-priority first)
    const exc = exceptions.find(e => e.date_from <= date && date <= e.date_to)
    if (exc) {
      if (exc.is_closed) continue           // whole period explicitly closed
      const dowMap = excDowMap[exc.id]
      if (dowMap) {
        const isOpen = dowMap[dow]
        if (isOpen !== undefined) {
          if (isOpen) openDates.push(date)
          continue
        }
      }
      // Exception exists but no DOW template — fall through to priority 2
    }

    // Priority 2: single-date override
    if (date in overrideByDate) {
      if (overrideByDate[date]) openDates.push(date)
      continue
    }

    // Priority 3: weekly template
    if (templateByDow[dow]) openDates.push(date)
  }

  return openDates
}
