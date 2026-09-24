// src/utils/checklistPeriod.js
//
// Shared by checklists.js and dashboardTiles.js so the "which period does
// this date belong to" logic can never drift between the two.

function pad(n) { return String(n).padStart(2, '0') }

/** Monday (ISO week start) of the week containing the given YYYY-MM-DD, as a string. */
export function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** First of the month containing the given YYYY-MM-DD, as a string. */
export function monthStartOf(dateStr) {
  return dateStr.slice(0, 7) + '-01'
}

/** The period_start an instance of this frequency is keyed by, for a given date. */
export function periodStartFor(frequency, dateStr) {
  if (frequency === 'weekly')  return mondayOf(dateStr)
  if (frequency === 'monthly') return monthStartOf(dateStr)
  return dateStr
}
