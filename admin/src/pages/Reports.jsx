// src/pages/Reports.jsx
//
// Reports (/reports): every report the person can open. Their starred ones
// first, then their own, the team's, and the starter reports that come with
// Macaroonie, by area. A report opens in the viewer (/reports/:id); New
// report (with Use on Reports) opens the builder (/reports/new).
//
// A starter the person's role can't run (it reports on an area they have no
// access to) is listed dimmed with what it needs, so they know it exists.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileBarChart, Search, Lock, X, Plus } from 'lucide-react'
import { useApi } from '@/lib/api'
import { PageHeader, inputCls, ErrorNote } from '@/components/staff/shared'
import { StarButton, reportPath, retryUnlessRefused } from '@/components/reports/shared'
import { cn } from '@/lib/utils'

const KIND_NAMES = { list: 'List', summary: 'Summary', matrix: 'Table across' }
// Who a saved report is shared with. Someone with Manage sees other people's
// private reports too: those aren't "only you".
const sharedName = r => (r.shared === 'private' ? (r.mine ? 'Only you' : 'Not shared') : r.shared === 'roles' ? 'Some roles' : 'Everyone')

function ReportCard({ r, areaName }) {
  const meta = [areaName, KIND_NAMES[r.report_kind]].filter(Boolean).join(' · ')
  const body = (
    <>
      <span className="block text-sm font-semibold leading-snug break-words pr-12">{r.name}</span>
      {r.description && <span className="mt-1 text-xs text-muted-foreground leading-snug line-clamp-2" title={r.description}>{r.description}</span>}
      <span className="block mt-2 text-[11px] text-muted-foreground">
        {meta}
        {r.kind === 'saved' && !r.mine && r.owner_email ? ' · by ' + r.owner_email : ''}
        {r.kind === 'saved' && (r.mine || r.can_share) ? ' · ' + (r.is_starter ? 'Offered to the team' : sharedName(r)) : ''}
      </span>
      {!r.runs && (
        <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1" data-testid="report-needs">
          <Lock className="w-3 h-3 shrink-0" />
          {r.needs ? 'Needs ' + r.needs : 'Not open to your role'}
        </span>
      )}
    </>
  )
  return (
    <li className={cn('relative rounded-xl border bg-background', !r.runs && 'opacity-70')} data-testid="report-card" data-id={r.id} data-runs={r.runs ? '1' : '0'}>
      {r.runs
        ? <Link to={reportPath(r.id)} className="block p-4 min-h-[88px] rounded-xl touch-manipulation hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/40">{body}</Link>
        : <div className="p-4 min-h-[88px]">{body}</div>}
      <StarButton report={r} className="absolute top-1.5 right-1.5" />
    </li>
  )
}

function Cards({ items, areaNames }) {
  return (
    <ul className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {items.map(r => <ReportCard key={r.id} r={r} areaName={areaNames[r.area]} />)}
    </ul>
  )
}

function Section({ title, items, areaNames, testId }) {
  if (!items.length) return null
  return (
    <section data-testid={testId}>
      <h2 className="text-sm font-semibold">{title} <span className="font-normal text-muted-foreground">({items.length})</span></h2>
      <Cards items={items} areaNames={areaNames} />
    </section>
  )
}

// The starter reports, an area at a time.
function Starters({ items, areas, areaNames, canUse }) {
  if (!items.length) return null
  return (
    <section data-testid="reports-starters">
      <h2 className="text-sm font-semibold">Starter reports <span className="font-normal text-muted-foreground">({items.length})</span></h2>
      <p className="text-xs text-muted-foreground mt-0.5">
        They come with Macaroonie and stay as they are. Pick the period and the venues when you open one{canUse ? '; to change one, open it and choose Customise: that makes a report of your own.' : '.'}
      </p>
      <div className="mt-3 space-y-5">
        {areas.filter(a => items.some(r => r.area === a.key)).map(a => (
          <div key={a.key} data-testid="reports-starter-area" data-area={a.key}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{a.label}</h3>
            <Cards items={items.filter(r => r.area === a.key)} areaNames={areaNames} />
          </div>
        ))}
      </div>
    </section>
  )
}

export default function Reports() {
  const api = useApi()
  const { data, isLoading, error } = useQuery({ queryKey: ['reports'], queryFn: () => api.get('/reports'), retry: retryUnlessRefused })
  const [q, setQ] = useState('')
  const [area, setArea] = useState(null)

  const areas = useMemo(() => data?.areas || [], [data])
  const areaNames = useMemo(() => Object.fromEntries(areas.map(a => [a.key, a.label])), [areas])
  const all = useMemo(() => [...(data?.reports || []), ...(data?.starters || [])], [data])
  // Only the areas that have a report to show.
  const usedAreas = areas.filter(a => all.some(r => r.area === a.key))

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = r => {
    if (area && r.area !== area) return false
    if (!words.length) return true
    const text = [r.name, r.description, areaNames[r.area], ...(r.tags || [])].filter(Boolean).join(' ').toLowerCase()
    return words.every(w => text.includes(w))
  }
  const saved = (data?.reports || []).filter(shown)
  const starters = (data?.starters || []).filter(shown)
  const starred = [...saved, ...starters].filter(r => r.starred)
  const none = !!data && !saved.length && !starters.length

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="reports-page">
      <PageHeader icon={FileBarChart} title="Reports">
        {data?.can_use && (
          <Link to="/reports/new" data-testid="reports-new"
            className="inline-flex items-center gap-2 h-12 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation shrink-0">
            <Plus className="w-4 h-4" /> New report
          </Link>
        )}
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
          <div className="space-y-3">
            <div className="relative max-w-md">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a report" aria-label="Find a report"
                data-testid="reports-search" className={cn(inputCls, 'h-12 pl-9 pr-12')} />
              {q && (
                <button type="button" onClick={() => setQ('')} aria-label="Clear the search"
                  className="absolute right-0 top-0 w-12 h-12 flex items-center justify-center text-muted-foreground touch-manipulation">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {usedAreas.length > 1 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Area">
                {[{ key: null, label: 'All' }, ...usedAreas].map(a => (
                  <button key={a.key || 'all'} type="button" onClick={() => setArea(a.key)} aria-pressed={area === a.key} data-testid="area-chip"
                    className={cn('h-12 px-4 rounded-full border text-sm touch-manipulation',
                      area === a.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isLoading && <p className="text-sm text-muted-foreground">Loading reports…</p>}
          <ErrorNote error={error} />

          {data && (
            <>
              <Section testId="reports-starred" title="Starred" items={starred} areaNames={areaNames} />
              <Section testId="reports-mine" title="Your reports" items={saved.filter(r => r.mine)} areaNames={areaNames} />
              <Section testId="reports-team" title="From your team" items={saved.filter(r => !r.mine)} areaNames={areaNames} />
              <Starters items={starters} areas={areas} areaNames={areaNames} canUse={!!data.can_use} />
              {none && (
                <p className="text-sm text-muted-foreground" data-testid="reports-none">
                  No report matches{q ? ' “' + q + '”' : ''}{area ? ' in ' + areaNames[area] : ''}.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
