// src/components/reports/PageBody.jsx
//
// A Page report on screen (docs/REPORTS.md 6, 11; shared/reports/page.js):
// its period and venues when the page has its own, then its blocks in
// order. Each report on it is run as the person looking, one by one
// (POST /reports/:id/blocks/:blockId/run), and drawn as the viewer draws a
// report, with the block's Show (chart and table, chart only, table only).
// A report the person can't open shows why in its place.
//
//   report   the page as GET /reports/:id returns it (spec + reports by ref)
//   choice   { period, venues } picked here for this visit (either null:
//            the page's own)
//   onChoice change it

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Lock, ExternalLink } from 'lucide-react'
import { shownResult } from '@shared/reports/page.js'
import { useApi } from '@/lib/api'
import { useVenues } from '@/components/staff/shared'
import ResultCard from '@/components/reports/ResultCard'
import PeriodPicker from '@/components/reports/PeriodPicker'
import VenuesPicker from '@/components/reports/VenuesPicker'
import { Problems, reportPath } from '@/components/reports/shared'

/** What a page is looked at with: the visitor's pick, else the page's own. */
export const pageChoiceOf = (spec, choice) => ({
  period: spec?.period ? (choice.period || spec.period) : null,
  venues: spec?.venues != null ? (choice.venues ?? spec.venues) : null,
})

function Words({ block }) {
  return (
    <section className="max-w-3xl" data-testid="page-text" data-block={block.id}>
      {block.title && <h2 className="text-base font-semibold">{block.title}</h2>}
      {block.text && block.text.split(/\n{2,}/).map((para, i) => (
        <p key={i} className="text-sm whitespace-pre-line mt-1">{para}</p>
      ))}
    </section>
  )
}

function ReportBlock({ page, block, about, choice }) {
  const api = useApi()
  const runs = about && !about.missing && about.runs && !about.problem
  const q = useQuery({
    queryKey: ['page-block', page.id, block.id, choice],
    queryFn: () => api.post('/reports/' + encodeURIComponent(page.id) + '/blocks/' + block.id + '/run', choice),
    enabled: !!runs,
    placeholderData: keepPreviousData,
    retry: false,
    gcTime: 60_000,
  })
  const title = block.title || about?.name || 'Report'
  return (
    <section className="space-y-2" data-testid="page-report" data-block={block.id}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold flex-1 min-w-[10rem]">{title}</h2>
        {about && !about.missing && (
          <Link to={reportPath(block.ref)} data-testid="page-report-open"
            className="inline-flex items-center gap-1.5 h-12 px-3 rounded-lg text-sm text-muted-foreground hover:bg-muted touch-manipulation">
            <ExternalLink className="w-4 h-4" /> Open the report
          </Link>
        )}
      </div>
      {(!about || about.missing) && (
        <p className="text-sm text-muted-foreground rounded-xl border bg-background px-4 py-3" data-testid="page-report-gone">
          This report isn't here any more, or isn't shared with you.
        </p>
      )}
      {about && !about.missing && !about.runs && (
        <p className="text-sm text-amber-900 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-2" data-testid="page-report-needs">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
          {about.needs ? 'This report needs ' + about.needs + ', which your role doesn\'t have.' : 'Your role can\'t run this report.'}
        </p>
      )}
      {about?.problem && <Problems error={{ message: about.problem }} title="This report can't be shown" />}
      <Problems error={q.error} title="This report can't be shown" />
      {q.isLoading && runs && <p className="text-sm text-muted-foreground">Working it out…</p>}
      {q.data && !q.error && (
        <ResultCard result={shownResult(q.data, block.show)} fetching={q.isFetching} stale={q.isPlaceholderData}
          onRefresh={() => q.refetch()} more="Open the report for all of them." />
      )}
    </section>
  )
}

export default function PageBody({ report, choice, onChoice }) {
  const { data: venues = [] } = useVenues()
  const spec = report.spec
  const asked = pageChoiceOf(spec, choice)
  return (
    <div className="space-y-6" data-testid="page-body">
      {(spec.period || (spec.venues != null && venues.length > 1)) && (
        <div className="flex flex-wrap items-center gap-2" data-testid="page-choices">
          {spec.period && <PeriodPicker value={asked.period} onChange={v => onChoice({ ...choice, period: v })} />}
          {spec.venues != null && venues.length > 1 && <VenuesPicker venues={venues} value={asked.venues} onChange={v => onChoice({ ...choice, venues: v })} />}
          {(choice.period || choice.venues != null) && (
            <button type="button" onClick={() => onChoice({ period: null, venues: null })} data-testid="page-choices-reset"
              className="h-12 px-3 rounded-lg text-sm text-muted-foreground touch-manipulation hover:bg-muted">
              Back to the page's usual choices
            </button>
          )}
        </div>
      )}
      {spec.blocks.map(b => b.type === 'text' ? <Words key={b.id} block={b} />
        : b.type === 'break' ? (
          <div key={b.id} className="flex items-center gap-3 text-[11px] text-muted-foreground" data-testid="page-break" aria-hidden="true">
            <span className="flex-1 border-t border-dashed" /> A new sheet when printed <span className="flex-1 border-t border-dashed" />
          </div>
        ) : <ReportBlock key={b.id} page={report} block={b} about={report.reports?.[b.ref]} choice={asked} />)}
    </div>
  )
}
