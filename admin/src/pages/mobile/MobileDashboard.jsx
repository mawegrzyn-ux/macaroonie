// src/pages/mobile/MobileDashboard.jsx
//
// MobileDashboardPage: the Ops app's phone-portrait view of any desktop
// dashboard kind (H&S: /mobile/hs-dashboard, blank Dashboards:
// /mobile/dashboards). Same named dashboards (as tabs), widgets and
// widget bodies as the desktop page (components/dashboards/widgetTypes.jsx),
// with the same shared navigator (components/dashboards/nav.jsx), single
// column and touch-first. Layout is read-only here: dashboards and widgets
// are added, removed and arranged on the desktop page. Checks are still
// logged in place (tick checklists, enter temperatures).
// `col_span`/`height_px` are ignored: one full-width column at natural
// height, so the page scrolls as a single list.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ChecklistHeaderAction, FREQUENCY_LABELS } from '@/components/checklists/shared'
import { ClosedDayNotice } from '@/components/hs/HsSettings'
import {
  WIDGET_TYPE_BY_KEY, canUseWidget, hasHsDayWidget, renderWidget, NoAccess,
} from '@/components/dashboards/widgetTypes'
import { useDashboardNav, navModeFor, DashboardNav } from '@/components/dashboards/nav'
import { useMe } from '@/components/staff/rota'

function MobileWidgetCard({ widget, venueId, ctx, me }) {
  const isChecklist = widget.widget_type === 'checklist'
  const meta  = WIDGET_TYPE_BY_KEY[widget.widget_type] ?? { label: widget.widget_type, icon: LayoutGrid, defaultTitle: widget.widget_type }
  const title = widget.title_override || (isChecklist ? widget.checklist_name : meta.defaultTitle)
  const Icon  = meta.icon
  const allowed = !!me && canUseWidget(meta, me)

  const template = isChecklist
    ? { id: widget.checklist_template_id, name: widget.checklist_name, frequency: widget.checklist_frequency }
    : null

  const [checklistState, setChecklistState] = useState(null)

  return (
    <div className="border rounded-xl bg-background shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 section-head">
        <span className="w-8 h-8 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold truncate">{title}</span>
          {isChecklist && (
            <span className="block text-xs text-muted-foreground">{FREQUENCY_LABELS[widget.checklist_frequency]}</span>
          )}
        </span>
        {meta.HeaderValue && allowed && <meta.HeaderValue widget={widget} venueId={venueId} ctx={ctx} />}
        {isChecklist && allowed && <ChecklistHeaderAction state={checklistState} />}
      </div>

      <div className={cn('overflow-x-auto', !meta.flush && 'p-3')}>
        {!me ? null
          : allowed ? renderWidget({ widget, venueId, ctx, template, onChecklistState: setChecklistState })
          : <NoAccess meta={meta} />}
      </div>
    </div>
  )
}

// Dashboard tabs: a framed strip that scrolls sideways, with small arrow
// buttons at each end while there is more to see that way.
function DashboardTabs({ dashboards, activeId, onPick }) {
  const ref = useRef(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
  }, [])
  useEffect(() => {
    measure()
    const el = ref.current
    if (!el) return
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [measure, dashboards.length])
  // Keep the chosen tab in view.
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])
  const nudge = dir => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: 'smooth' })

  return (
    <div className="flex items-stretch gap-1 rounded-xl border bg-muted/60 p-1">
      <button type="button" onClick={() => nudge(-1)} disabled={!edges.left} aria-label="Scroll tabs left"
        className="w-7 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground disabled:opacity-25 touch-manipulation">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div ref={ref} onScroll={measure} role="tablist"
        className="flex-1 min-w-0 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {dashboards.map(d => {
          const on = d.id === activeId
          return (
            <button key={d.id} type="button" role="tab" aria-selected={on} onClick={() => onPick(d.id)} title={d.name}
              className={cn(
                'shrink-0 px-3 rounded-lg text-sm font-medium truncate max-w-[180px] min-h-[44px] border touch-manipulation transition-colors',
                on ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-background text-foreground border-border',
              )}>
              {d.name}
            </button>
          )
        })}
      </div>
      <button type="button" onClick={() => nudge(1)} disabled={!edges.right} aria-label="Scroll tabs right"
        className="w-7 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground disabled:opacity-25 touch-manipulation">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}

export function MobileDashboardPage({ apiBase, keyPrefix, defaultNav = 'day', emptyText, emptyWidgetsText }) {
  const api = useApi()
  const nav = useDashboardNav()
  const { data: me } = useMe()

  const [venueId, setVenueId] = useState('')
  const [activeDashboardId, setActiveDashboardId] = useState('')

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn: () => api.get('/venues'),
  })

  useEffect(() => {
    if (!venueId && venues.length) setVenueId(venues[0].id)
  }, [venues, venueId])

  const { data: dashboards = [] } = useQuery({
    queryKey: [`${keyPrefix}-dashboards`, venueId],
    queryFn: () => api.get(`${apiBase}/dashboards?venue_id=${venueId}`),
    enabled: !!venueId,
  })

  useEffect(() => {
    if (!dashboards.some(d => d.id === activeDashboardId)) {
      setActiveDashboardId(dashboards[0]?.id ?? '')
    }
  }, [dashboards, activeDashboardId])

  const { data: widgets = [] } = useQuery({
    queryKey: [`${keyPrefix}-dashboard-widgets`, activeDashboardId],
    queryFn: () => api.get(`${apiBase}/dashboards/${activeDashboardId}/widgets`),
    enabled: !!activeDashboardId,
  })

  return (
    <div className="p-3 pb-8 space-y-3">
      {venues.length > 1 && (
        <select value={venueId} onChange={e => { setVenueId(e.target.value); setActiveDashboardId('') }}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-background min-h-[44px] touch-manipulation">
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}

      <DashboardNav nav={nav} mode={navModeFor(widgets, WIDGET_TYPE_BY_KEY, defaultNav)} mobile />

      {venueId && hasHsDayWidget(widgets) && <ClosedDayNotice venueId={venueId} date={nav.date} className="mb-3" />}

      {!venueId ? (
        <p className="text-muted-foreground text-sm py-12 text-center">Select a venue to begin.</p>
      ) : dashboards.length === 0 ? (
        <div className="border rounded-xl p-6 text-center">
          <LayoutGrid className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">{emptyText}</p>
        </div>
      ) : (
        <>
          {dashboards.length > 1 && (
            <DashboardTabs dashboards={dashboards} activeId={activeDashboardId} onPick={setActiveDashboardId} />
          )}

          {widgets.length === 0 ? (
            <div className="border rounded-xl p-6 text-center">
              <p className="text-muted-foreground text-sm">{emptyWidgetsText}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {widgets.map(w => (
                <MobileWidgetCard key={w.id} widget={w} venueId={venueId} ctx={nav.ctx} me={me} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function MobileDashboards() {
  return (
    <MobileDashboardPage
      apiBase="/custom-dashboards"
      keyPrefix="custom"
      emptyText="No dashboards yet. Create one on the Dashboards page in the office admin."
      emptyWidgetsText="Nothing on this dashboard yet. Add widgets to it on the Dashboards page in the office admin."
    />
  )
}
