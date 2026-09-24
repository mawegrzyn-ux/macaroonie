// src/pages/mobile/MobileHSDashboard.jsx
//
// Phone-portrait rebuild of HSDashboard.jsx with the same full
// functionality (multiple named dashboards, add/remove/reorder widgets,
// tick checklists, log checks) — just single-column and touch-first
// instead of a resizable multi-column grid. Reuses the exact same API
// endpoints/mutations and the exact same widget-body components as the
// desktop page, so there is only one implementation of each check type.
// `col_span`/`height_px` (the desktop grid-sizing fields) are simply
// ignored here — mobile always renders one full-width column with
// natural content height so the page scrolls as a single list, never a
// widget-in-a-widget nested scroll region.

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, addDays, subDays, parseISO } from 'date-fns'
import {
  Plus, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Pencil, Trash2, Check, LayoutGrid,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ChecklistRunPanel, FREQUENCY_LABELS } from '@/components/checklists/shared'
import {
  TempChecksTable, DeliveryChecksPanel, HoldChecksTable, CookingChecksPanel,
} from '@/components/foodSafety/shared'
import { HSActionLogPanel } from '@/components/hsActionLog/shared'
import { DashboardModal, AddWidgetModal, WIDGET_TYPE_BY_KEY } from '@/pages/HSDashboard'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function MobileWidgetCard({ widget, venueId, date, editing, onRemove, onMoveUp, onMoveDown, isFirst, isLast }) {
  const isChecklist = widget.widget_type === 'checklist'
  const meta  = WIDGET_TYPE_BY_KEY[widget.widget_type]
  const title = widget.title_override || (isChecklist ? widget.checklist_name : meta.defaultTitle)
  const Icon  = meta.icon

  const template = isChecklist
    ? { id: widget.checklist_template_id, name: widget.checklist_name, frequency: widget.checklist_frequency }
    : null

  const [checklistState, setChecklistState] = useState(null)
  const [confirmReopen, setConfirmReopen] = useState(false)
  useEffect(() => { if (!checklistState?.isCompleted) setConfirmReopen(false) }, [checklistState?.isCompleted])

  return (
    <div className={cn(
      'border rounded-xl bg-background shadow-sm overflow-hidden',
      editing && 'ring-1 ring-primary/30 border-dashed',
    )}>
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
        {isChecklist && !editing && checklistState && (
          checklistState.isCompleted ? (
            confirmReopen ? (
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => { checklistState.reopen(); setConfirmReopen(false) }} disabled={checklistState.isPending}
                  className="text-xs font-medium px-2 py-1.5 rounded-md bg-amber-600 text-white disabled:opacity-50 min-h-[36px] touch-manipulation">
                  {checklistState.isPending ? 'Working…' : 'Reopen'}
                </button>
                <button type="button" onClick={() => setConfirmReopen(false)}
                  className="text-xs font-medium px-2 py-1.5 rounded-md border min-h-[36px] touch-manipulation">
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmReopen(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded-md px-1.5 py-1.5 min-h-[36px] shrink-0 touch-manipulation">
                <Check className="w-3.5 h-3.5" /> Done
              </button>
            )
          ) : (
            <button type="button" onClick={checklistState.markComplete} disabled={checklistState.isPending}
              className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50 min-h-[36px] touch-manipulation">
              {checklistState.isPending ? 'Saving…' : 'Complete'}
            </button>
          )
        )}
        {editing && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" onClick={onMoveUp} disabled={isFirst}
              className="w-9 h-9 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation"
              aria-label="Move widget earlier">
              <ChevronUp className="w-4 h-4" />
            </button>
            <button type="button" onClick={onMoveDown} disabled={isLast}
              className="w-9 h-9 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation"
              aria-label="Move widget later">
              <ChevronDown className="w-4 h-4" />
            </button>
            <button type="button" onClick={onRemove}
              className="w-9 h-9 flex items-center justify-center rounded hover:bg-accent text-destructive touch-manipulation"
              aria-label="Remove widget">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <div className="p-3 overflow-x-auto">
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

export default function MobileHSDashboard() {
  const api = useApi()
  const qc = useQueryClient()

  const [venueId, setVenueId] = useState('')
  const [date, setDate] = useState(todayStr())
  const [activeDashboardId, setActiveDashboardId] = useState('')
  const [editing, setEditing] = useState(false)
  const [dashModal, setDashModal] = useState(null)
  const [confirmDeleteDash, setConfirmDeleteDash] = useState(false)
  const [addWidgetOpen, setAddWidgetOpen] = useState(false)

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

  return (
    <div className="p-3 pb-8 space-y-3">
      <div className="flex items-center gap-2">
        {venues.length > 1 && (
          <select value={venueId} onChange={e => { setVenueId(e.target.value); setActiveDashboardId('') }}
            className="flex-1 min-w-0 border rounded-lg px-3 py-2 text-sm bg-background min-h-[44px] touch-manipulation">
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
        {dashboards.length > 0 && (
          <button type="button" onClick={() => setEditing(e => !e)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium min-h-[44px] touch-manipulation shrink-0',
              venues.length <= 1 && 'flex-1',
              editing ? 'bg-primary text-primary-foreground' : 'border hover:bg-accent',
            )}>
            {editing ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
            {editing ? 'Done' : 'Edit layout'}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => goDay(-1)}
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
        <button type="button" onClick={() => goDay(1)}
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

      {!venueId ? (
        <p className="text-muted-foreground text-sm py-12 text-center">Select a venue to begin.</p>
      ) : dashboards.length === 0 ? (
        <div className="border rounded-xl p-6 text-center">
          <LayoutGrid className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm mb-4">No dashboards yet. Create one to start adding checklist and temperature-check widgets.</p>
          <button type="button" onClick={() => setDashModal('new')}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] touch-manipulation">
            <Plus className="w-4 h-4" /> Create dashboard
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-3 px-3">
            {dashboards.map(d => (
              <button key={d.id} type="button" onClick={() => setActiveDashboardId(d.id)} title={d.name}
                className={cn(
                  'shrink-0 px-3 py-2 rounded-md text-sm font-medium truncate text-center transition-colors touch-manipulation max-w-[160px] min-h-[40px]',
                  d.id === activeDashboardId ? 'bg-primary text-primary-foreground' : 'text-muted-foreground bg-muted/40 hover:bg-accent',
                )}>
                {d.name}
              </button>
            ))}
            {editing && (
              <button type="button" onClick={() => setDashModal('new')}
                className="w-10 h-10 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent touch-manipulation"
                aria-label="Add dashboard">
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>

          {editing && activeDashboard && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs border rounded-lg p-2">
              <span className="text-muted-foreground w-full mb-0.5">Editing "{activeDashboard.name}"</span>
              <button type="button" onClick={() => moveDashboard(-1)} disabled={activeIdx <= 0}
                className="w-9 h-9 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation"
                aria-label="Move dashboard earlier">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => moveDashboard(1)} disabled={activeIdx < 0 || activeIdx >= dashboards.length - 1}
                className="w-9 h-9 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation"
                aria-label="Move dashboard later">
                <ChevronRight className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => setDashModal(activeDashboard)}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded hover:bg-accent touch-manipulation min-h-[36px]">
                <Pencil className="w-3.5 h-3.5" /> Rename
              </button>
              {confirmDeleteDash ? (
                <>
                  <button type="button" onClick={() => deleteDashboard.mutate(activeDashboard.id)} disabled={deleteDashboard.isPending}
                    className="px-2.5 py-2 bg-destructive text-destructive-foreground rounded font-medium touch-manipulation min-h-[36px]">
                    Confirm delete
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteDash(false)}
                    className="px-2.5 py-2 border rounded touch-manipulation min-h-[36px]">Cancel</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDeleteDash(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-2 rounded hover:bg-accent text-destructive touch-manipulation min-h-[36px]">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
            </div>
          )}

          {editing && (
            <button type="button" onClick={() => setAddWidgetOpen(true)}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium min-h-[44px] touch-manipulation">
              <Plus className="w-4 h-4" /> Add widget
            </button>
          )}

          {widgets.length === 0 ? (
            <div className="border rounded-xl p-6 text-center">
              <p className="text-muted-foreground text-sm mb-4">
                No widgets on this dashboard yet. Add a checklist or the temperature-check grid.
              </p>
              <button type="button" onClick={() => setAddWidgetOpen(true)}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] touch-manipulation">
                <Plus className="w-4 h-4" /> Add widget
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {widgets.map((w, idx) => (
                <MobileWidgetCard
                  key={w.id}
                  widget={w}
                  venueId={venueId}
                  date={date}
                  editing={editing}
                  isFirst={idx === 0}
                  isLast={idx === widgets.length - 1}
                  onMoveUp={() => moveWidget(idx, -1)}
                  onMoveDown={() => moveWidget(idx, 1)}
                  onRemove={() => removeWidget.mutate(w.id)}
                />
              ))}
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
