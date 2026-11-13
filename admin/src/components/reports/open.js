// src/components/reports/open.js
//
// A report's row that opens the record itself on its page in the app
// (docs/REPORTS.md 8): the check in Till reports, the order on Online
// orders, the booking, the customer, the dish in its menu. The result's
// meta.open says the page (`/pos/reports?check=:id&venue=:venue`) and the
// words for it ("Open the check"); each row that can be opened carries the
// values its address needs (row.open: { id, venue }). The server decides
// both for the person asking (their role must be able to open that page),
// so the page only fills the address in.

/** The address a row opens in the app, or null when it opens nothing. */
export function recordHref(result, row) {
  const page = result?.meta?.open?.page
  if (typeof page !== 'string' || !row?.open) return null
  let missing = false
  const href = page.replace(/:([a-z_][a-z0-9_]*)/g, (_, name) => {
    const v = row.open[name]
    if (v == null || v === '') { missing = true; return '' }
    return encodeURIComponent(v)
  })
  // Only an address in the app: never another site.
  return missing || !href.startsWith('/') || href.startsWith('//') ? null : href
}

/** The line over a list whose rows open records, or null. */
export function openHint(result) {
  const open = result?.meta?.open
  const rows = result?.rows || []
  if (!open || result.kind !== 'list' || !rows.some(r => r.open)) return null
  const what = open.label ? open.label[0].toLowerCase() + open.label.slice(1) : 'open it'
  return (rows.every(r => r.open) ? 'Tap a row to ' : 'Tap an underlined row to ') + what + '.'
}
