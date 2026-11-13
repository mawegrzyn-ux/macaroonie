// src/lib/linked.js
//
// A record a page is asked to open by its address: ?order=<id>,
// ?booking=<id>, ?customer=<id>, ?check=<id>&venue=<id>, &dish=<id>
// (docs/REPORTS.md 8: a report's row opens the record on its own page).
//
//   const linked = useLinked('order')   ->  { order: '<id>' | null, clear }
//
// clear() takes the asking out of the address once the record is closed
// (or the page moves on), so a reload doesn't open it again. It keeps the
// history entry's state: the bar back to the report (FromReport) stays.

import { useCallback } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

export function useLinked(...names) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const key = names.join('|')
  const clear = useCallback(() => {
    const drop = key.split('|')
    if (!drop.some(n => params.has(n))) return
    setParams(prev => {
      const next = new URLSearchParams(prev)
      for (const n of drop) next.delete(n)
      return next
    }, { replace: true, state: location.state })
  }, [key, params, setParams, location.state])
  const out = { clear }
  for (const n of names) out[n] = params.get(n)
  return out
}
