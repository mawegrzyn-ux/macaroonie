// src/pages/mobile/MobileHSDashboard.jsx
//
// Phone-portrait H&S Dashboard for the Ops app: the same named dashboards
// (as tabs), widgets and widget-body components as HSDashboard.jsx, single
// column and touch-first. Layout is read-only here: dashboards and widgets
// are added, removed and arranged on the desktop H&S Dashboard. Checks are
// still logged in place (tick checklists, enter temperatures).
// `col_span`/`height_px` are ignored: one full-width column at natural
// height, so the page scrolls as a single list.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ChecklistRunPanel, ChecklistHeaderAction, FREQUENCY_LABELS } from '@/components/checklists/shared'
import {
  TempChecksTable, DeliveryChecksPanel, HoldChecksTable, CookingChecksPanel,
} from '@/components/foodSafety/shared'
import { HSActionLogPanel } from '@/components/hsActionLog/shared'
import { AllergenLookup } from '@/components/menus/AllergenMatrix'
import { WIDGET_TYPE_BY_KEY } from '@/pages/HSDashboard'
import { ClosedDayNotice } from '@/components/hs/HsSettings'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function MobileWidgetCard({ widget, venueId, date }) {
  const isChecklist = widget.widget_type === 'checklist'
  const meta  = WIDGET_TYPE_BY_KEY[widget.widget_type]
  const title = widget.title_override || (isChecklist ? widget.checklist_name : meta.defaultTitle)
  const Icon  = meta.icon

  const template = isChecklist
    ? { id: widget.checklist_template_id, name: widget.checklist_name, frequency: widget.checklist_frequency }
    : null

  const [checklistState, setChecklistState] = useState(null)

  return (
    <div className="border rounded-xl bg-background shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5"
        style={{ background: 'var(--site-accent-soft, rgba(244,167,185,0.16))', borderBottom: '2px solid var(--site-accent, #f4a7b9)' }}>
        <span className="w-8 h-8 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold truncate">{title}</span>
          {isChecklist && (
            <span className="block text-xs text-muted-foreground">{FREQUENCY_LABELS[widget.checklist_frequency]}</span>
          )}
        </span>
        {isChecklist && <ChecklistHeaderAction state={checklistState} />}
      </div>

      <div className="p-3 overflow-x-auto">
        {widget.widget_type === 'checklist' && <ChecklistRunPanel template={template} date={date} hideHeader onStateChange={setChecklistState} />}
        {widget.widget_type === 'temp_checks' && <TempChecksTable venueId={venueId} date={date} />}
        {widget.widget_type === 'delivery_checks' && <DeliveryChecksPanel venueId={venueId} date={date} />}
        {widget.widget_type === 'hold_checks' && <HoldChecksTable venueId={venueId} date={date} />}
        {widget.widget_type === 'cooking_checks' && <CookingChecksPanel venueId={venueId} date={date} />}
        {widget.widget_type === 'action_log' && <HSActionLogPanel venueId={venueId} />}
        {widget.widget_type === 'allergen_lookup' && <AllergenLookup storeKey={`maca_allergen_lookup_${widget.id}`} />}
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

export default function MobileHSDashboard() {
  const api = useApi()

  const [venueId, setVenueId] = useState('')
  const [date, setDate] = useState(todayStr())
  const [activeDashboardId, setActiveDashboardId] = useState('')

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn: () => api.get('/venues'),
  })

  useEffect(() => {
    if (!venueId && venues.length) setVenueId(venues[0].id)
  }, [venues, venueId])

  const { data: dashboards = [] } = useQuery({
    queryKey: ['hs-dashboards', venueId],
    queryFn: () => api.get(`/hs-dashboards/dashboards?venue_id=${venueId}`),
    enabled: !!venueId,
  })

  useEffect(() => {
    if (!dashboards.some(d => d.id === activeDashboardId)) {
      setActiveDashboardId(dashboards[0]?.id ?? '')
    }
  }, [dashboards, activeDashboardId])

  const { data: widgets = [] } = useQuery({
    queryKey: ['hs-dashboard-widgets', activeDashboardId],
    queryFn: () => api.get(`/hs-dashboards/dashboards/${activeDashboardId}/widgets`),
    enabled: !!activeDashboardId,
  })

  const isToday = date === todayStr()
  function goDay(delta) {
    setDate(format(delta > 0 ? addDays(parseISO(date), 1) : subDays(parseISO(date), 1), 'yyyy-MM-dd'))
  }

  return (
    <div className="p-3 pb-8 space-y-3">
      {venues.length > 1 && (
        <select value={venueId} onChange={e => { setVenueId(e.target.value); setActiveDashboardId('') }}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-background min-h-[44px] touch-manipulation">
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}

      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => goDay(-1)} aria-label="Previous day"
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg border hover:bg-accent touch-manipulation">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="relative flex-1 min-w-0">
          <button type="button" className="w-full px-2 py-2.5 text-sm font-medium rounded-lg border touch-manipulation text-center whitespace-nowrap overflow-hidden text-ellipsis">
            {isToday ? 'Today' : format(parseISO(date), 'EEE d MMM yyyy')}
          </button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full" />
        </div>
        <button type="button" onClick={() => goDay(1)} aria-label="Next day"
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg border hover:bg-accent touch-manipulation">
          <ChevronRight className="w-5 h-5" />
        </button>
        {!isToday && (
          <button type="button" onClick={() => setDate(todayStr())}
            className="shrink-0 text-xs px-2.5 py-2.5 rounded-lg border hover:bg-accent touch-manipulation">
            Today
          </button>
        )}
      </div>

      {venueId && <ClosedDayNotice venueId={venueId} date={date} className="mb-3" />}

      {!venueId ? (
        <p className="text-muted-foreground text-sm py-12 text-center">Select a venue to begin.</p>
      ) : dashboards.length === 0 ? (
        <div className="border rounded-xl p-6 text-center">
          <LayoutGrid className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            No dashboards yet. Set one up on the H&amp;S Dashboard in the office admin.
          </p>
        </div>
      ) : (
        <>
          {dashboards.length > 1 && (
            <DashboardTabs dashboards={dashboards} activeId={activeDashboardId} onPick={setActiveDashboardId} />
          )}

          {widgets.length === 0 ? (
            <div className="border rounded-xl p-6 text-center">
              <p className="text-muted-foreground text-sm">
                Nothing on this dashboard yet. Add checklists and checks to it on the H&amp;S Dashboard in the office admin.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {widgets.map(w => (
                <MobileWidgetCard key={w.id} widget={w} venueId={venueId} date={date} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
