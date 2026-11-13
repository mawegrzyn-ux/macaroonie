// src/components/reports/shared.jsx
//
// Small pieces the Reports list and the viewer share.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Query retry rule for the report pages: a refusal (no access, no such
 * report) is the same the second time, so it shows at once; anything else
 * (the network, a busy server) gets the app's one more try.
 */
export const retryUnlessRefused = (count, error) => count < 1 && !(error?.status >= 400 && error?.status < 500)

/** A report's page. A starter's id has a colon in it ("starter:till_sales_by_day"). */
export const reportPath = id => '/reports/' + encodeURIComponent(id)

/** Star or unstar a report, shown at once and put right if the API says no. */
export function useStar() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, on }) => (on
      ? api.post('/reports/' + encodeURIComponent(id) + '/star', {})
      : api.delete('/reports/' + encodeURIComponent(id) + '/star')),
    onMutate: ({ id, on }) => {
      const flip = r => (r.id === id ? { ...r, starred: on } : r)
      qc.setQueryData(['reports'], d => (d ? { ...d, reports: d.reports.map(flip), starters: d.starters.map(flip) } : d))
      qc.setQueryData(['report', id], d => (d?.report ? { ...d, report: { ...d.report, starred: on } } : d))
    },
    onError: (_e, { id }) => {
      qc.invalidateQueries({ queryKey: ['reports'] })
      qc.invalidateQueries({ queryKey: ['report', id] })
    },
  })
}

export function StarButton({ report, className }) {
  const star = useStar()
  const on = !!report.starred
  return (
    <button type="button" data-testid="report-star" aria-pressed={on}
      aria-label={(on ? 'Take the star off ' : 'Star ') + report.name} title={on ? 'Starred' : 'Star it'}
      onClick={() => star.mutate({ id: report.id, on: !on })}
      className={cn('w-12 h-12 flex items-center justify-center rounded-lg touch-manipulation hover:bg-muted shrink-0', className)}>
      <Star className={cn('w-5 h-5', on ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground')} />
    </button>
  )
}
