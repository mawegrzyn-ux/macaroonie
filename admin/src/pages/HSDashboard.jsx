// src/pages/HSDashboard.jsx
//
// Customisable Health & Safety dashboard. Any number of named
// dashboards (shown as tabs), each holding any number of widgets —
// a checklist tick-list, the equipment temperature grid, or any of
// the other food-safety check logs (deliveries, hot/cold hold,
// cooking/reheat) — all driven by a single date navigator at the
// top. Widgets are directly interactive in place (enter temps, tick
// tasks, log a check) with no drill-down.
//
// Reuses the exact same data/tick/save logic as the Checklists and
// Food safety pages via their shared components, so there is only
// one implementation of each check type anywhere in the app.

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, addDays, subDays, parseISO } from 'date-fns'
import {
  Plus, Minus, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Pencil, Trash2, Check, ListChecks, Thermometer, Truck, Flame, ChefHat, LayoutGrid,
  Maximize2, Minimize2, ClipboardCheck,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ChecklistRunPanel, FREQUENCY_LABELS } from '@/components/checklists/shared'
import {
  TempChecksTable, DeliveryChecksPanel, HoldChecksTable, CookingChecksPanel,
} from '@/components/foodSafety/shared'
import { HSActionLogPanel } from '@/components/hsActionLog/shared'

// Single source of truth for widget-type metadata — drives both the
// "Add widget" type picker and the WidgetCard header/icon/default title.
const WIDGET_TYPES = [
  { key: 'checklist',       label: 'Checklist',              icon: ListChecks,  defaultTitle: 'Checklist' },
  { key: 'temp_checks',     label: 'Temperature checks',     icon: Thermometer, defaultTitle: 'Temperature checks' },
  { key: 'delivery_checks', label: 'Delivery checks',        icon: Truck,       defaultTitle: 'Delivery checks' },
  { key: 'hold_checks',     label: 'Hot / cold hold checks', icon: Flame,       defaultTitle: 'Hot / cold hold checks' },
  { key: 'cooking_checks',  label: 'Cooking / reheat checks',icon: ChefHat,     defaultTitle: 'Cooking / reheat checks' },
  { key: 'action_log',      label: 'Action log',             icon: ClipboardCheck, defaultTitle: 'Action log' },
]
export const WIDGET_TYPE_BY_KEY = Object.fromEntries(WIDGET_TYPES.map(w => [w.key, w]))

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// ── Add / rename dashboard modal ───────────────────────────────

export function DashboardModal({ initial, onClose, onSave, isSaving }) {
  const [name, setName] = useState(initial?.name ?? '')

  function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSave(name.trim())
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-sm max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{initial ? 'Rename dashboard' : 'New dashboard'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} required autoFocus
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]"
              placeholder="Kitchen" />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={isSaving || !name.trim()}
              className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-sm min-h-[44px]">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Add widget modal ────────────────────────────────────────────

export function AddWidgetModal({ venueId, api, onClose, onSave, isSaving }) {
  const [widgetType, setWidgetType] = useState('checklist')
  const [templateId, setTemplateId] = useState('')
  const [titleOverride, setTitleOverride] = useState('')

  const { data: templates = [] } = useQuery({
    queryKey: ['checklist-templates', venueId],
    queryFn: () => api.get(`/checklists/templates?venue_id=${venueId}`),
    enabled: !!venueId,
  })

  useEffect(() => {
    if (widgetType === 'checklist' && !templateId && templates.length) setTemplateId(templates[0].id)
  }, [widgetType, templates, templateId])

  function submit(e) {
    e.preventDefault()
    if (widgetType === 'checklist' && !templateId) return
    onSave({
      widget_type: widgetType,
      checklist_template_id: widgetType === 'checklist' ? templateId : null,
      title_override: titleOverride.trim() || null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add widget</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Widget type</label>
            <div className="space-y-1.5">
              {WIDGET_TYPES.map(wt => {
                const Icon = wt.icon
                return (
                  <button key={wt.key} type="button" onClick={() => setWidgetType(wt.key)}
                    className={cn(
                      'w-full flex items-center gap-2.5 border rounded-xl px-3 py-2.5 text-sm font-medium touch-manipulation min-h-[48px]',
                      widgetType === wt.key ? 'border-primary bg-primary/5 text-primary' : 'hover:bg-accent',
                    )}>
                    <Icon className="w-4 h-4 shrink-0" /> {wt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {widgetType === 'checklist' && (
            <div>
              <label className="block text-sm font-medium mb-1">Checklist *</label>
              {templates.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No checklists set up for this venue yet — create one on the Checklists page first.
                </p>
              ) : (
                <select value={templateId} onChange={e => setTemplateId(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]">
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Card title (optional)</label>
            <input value={titleOverride} onChange={e => setTitleOverride(e.target.value)}
              placeholder={widgetType === 'checklist'
                ? (templates.find(t => t.id === templateId)?.name ?? '')
                : WIDGET_TYPE_BY_KEY[widgetType].defaultTitle}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={isSaving || (widgetType === 'checklist' && !templateId)}
              className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50">
              {isSaving ? 'Adding…' : 'Add widget'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-sm min-h-[44px]">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── One widget card ──────────────────────────────────────────────

const MIN_COL_SPAN = 1
const MIN_HEIGHT_PX = 240
const MAX_HEIGHT_PX = 1200
const HEIGHT_STEP_PX = 120

function WidgetCard({
  widget, venueId, date, editing, columnCount,
  onRemove, onMoveUp, onMoveDown, isFirst, isLast,
  onResizeWidth, onResizeHeight,
}) {
  const isChecklist = widget.widget_type === 'checklist'
  const meta  = WIDGET_TYPE_BY_KEY[widget.widget_type]
  const title = widget.title_override || (isChecklist ? widget.checklist_name : meta.defaultTitle)
  const Icon  = meta.icon

  const template = isChecklist
    ? { id: widget.checklist_template_id, name: widget.checklist_name, frequency: widget.checklist_frequency }
    : null

  // Handed up by ChecklistRunPanel (via its hideHeader mode) so the
  // complete action can live in this card's own title bar instead of a
  // full-width button at the bottom of the checklist.
  const [checklistState, setChecklistState] = useState(null)
  const [confirmReopen, setConfirmReopen] = useState(false)
  useEffect(() => { if (!checklistState?.isCompleted) setConfirmReopen(false) }, [checklistState?.isCompleted])

  const colSpan  = Math.min(widget.col_span ?? 1, columnCount)
  const heightPx = widget.height_px ?? 480

  return (
    <div
      style={{ gridColumn: `span ${colSpan}` }}
      className={cn(
        'border rounded-xl bg-background shadow-sm overflow-hidden flex flex-col',
        editing && 'ring-1 ring-primary/30 border-dashed',
      )}>
      <div className="flex items-center gap-2 px-4 py-3"
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
        {isChecklist && !editing && checklistState && (
          checklistState.isCompleted ? (
            confirmReopen ? (
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => { checklistState.reopen(); setConfirmReopen(false) }} disabled={checklistState.isPending}
                  className="text-xs font-medium px-2 py-1.5 rounded-md bg-amber-600 text-white disabled:opacity-50 min-h-[32px] touch-manipulation">
                  {checklistState.isPending ? 'Working…' : 'Yes, reopen'}
                </button>
                <button type="button" onClick={() => setConfirmReopen(false)}
                  className="text-xs font-medium px-2 py-1.5 rounded-md border min-h-[32px] touch-manipulation">
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmReopen(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded-md px-1.5 py-1.5 min-h-[32px] shrink-0 touch-manipulation"
                title="Tap to reopen">
                <Check className="w-3.5 h-3.5" /> Complete
              </button>
            )
          ) : (
            <button type="button" onClick={checklistState.markComplete} disabled={checklistState.isPending}
              className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50 min-h-[32px] touch-manipulation">
              {checklistState.isPending ? 'Saving…' : 'Complete'}
            </button>
          )
        )}
        {editing && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" onClick={onMoveUp} disabled={isFirst}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation"
              aria-label="Move widget earlier">
              <ChevronUp className="w-4 h-4" />
            </button>
            <button type="button" onClick={onMoveDown} disabled={isLast}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation"
              aria-label="Move widget later">
              <ChevronDown className="w-4 h-4" />
            </button>
            <button type="button" onClick={onRemove}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent text-destructive touch-manipulation"
              aria-label="Remove widget">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2 border-b bg-muted/10 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Width</span>
            <button type="button" onClick={() => onResizeWidth(-1)} disabled={colSpan <= MIN_COL_SPAN}
              className="w-7 h-7 flex items-center justify-center rounded border hover:bg-accent disabled:opacity-30 touch-manipulation"
              aria-label="Narrower">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="w-10 text-center font-medium">{colSpan}/{columnCount}</span>
            <button type="button" onClick={() => onResizeWidth(1)} disabled={colSpan >= columnCount}
              className="w-7 h-7 flex items-center justify-center rounded border hover:bg-accent disabled:opacity-30 touch-manipulation"
              aria-label="Wider">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Height</span>
            <button type="button" onClick={() => onResizeHeight(-HEIGHT_STEP_PX)} disabled={heightPx <= MIN_HEIGHT_PX}
              className="w-7 h-7 flex items-center justify-center rounded border hover:bg-accent disabled:opacity-30 touch-manipulation"
              aria-label="Shorter">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="w-14 text-center font-medium">{heightPx}px</span>
            <button type="button" onClick={() => onResizeHeight(HEIGHT_STEP_PX)} disabled={heightPx >= MAX_HEIGHT_PX}
              className="w-7 h-7 flex items-center justify-center rounded border hover:bg-accent disabled:opacity-30 touch-manipulation"
              aria-label="Taller">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="p-4 overflow-y-auto" style={{ height: heightPx }}>
        {widget.widget_type === 'checklist' && <ChecklistRunPanel template={template} date={date} hideHeader onStateChange={setChecklistState} />}
        {widget.widget_type === 'temp_checks' && <TempChecksTable venueId={venueId} date={date} />}
        {widget.widget_type === 'delivery_checks' && <DeliveryChecksPanel venueId={venueId} date={date} />}
        {widget.widget_type === 'hold_checks' && <HoldChecksTable venueId={venueId} date={date} />}
        {widget.widget_type === 'cooking_checks' && <CookingChecksPanel venueId={venueId} date={date} />}
        {widget.widget_type === 'action_log' && <HSActionLogPanel venueId={venueId} />}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────

export default function HSDashboard() {
  const api = useApi()
  const qc = useQueryClient()
  const containerRef = useRef(null)

  const [venueId, setVenueId] = useState('')
  const [date, setDate] = useState(todayStr())
  const [activeDashboardId, setActiveDashboardId] = useState('')
  const [editing, setEditing] = useState(false)
  const [dashModal, setDashModal] = useState(null) // 'new' | dashboard row | null
  const [confirmDeleteDash, setConfirmDeleteDash] = useState(false)
  const [addWidgetOpen, setAddWidgetOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    function handler() { setIsFullscreen(document.fullscreenElement === containerRef.current) }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])
  function toggleFullscreen() {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen?.()
    else document.exitFullscreen?.()
  }

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

  const invalidateDashboards = () => qc.invalidateQueries({ queryKey: ['hs-dashboards', venueId] })
  const invalidateWidgets    = () => qc.invalidateQueries({ queryKey: ['hs-dashboard-widgets', activeDashboardId] })

  const createDashboard = useMutation({
    mutationFn: name => api.post('/hs-dashboards/dashboards', { venue_id: venueId, name }),
    onSuccess: (row) => { invalidateDashboards(); setDashModal(null); setActiveDashboardId(row.id) },
  })
  const patchDashboard = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/hs-dashboards/dashboards/${id}`, body),
    onSuccess: () => { invalidateDashboards(); setDashModal(null) },
  })
  const deleteDashboard = useMutation({
    mutationFn: id => api.delete(`/hs-dashboards/dashboards/${id}`),
    onSuccess: () => { invalidateDashboards(); setConfirmDeleteDash(false); setActiveDashboardId('') },
  })
  const reorderDashboards = useMutation({
    mutationFn: ids => api.put('/hs-dashboards/dashboards/reorder', { venue_id: venueId, ids }),
    onSuccess: invalidateDashboards,
  })

  const createWidget = useMutation({
    mutationFn: body => api.post(`/hs-dashboards/dashboards/${activeDashboardId}/widgets`, body),
    onSuccess: () => { invalidateWidgets(); setAddWidgetOpen(false) },
  })
  const removeWidget = useMutation({
    mutationFn: id => api.delete(`/hs-dashboards/dashboards/${activeDashboardId}/widgets/${id}`),
    onSuccess: invalidateWidgets,
  })
  const reorderWidgets = useMutation({
    mutationFn: ids => api.put(`/hs-dashboards/dashboards/${activeDashboardId}/widgets/reorder`, { ids }),
    onSuccess: invalidateWidgets,
  })
  const patchWidget = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/hs-dashboards/dashboards/${activeDashboardId}/widgets/${id}`, body),
    onSuccess: invalidateWidgets,
  })

  function moveWidget(idx, dir) {
    const next = [...widgets]
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= next.length) return
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    reorderWidgets.mutate(next.map(w => w.id))
  }

  function moveDashboard(dir) {
    const idx = dashboards.findIndex(d => d.id === activeDashboardId)
    const next = [...dashboards]
    const swapIdx = idx + dir
    if (idx < 0 || swapIdx < 0 || swapIdx >= next.length) return
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    reorderDashboards.mutate(next.map(d => d.id))
  }

  const isToday = date === todayStr()
  function goDay(delta) {
    setDate(format(delta > 0 ? addDays(parseISO(date), 1) : subDays(parseISO(date), 1), 'yyyy-MM-dd'))
  }

  const activeDashboard = dashboards.find(d => d.id === activeDashboardId) ?? null
  const activeIdx = dashboards.findIndex(d => d.id === activeDashboardId)
  const columnCount = activeDashboard?.column_count ?? 4

  function setColumnCount(delta) {
    if (!activeDashboard) return
    const next = Math.min(6, Math.max(1, columnCount + delta))
    if (next === columnCount) return
    patchDashboard.mutate({ id: activeDashboard.id, column_count: next })
  }

  function resizeWidget(widget, field, value) {
    patchWidget.mutate({ id: widget.id, [field]: value })
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'p-4 md:p-6 bg-background overflow-y-auto',
        isFullscreen ? 'w-screen h-screen' : 'h-full w-[90%] mx-auto',
      )}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LayoutGrid className="w-6 h-6 text-primary" /> H&amp;S Dashboard
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {venues.length > 1 && (
            <select value={venueId} onChange={e => { setVenueId(e.target.value); setActiveDashboardId('') }}
              className="border rounded px-3 py-2 text-sm bg-background min-h-[44px]">
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          {dashboards.length > 0 && (
            <button type="button" onClick={() => setEditing(e => !e)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium min-h-[44px] touch-manipulation',
                editing ? 'bg-primary text-primary-foreground' : 'border hover:bg-accent',
              )}>
              {editing ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
              {editing ? 'Done editing' : 'Edit layout'}
            </button>
          )}
          <button type="button" onClick={toggleFullscreen} title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border hover:bg-accent px-3 py-2 text-sm font-medium min-h-[44px] touch-manipulation">
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            {isFullscreen ? 'Exit' : 'Full screen'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={() => goDay(-1)}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg border hover:bg-accent touch-manipulation">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="relative">
            <button type="button" className="w-60 shrink-0 px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-accent touch-manipulation text-center whitespace-nowrap overflow-hidden text-ellipsis">
              {isToday ? 'Today' : format(parseISO(date), 'EEEE d MMMM yyyy')}
            </button>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full" />
          </div>
          <button type="button" onClick={() => goDay(1)}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg border hover:bg-accent touch-manipulation">
            <ChevronRight className="w-5 h-5" />
          </button>
          {!isToday && (
            <button type="button" onClick={() => setDate(todayStr())}
              className="text-xs px-2.5 py-1.5 rounded-lg border hover:bg-accent touch-manipulation ml-1">
              Today
            </button>
          )}
        </div>

        {dashboards.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto min-w-0">
            {dashboards.map(d => (
              <button key={d.id} type="button" onClick={() => setActiveDashboardId(d.id)} title={d.name}
                className={cn(
                  'w-36 shrink-0 px-3 py-1.5 rounded-md text-sm font-medium truncate text-center transition-colors touch-manipulation',
                  d.id === activeDashboardId ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                )}>
                {d.name}
              </button>
            ))}
            {editing && (
              <button type="button" onClick={() => setDashModal('new')}
                className="w-9 h-9 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent touch-manipulation"
                aria-label="Add dashboard">
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {!venueId ? (
        <p className="text-muted-foreground text-sm py-12 text-center">Select a venue to begin.</p>
      ) : dashboards.length === 0 ? (
        <div className="border rounded-xl p-10 text-center">
          <LayoutGrid className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm mb-4">No dashboards yet. Create one to start adding checklist and temperature-check widgets.</p>
          <button type="button" onClick={() => setDashModal('new')}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] touch-manipulation">
            <Plus className="w-4 h-4" /> Create dashboard
          </button>
        </div>
      ) : (
        <>
          {editing && activeDashboard && (
            <div className="flex flex-wrap items-center gap-1.5 mb-4 text-xs">
              <span className="text-muted-foreground mr-1">Editing "{activeDashboard.name}":</span>
              <button type="button" onClick={() => moveDashboard(-1)} disabled={activeIdx <= 0}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation"
                aria-label="Move dashboard earlier">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => moveDashboard(1)} disabled={activeIdx < 0 || activeIdx >= dashboards.length - 1}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation"
                aria-label="Move dashboard later">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => setDashModal(activeDashboard)}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded hover:bg-accent touch-manipulation">
                <Pencil className="w-3.5 h-3.5" /> Rename
              </button>
              <span className="w-px h-5 bg-border mx-1" />
              <span className="text-muted-foreground">Columns</span>
              <button type="button" onClick={() => setColumnCount(-1)} disabled={columnCount <= 1}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation"
                aria-label="Fewer columns">
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="w-4 text-center font-medium">{columnCount}</span>
              <button type="button" onClick={() => setColumnCount(1)} disabled={columnCount >= 6}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation"
                aria-label="More columns">
                <Plus className="w-3.5 h-3.5" />
              </button>
              <span className="w-px h-5 bg-border mx-1" />
              {confirmDeleteDash ? (
                <>
                  <button type="button" onClick={() => deleteDashboard.mutate(activeDashboard.id)} disabled={deleteDashboard.isPending}
                    className="px-2.5 py-1.5 bg-destructive text-destructive-foreground rounded font-medium touch-manipulation">
                    Confirm delete
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteDash(false)}
                    className="px-2.5 py-1.5 border rounded touch-manipulation">Cancel</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDeleteDash(true)}
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded hover:bg-accent text-destructive touch-manipulation">
                  <Trash2 className="w-3.5 h-3.5" /> Delete dashboard
                </button>
              )}
            </div>
          )}

          {editing && (
            <div className="flex justify-end mb-3">
              <button type="button" onClick={() => setAddWidgetOpen(true)}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] touch-manipulation">
                <Plus className="w-4 h-4" /> Add widget
              </button>
            </div>
          )}

          {widgets.length === 0 ? (
            <div className="border rounded-xl p-10 text-center">
              <p className="text-muted-foreground text-sm mb-4">
                No widgets on this dashboard yet. Add a checklist or the temperature-check grid.
              </p>
              <button type="button" onClick={() => setAddWidgetOpen(true)}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] touch-manipulation">
                <Plus className="w-4 h-4" /> Add widget
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(240px, 1fr))` }}>
                {widgets.map((w, idx) => (
                  <WidgetCard
                    key={w.id}
                    widget={w}
                    venueId={venueId}
                    date={date}
                    editing={editing}
                    columnCount={columnCount}
                    isFirst={idx === 0}
                    isLast={idx === widgets.length - 1}
                    onMoveUp={() => moveWidget(idx, -1)}
                    onMoveDown={() => moveWidget(idx, 1)}
                    onRemove={() => removeWidget.mutate(w.id)}
                    onResizeWidth={delta => resizeWidget(w, 'col_span', Math.min(columnCount, Math.max(1, (w.col_span ?? 1) + delta)))}
                    onResizeHeight={delta => resizeWidget(w, 'height_px', Math.min(1200, Math.max(240, (w.height_px ?? 480) + delta)))}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {dashModal && (
        <DashboardModal
          initial={dashModal === 'new' ? null : dashModal}
          isSaving={createDashboard.isPending || patchDashboard.isPending}
          onClose={() => setDashModal(null)}
          onSave={name => dashModal === 'new'
            ? createDashboard.mutate(name)
            : patchDashboard.mutate({ id: dashModal.id, name })}
        />
      )}

      {addWidgetOpen && (
        <AddWidgetModal
          venueId={venueId}
          api={api}
          isSaving={createWidget.isPending}
          onClose={() => setAddWidgetOpen(false)}
          onSave={body => createWidget.mutate(body)}
        />
      )}
    </div>
  )
}
