// src/reports/starters/define.js
//
// How a starter report is written (docs/REPORTS.md 11, Appendix B). A
// starter is a report definition that lives in code: every group has it,
// nobody can change it, and "Use this" copies it into the group's own
// reports. It is checked against the catalogue when the API starts
// (starters/index.js), so a starter naming a field that has gone stops the
// start, never a person's run.
//
//   starter({
//     key:   'till_sales_by_day',      a-z, 0-9 and _; never reused for another report
//     name:  'Sales by day',
//     about: 'One sentence on what it shows and how it counts.',
//     spec:  { subject, rows, values, ... },
//     period: 'last_week' | { relative, n } | false     the period asked for (false: none)
//     venues: true | false                               the venues asked for
//   })
//
// The period and venues become the definition's two parameters with their
// filters, so every starter is asked for the same two things the same way.

export const STARTER_KEY = /^[a-z][a-z0-9_]{2,59}$/

/** Values that are a subject's own measures: m('checks', 'net_sales'). */
export const m = (...keys) => keys.map(k => ({ measure: k }))

/** A share of the whole: the value's own figure over its grand total. */
export const share = (of, label = 'Share') => ({ key: 'share_' + of, calc: of + ' / total(' + of + ')', label, format: 'percent', decimals: 1 })

export function starter({ key, name, about, spec, period = 'last_week', venues = true }) {
  if (!STARTER_KEY.test(key || '')) throw new Error('Starter report "' + key + '": keys are lower case words joined by _')
  if (!name || !about) throw new Error('Starter report ' + key + ' needs a name and a sentence about it')
  const params = []
  const filters = []
  if (period) {
    params.push({ key: 'period', type: 'period', label: 'Period', default: typeof period === 'string' ? { relative: period } : period })
    filters.push({ field: 'date', op: 'in_period', param: 'period' })
  }
  if (venues) {
    params.push({ key: 'venues', type: 'venues', label: 'Venues', default: 'all' })
    filters.push({ field: 'venue', op: 'in', param: 'venues' })
  }
  return {
    key, name, about,
    spec: { version: 1, ...spec, params, filters: [...filters, ...(spec.filters || [])] },
  }
}
