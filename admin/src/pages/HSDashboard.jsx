// src/pages/HSDashboard.jsx
//
// Customisable Health & Safety dashboard, and DashboardPage, the engine
// every dashboard runs on. Any number of named dashboards (shown as tabs)
// per venue, each holding any number of widgets behind one date navigator.
// Widgets are directly interactive in place (enter temps, tick tasks, log a
// check, edit the reconciliation grid) with no drill-down.
//
// Every dashboard can hold every widget (migration 152): the catalog,
// renderers and per-widget module checks live in
// components/dashboards/widgetTypes.jsx, the navigator in
// components/dashboards/nav.jsx. Each widget reuses the same component as
// its own page (Checklists, Food safety, Cash Recon, Rota), so there is
// only one implementation of each anywhere in the app.
//
// The page shell (tabs, edit mode, widget CRUD, row-spanning grid, full
// screen) is DashboardPage, driven by a config object. The H&S Dashboard is
// one config (below); Cash (CashDashboard.jsx), Rota (RotaDashboard.jsx)
// and the blank Dashboards page (Dashboards.jsx) are the others. A config
// only picks the API mount, title, which widget group Add widget lists
// first, and the navigator to show while a dashboard is empty.

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Minus, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Pencil, Trash2, Check, LayoutGrid, Maximize2, Minimize2,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MIN_ROWS, MAX_ROWS, rowSpanFor, heightForRows, gridStyle } from '@/lib/dashboardGrid'
import { ChecklistHeaderAction, FREQUENCY_LABELS } from '@/components/checklists/shared'
import { TitleRename } from '@/components/dashboards/TitleRename'
import { HsSettingsButton, ClosedDayNotice } from '@/components/hs/HsSettings'
import {
  WIDGET_TYPES, WIDGET_TYPE_BY_KEY, WIDGET_GROUPS, canUseWidget, hasHsDayWidget, renderWidget, NoAccess,
} from '@/components/dashboards/widgetTypes'
import { useDashboardNav, navModeFor, DashboardNav } from '@/components/dashboards/nav'
import { useMe } from '@/components/staff/rota'

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

export function AddWidgetModal({ venueId, api, me, primaryGroup, onClose, onSave, isSaving }) {
  // Every widget type, grouped, with the page's own group first. Types the
  // person can't see (no view on the widget's module) aren't offered.
  const groups = [...WIDGET_GROUPS]
    .sort((a, b) => (b.key === primaryGroup) - (a.key === primaryGroup))
    .map(g => ({ ...g, types: WIDGET_TYPES.filter(t => t.group === g.key && canUseWidget(t, me)) }))
    .filter(g => g.types.length)
  const available = groups.flatMap(g => g.types)
  const hiddenCount = WIDGET_TYPES.length - available.length

  const [widgetType, setWidgetType] = useState(available[0]?.key ?? '')
  const [templateId, setTemplateId] = useState('')
  const [titleOverride, setTitleOverride] = useState('')
  const meta = WIDGET_TYPE_BY_KEY[widgetType]
  const needsChecklist = !!meta?.needsChecklist

  const { data: templates = [] } = useQuery({
    queryKey: ['checklist-templates', venueId],
    queryFn: () => api.get(`/checklists/templates?venue_id=${venueId}`),
    enabled: !!venueId && available.some(w => w.needsChecklist),
  })

  useEffect(() => {
    if (!widgetType && available.length) setWidgetType(available[0].key)
  }, [available, widgetType])

  useEffect(() => {
    if (needsChecklist && !templateId && templates.length) setTemplateId(templates[0].id)
  }, [needsChecklist, templates, templateId])

  function submit(e) {
    e.preventDefault()
    if (!widgetType || (needsChecklist && !templateId)) return
    onSave({
      widget_type: widgetType,
      checklist_template_id: needsChecklist ? templateId : null,
      title_override: titleOverride.trim() || null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add widget</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You don't have access to any of the areas widgets show (H&amp;S, menus, cash, rota).
            </p>
          ) : (
            <div className="space-y-3">
              {groups.map(g => (
                <div key={g.key}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{g.label}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {g.types.map(wt => {
                      const Icon = wt.icon
                      return (
                        <button key={wt.key} type="button" onClick={() => setWidgetType(wt.key)}
                          aria-pressed={widgetType === wt.key}
                          className={cn(
                            'w-full flex items-center gap-2.5 border rounded-xl px-3 py-2.5 text-sm font-medium text-left touch-manipulation min-h-[48px]',
                            widgetType === wt.key ? 'border-primary bg-primary/5 text-primary' : 'hover:bg-accent',
                          )}>
                          <Icon className="w-4 h-4 shrink-0" /> <span className="min-w-0">{wt.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {hiddenCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {hiddenCount === 1 ? 'One widget isn\'t' : `${hiddenCount} widgets aren't`} listed because you don't have access to the area {hiddenCount === 1 ? 'it shows' : 'they show'}.
                </p>
              )}
            </div>
          )}

          {needsChecklist && (
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

          {meta && (
            <div>
              <label className="block text-sm font-medium mb-1">Card title (optional)</label>
              <input value={titleOverride} onChange={e => setTitleOverride(e.target.value)}
                placeholder={needsChecklist
                  ? (templates.find(t => t.id === templateId)?.name ?? '')
                  : meta.defaultTitle}
                className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={isSaving || !meta || (needsChecklist && !templateId)}
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

function WidgetCard({
  widget, venueId, ctx, editing, columnCount, me,
  onRemove, onMoveUp, onMoveDown, isFirst, isLast,
  onResizeWidth, onResizeRows, onSetting, onRename, isRenaming,
}) {
  const isChecklist = widget.widget_type === 'checklist'
  const meta  = WIDGET_TYPE_BY_KEY[widget.widget_type] ?? { label: widget.widget_type, icon: LayoutGrid, defaultTitle: widget.widget_type }
  // A dashboard can hold any widget, so someone may see a dashboard with a
  // widget from an area they can't open: show a note instead of its body.
  const allowed = !!me && canUseWidget(meta, me)
  const defaultTitle = isChecklist ? widget.checklist_name : meta.defaultTitle
  const title = widget.title_override || defaultTitle
  const Icon  = meta.icon

  const template = isChecklist
    ? { id: widget.checklist_template_id, name: widget.checklist_name, frequency: widget.checklist_frequency }
    : null

  // Handed up by ChecklistRunPanel (via its hideHeader mode) so Tick all
  // can live in this card's own title bar (ChecklistHeaderAction).
  const [checklistState, setChecklistState] = useState(null)

  const colSpan  = Math.min(widget.col_span ?? 1, columnCount)
  const rows     = rowSpanFor(widget.height_px ?? 480)

  return (
    <div
      style={{ gridColumn: `span ${colSpan}`, gridRow: `span ${rows}` }}
      className={cn(
        'border rounded-xl bg-background shadow-sm overflow-hidden flex flex-col',
        editing && 'ring-1 ring-primary/30 border-dashed',
      )}>
      <div className="flex items-center gap-2 px-4 py-3 section-head">
        <span className="w-8 h-8 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold truncate">{title}</span>
          {isChecklist && (
            <span className="block text-xs text-muted-foreground">{FREQUENCY_LABELS[widget.checklist_frequency]}</span>
          )}
        </span>
        {meta.HeaderValue && !editing && allowed && (
          <meta.HeaderValue widget={widget} venueId={venueId} ctx={ctx} />
        )}
        {isChecklist && !editing && allowed && <ChecklistHeaderAction state={checklistState} />}
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
        <TitleRename
          title={title}
          defaultTitle={defaultTitle}
          isCustom={!!widget.title_override}
          maxLength={200}
          isSaving={isRenaming}
          onSave={onRename}
        />
      )}

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
            <button type="button" onClick={() => onResizeRows(rows - 1)} disabled={rows <= MIN_ROWS}
              className="w-7 h-7 flex items-center justify-center rounded border hover:bg-accent disabled:opacity-30 touch-manipulation"
              aria-label="Shorter">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="w-16 text-center font-medium">{rows} rows</span>
            <button type="button" onClick={() => onResizeRows(rows + 1)} disabled={rows >= MAX_ROWS}
              className="w-7 h-7 flex items-center justify-center rounded border hover:bg-accent disabled:opacity-30 touch-manipulation"
              aria-label="Taller">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Per-type display options (widget type meta `options`, saved to
          hs_dashboard_widgets.settings). Toggles only for now. */}
      {editing && meta.options?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-muted/10">
          {meta.options.map(opt => {
            const on = !!widget.settings?.[opt.key]
            return (
              <button key={opt.key} type="button" role="switch" aria-checked={on}
                onClick={() => onSetting(opt.key, !on)}
                title={opt.hint}
                className={cn(
                  'h-9 px-3 rounded-full border text-xs font-medium touch-manipulation transition-colors flex items-center gap-1.5',
                  on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent',
                )}>
                {on && <Check className="w-3.5 h-3.5" />}
                {opt.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Fills whatever height the card's row span gives it; scrolls inside. */}
      <div className={cn('flex-1 min-h-0 overflow-auto', !meta.flush && 'p-4')}>
        {!me ? null
          : allowed ? renderWidget({ widget, venueId, ctx, template, onChecklistState: setChecklistState })
          : <NoAccess meta={meta} />}
      </div>
    </div>
  )
}

// ── H&S config ───────────────────────────────────────────────

export const HS_DASHBOARD_CONFIG = {
  apiBase:      '/hs-dashboards',
  keyPrefix:    'hs',
  // Module whose Manage permission lets someone change the layout.
  moduleKey:    'hs_dashboard',
  title:        'H&S Dashboard',
  icon:         LayoutGrid,
  primaryGroup: 'hs',
  defaultNav:   'day',
  // Optional per-config extra in the page header.
  HeaderExtra: HsSettingsButton,
  // Venue picker only when there's a choice to make (matches Food safety / Checklists).
  alwaysShowVenuePicker: false,
  emptyText:   'No dashboards yet. Create one to start adding checklist and temperature-check widgets.',
  emptyWidgetsText: 'No widgets on this dashboard yet. Add a checklist, the temperature-check grid, or any other widget.',
}

export default function HSDashboard() {
  return <DashboardPage config={HS_DASHBOARD_CONFIG} />
}

// ── Generic dashboard page ─────────────────────────────────────

export function DashboardPage({ config }) {
  const api = useApi()
  const qc = useQueryClient()
  const containerRef = useRef(null)
  const { apiBase, keyPrefix } = config
  const TitleIcon = config.icon
  const nav = useDashboardNav()
  const { data: me } = useMe()

  const [venueId, setVenueId] = useState('')
  const [activeDashboardId, setActiveDashboardId] = useState('')
  const [editingOn, setEditing] = useState(false)
  // Changing the layout (tabs, widgets, sizes, options) needs Manage on the
  // dashboard's module; View can open and use the dashboards. The API
  // refuses layout changes without Manage too (routes/hsDashboards.js).
  const canEditLayout = !!me?.is_platform_admin || me?.permissions?.[config.moduleKey] === 'manage'
  const editing = canEditLayout && editingOn
  const [dashModal, setDashModal] = useState(null) // 'new' | dashboard row | null
  const [confirmDeleteDash, setConfirmDeleteDash] = useState(false)
  const [addWidgetOpen, setAddWidgetOpen] = useState(false)
  // Full screen: the real Fullscreen API where the browser offers it
  // (webkit-prefixed on iPad Safari), otherwise a "pseudo" full screen that
  // pins the dashboard over the whole app (fixed, above the sidebar rail).
  // An iPad home-screen app has no Fullscreen API at all, and there the
  // pseudo mode is effectively full screen anyway since there's no browser
  // chrome to hide.
  const [nativeFullscreen, setNativeFullscreen] = useState(false)
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false)
  const isFullscreen = nativeFullscreen || pseudoFullscreen

  useEffect(() => {
    function handler() {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement
      setNativeFullscreen(!!fsEl && fsEl === containerRef.current)
    }
    document.addEventListener('fullscreenchange', handler)
    document.addEventListener('webkitfullscreenchange', handler)
    return () => {
      document.removeEventListener('fullscreenchange', handler)
      document.removeEventListener('webkitfullscreenchange', handler)
    }
  }, [])
  function toggleFullscreen() {
    if (pseudoFullscreen) { setPseudoFullscreen(false); return }
    if (nativeFullscreen) {
      (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document)
      return
    }
    const el = containerRef.current
    const request = el?.requestFullscreen ?? el?.webkitRequestFullscreen
    if (!request) { setPseudoFullscreen(true); return }
    try {
      const result = request.call(el)
      if (result && typeof result.catch === 'function') result.catch(() => setPseudoFullscreen(true))
    } catch {
      setPseudoFullscreen(true)
    }
  }


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

  const invalidateDashboards = () => qc.invalidateQueries({ queryKey: [`${keyPrefix}-dashboards`, venueId] })
  const invalidateWidgets    = () => qc.invalidateQueries({ queryKey: [`${keyPrefix}-dashboard-widgets`, activeDashboardId] })

  const createDashboard = useMutation({
    mutationFn: name => api.post(`${apiBase}/dashboards`, { venue_id: venueId, name }),
    onSuccess: (row) => { invalidateDashboards(); setDashModal(null); setActiveDashboardId(row.id) },
  })
  const patchDashboard = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`${apiBase}/dashboards/${id}`, body),
    onSuccess: () => { invalidateDashboards(); setDashModal(null) },
  })
  const deleteDashboard = useMutation({
    mutationFn: id => api.delete(`${apiBase}/dashboards/${id}`),
    onSuccess: () => { invalidateDashboards(); setConfirmDeleteDash(false); setActiveDashboardId('') },
  })
  const reorderDashboards = useMutation({
    mutationFn: ids => api.put(`${apiBase}/dashboards/reorder`, { venue_id: venueId, ids }),
    onSuccess: invalidateDashboards,
  })

  const createWidget = useMutation({
    mutationFn: body => api.post(`${apiBase}/dashboards/${activeDashboardId}/widgets`, body),
    onSuccess: () => { invalidateWidgets(); setAddWidgetOpen(false) },
  })
  const removeWidget = useMutation({
    mutationFn: id => api.delete(`${apiBase}/dashboards/${activeDashboardId}/widgets/${id}`),
    onSuccess: invalidateWidgets,
  })
  const reorderWidgets = useMutation({
    mutationFn: ids => api.put(`${apiBase}/dashboards/${activeDashboardId}/widgets/reorder`, { ids }),
    onSuccess: invalidateWidgets,
  })
  const patchWidget = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`${apiBase}/dashboards/${activeDashboardId}/widgets/${id}`, body),
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
        'p-4 md:p-6 bg-page overflow-y-auto',
        pseudoFullscreen ? 'fixed inset-0 z-50'
          : nativeFullscreen ? 'w-screen h-screen'
          : 'h-full w-full',
      )}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2 max-lg:notouch:pl-10">
          <TitleIcon className="w-6 h-6 text-primary" /> {config.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {venues.length > (config.alwaysShowVenuePicker ? 0 : 1) && (
            <select value={venueId} onChange={e => { setVenueId(e.target.value); setActiveDashboardId('') }}
              className="border rounded px-3 py-2 text-sm bg-background min-h-[44px]">
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          {canEditLayout && dashboards.length > 0 && (
            <button type="button" onClick={() => setEditing(e => !e)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium min-h-[44px] touch-manipulation',
                editing ? 'bg-primary text-primary-foreground' : 'border hover:bg-accent',
              )}>
              {editing ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
              {editing ? 'Done editing' : 'Edit layout'}
            </button>
          )}
          {canEditLayout && venueId && dashboards.length > 0 && (
            <button type="button" onClick={() => setDashModal('new')}
              className="inline-flex items-center gap-1.5 rounded-lg border hover:bg-accent px-3 py-2 text-sm font-medium min-h-[44px] touch-manipulation">
              <Plus className="w-4 h-4" /> New dashboard
            </button>
          )}
          {config.HeaderExtra && <config.HeaderExtra venueId={venueId || null} />}
          <button type="button" onClick={toggleFullscreen} title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border hover:bg-accent px-3 py-2 text-sm font-medium min-h-[44px] touch-manipulation">
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            {isFullscreen ? 'Exit' : 'Full screen'}
          </button>
        </div>
      </div>

      {/* Date navigator and dashboard tabs share one row (from sm up). The tabs
          scroll sideways if they run out of room rather than wrapping below. */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 mb-5">
        <DashboardNav nav={nav} mode={navModeFor(widgets, WIDGET_TYPE_BY_KEY, config.defaultNav)} />

        {dashboards.length > 0 && (
          <div className="flex-1 flex items-center gap-1 overflow-x-auto min-w-0">
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

      {/* Any dashboard with an H&S check on it: say when the venue is closed
          that day and H&S follows opening days (hs_settings). */}
      {venueId && hasHsDayWidget(widgets) && <ClosedDayNotice venueId={venueId} date={nav.date} className="mb-4" />}

      {!venueId ? (
        <p className="text-muted-foreground text-sm py-12 text-center">Select a venue to begin.</p>
      ) : dashboards.length === 0 ? (
        <div className="border rounded-xl p-10 text-center">
          <TitleIcon className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          {canEditLayout ? (
            <>
              <p className="text-muted-foreground text-sm mb-4">{config.emptyText}</p>
              <button type="button" onClick={() => setDashModal('new')}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] touch-manipulation">
                <Plus className="w-4 h-4" /> Create dashboard
              </button>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              No dashboards here yet. Someone with Manage access to this dashboard can set one up.
            </p>
          )}
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
              {canEditLayout ? (
                <>
                  <p className="text-muted-foreground text-sm mb-4">
                    {config.emptyWidgetsText}
                  </p>
                  <button type="button" onClick={() => setAddWidgetOpen(true)}
                    className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] touch-manipulation">
                    <Plus className="w-4 h-4" /> Add widget
                  </button>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Nothing on this dashboard yet. Someone with Manage access to this dashboard can add widgets.
                </p>
              )}
            </div>
          ) : (
            <div>
              {/* Always exactly column_count columns, shrinking to fit the
                  screen, so the layout the operator built (e.g. two
                  half-width widgets side by side) is kept on a narrower
                  tablet. Rows are a fixed unit (lib/dashboardGrid.js) and
                  a widget spans as many as its height needs, with dense
                  packing so shorter widgets fill in beside a tall one. */}
              <div style={gridStyle(columnCount)}>
                {widgets.map((w, idx) => (
                  <WidgetCard
                    key={w.id}
                    widget={w}
                    venueId={venueId}
                    ctx={nav.ctx}
                    editing={editing}
                    columnCount={columnCount}
                    me={me}
                    isFirst={idx === 0}
                    isLast={idx === widgets.length - 1}
                    onMoveUp={() => moveWidget(idx, -1)}
                    onMoveDown={() => moveWidget(idx, 1)}
                    onRemove={() => removeWidget.mutate(w.id)}
                    onResizeWidth={delta => resizeWidget(w, 'col_span', Math.min(columnCount, Math.max(1, (w.col_span ?? 1) + delta)))}
                    onResizeRows={rows => resizeWidget(w, 'height_px', heightForRows(Math.min(MAX_ROWS, Math.max(MIN_ROWS, rows))))}
                    onSetting={(key, value) => patchWidget.mutate({ id: w.id, settings: { ...(w.settings ?? {}), [key]: value } })}
                    onRename={title_override => patchWidget.mutate({ id: w.id, title_override })}
                    isRenaming={patchWidget.isPending && patchWidget.variables?.id === w.id && 'title_override' in (patchWidget.variables ?? {})}
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
          me={me}
          primaryGroup={config.primaryGroup}
          isSaving={createWidget.isPending}
          onClose={() => setAddWidgetOpen(false)}
          onSave={body => createWidget.mutate(body)}
        />
      )}
    </div>
  )
}
