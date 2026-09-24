// src/pages/Dashboard.jsx
// The Overview page — a tile-based home page (migration 093). Existing
// fixed sections (quick access shortcuts, today's stats, upcoming
// bookings, venues status) are now tiles like any other; two H&S status
// tiles are also available. Layout control (add/remove/reorder/resize)
// and per-role visibility mirror the H&S Dashboard's widget system and
// the Nav Designer's per-role hiding, respectively — see
// dashboardTiles.js for the API side.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, addDays } from 'date-fns'
import * as LucideIcons from 'lucide-react'
import {
  CalendarDays, Users, CreditCard, Clock,
  BookOpen, UserRound, Building2, Table2, Settings,
  Globe, ChefHat, FolderOpen, MessageSquare, ClipboardList,
  Wallet, Mail, Activity, SlidersHorizontal, LayoutTemplate,
  Shield, AlertCircle, Lightbulb, Newspaper, BookMarked,
  HelpCircle, Plus, X, Pencil, Check, ChevronUp, ChevronDown,
  Minus, Trash2, Loader2,
  Thermometer, ListChecks, LayoutGrid, ClipboardCheck,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, formatTime, STATUS_COLOURS, STATUS_LABELS } from '@/lib/utils'

function resolveIcon(name) {
  return LucideIcons[name] || LucideIcons.Circle
}

// Client-side mirror of the server's TILE_CATALOG defaults, used as a
// fallback for label/icon/sizing before the catalog query resolves (and
// for viewers who can't call the manage-only /dashboard-tiles/catalog
// endpoint at all).
const TILE_META = {
  quick_access:      { label: 'Quick access shortcuts', icon: 'LayoutGrid',   default_col_span: 4, default_height_px: 200 },
  stats_today:       { label: "Today's stats",          icon: 'BarChart3',    default_col_span: 4, default_height_px: 180 },
  upcoming_bookings: { label: 'Upcoming bookings',      icon: 'CalendarClock', default_col_span: 2, default_height_px: 420 },
  venues_status:     { label: 'Venues status',          icon: 'Building2',    default_col_span: 2, default_height_px: 280 },
  hs_today_status:   { label: 'H&S checks today',       icon: 'ShieldCheck',  default_col_span: 2, default_height_px: 240 },
  hs_week_status:    { label: "Week's H&S status",      icon: 'CalendarCheck', default_col_span: 2, default_height_px: 240 },
}

// ── Shortcut registry ─────────────────────────────────────────────────────────
// A separate, older customisation axis from the tile system below — each
// user picks their own subset of shortcuts from this fixed catalog,
// always available regardless of whether an admin has hidden the whole
// Quick access tile for their role.

const SHORTCUT_OPTIONS = [
  { to: '/timeline',             label: 'Timeline',             icon: CalendarDays,    colour: 'bg-sky-100 text-sky-600' },
  { to: '/bookings',             label: 'Bookings',             icon: BookOpen,        colour: 'bg-blue-100 text-blue-600' },
  { to: '/customers',            label: 'Customers',            icon: UserRound,       colour: 'bg-indigo-100 text-indigo-600' },
  { to: '/order-sheets',         label: 'Order sheets',         icon: ClipboardList,   colour: 'bg-violet-100 text-violet-600' },
  { to: '/order-sheets/templates', label: 'Order templates',   icon: ClipboardList,   colour: 'bg-purple-100 text-purple-600' },
  { to: '/cash-recon',           label: 'Cash recon',           icon: Wallet,          colour: 'bg-emerald-100 text-emerald-600' },
  { to: '/food-safety',          label: 'Food safety',          icon: Thermometer,     colour: 'bg-red-100 text-red-600' },
  { to: '/checklists',           label: 'Checklists',           icon: ListChecks,      colour: 'bg-teal-100 text-teal-700' },
  { to: '/hs-dashboard',         label: 'H&S Dashboard',        icon: LayoutGrid,      colour: 'bg-orange-100 text-orange-700' },
  { to: '/hs-action-log',        label: 'Action log',           icon: ClipboardCheck,  colour: 'bg-cyan-100 text-cyan-700' },
  { to: '/email-templates',      label: 'Emails',               icon: Mail,            colour: 'bg-rose-100 text-rose-600' },
  { to: '/email-monitoring',     label: 'Email monitor',        icon: Activity,        colour: 'bg-orange-100 text-orange-600' },
  { to: '/venues',               label: 'Venues',               icon: Building2,       colour: 'bg-teal-100 text-teal-600' },
  { to: '/tables',               label: 'Tables',               icon: Table2,          colour: 'bg-cyan-100 text-cyan-600' },
  { to: '/schedule',             label: 'Schedule',             icon: Clock,           colour: 'bg-amber-100 text-amber-600' },
  { to: '/rules',                label: 'Rules',                icon: Settings,        colour: 'bg-yellow-100 text-yellow-600' },
  { to: '/website',              label: 'Website',              icon: Globe,           colour: 'bg-lime-100 text-lime-600' },
  { to: '/website?section=tenant-widget', label: 'Widget', icon: LayoutTemplate,  colour: 'bg-green-100 text-green-600' },
  { to: '/menus',                label: 'Menus',                icon: ChefHat,         colour: 'bg-fuchsia-100 text-fuchsia-600' },
  { to: '/media',                label: 'Media',                icon: FolderOpen,      colour: 'bg-pink-100 text-pink-600' },
  { to: '/reviews',              label: 'Reviews',              icon: MessageSquare,   colour: 'bg-red-100 text-red-600' },
  { to: '/team',                 label: 'Team',                 icon: Users,           colour: 'bg-slate-100 text-slate-600' },
  { to: '/access',               label: 'Access',               icon: Shield,          colour: 'bg-gray-100 text-gray-600' },
  { to: '/settings',             label: 'Settings',             icon: SlidersHorizontal, colour: 'bg-neutral-100 text-neutral-600' },
  { to: '/issues',               label: 'Issues',               icon: AlertCircle,     colour: 'bg-red-100 text-red-700' },
  { to: '/feature-requests',     label: 'Feature requests',     icon: Lightbulb,       colour: 'bg-yellow-100 text-yellow-700' },
  { to: '/changelog',            label: "What's new",           icon: Newspaper,       colour: 'bg-sky-100 text-sky-700' },
  { to: '/docs',                 label: 'Documentation',        icon: BookMarked,      colour: 'bg-indigo-100 text-indigo-700' },
  { to: '/help',                 label: 'Help',                 icon: HelpCircle,      colour: 'bg-violet-100 text-violet-700' },
]

const LS_KEY = 'maca_dashboard_shortcuts'

function loadShortcuts() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') } catch { return [] }
}

function Shortcuts() {
  const navigate = useNavigate()
  const [shortcuts, setShortcuts] = useState(loadShortcuts)
  const [editMode, setEditMode]   = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(shortcuts))
  }, [shortcuts])

  function add(to) {
    setShortcuts(prev => prev.includes(to) ? prev : [...prev, to])
  }

  function remove(to) {
    setShortcuts(prev => prev.filter(s => s !== to))
  }

  function done() {
    setEditMode(false)
    setShowPicker(false)
  }

  const shortcutItems = shortcuts.map(to => SHORTCUT_OPTIONS.find(o => o.to === to)).filter(Boolean)
  const available     = SHORTCUT_OPTIONS.filter(o => !shortcuts.includes(o.to))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quick access</p>
        {editMode ? (
          <button onClick={done}
            className="flex items-center gap-1.5 text-xs font-medium text-primary touch-manipulation py-1 px-2 rounded hover:bg-primary/10">
            <Check className="w-3.5 h-3.5" /> Done
          </button>
        ) : (
          <button onClick={() => setEditMode(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground touch-manipulation py-1 px-2 rounded hover:bg-accent hover:text-foreground">
            <Pencil className="w-3 h-3" /> Customise
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {shortcutItems.map(item => (
          <div key={item.to} className="relative">
            <button
              onClick={() => !editMode && navigate(item.to)}
              className={cn(
                'flex flex-col items-center gap-2 px-3 pt-3 pb-2.5 rounded-xl border bg-background transition-colors touch-manipulation',
                'min-w-[76px] min-h-[76px]',
                editMode ? 'cursor-default opacity-80' : 'hover:bg-accent hover:border-primary/30 active:scale-95',
              )}
            >
              <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', item.colour)}>
                <item.icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
              </div>
              <span className="text-[11px] font-medium text-center leading-tight max-w-[72px]">{item.label}</span>
            </button>
            {editMode && (
              <button
                onClick={() => remove(item.to)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center shadow-sm touch-manipulation"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}

        {(editMode || shortcutItems.length === 0) && (
          <button
            onClick={() => setShowPicker(p => !p)}
            className={cn(
              'flex flex-col items-center gap-2 px-3 pt-3 pb-2.5 rounded-xl border-2 border-dashed text-muted-foreground transition-colors touch-manipulation',
              'min-w-[76px] min-h-[76px]',
              showPicker ? 'border-primary/50 bg-primary/5 text-primary' : 'hover:border-primary/40 hover:bg-accent',
            )}
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center">
              <Plus className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium">{shortcutItems.length === 0 && !editMode ? 'Add shortcuts' : 'Add'}</span>
          </button>
        )}
      </div>

      {showPicker && (
        <div className="border rounded-xl bg-background overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
            <p className="text-sm font-semibold">Add a shortcut</p>
            <button onClick={() => setShowPicker(false)} className="p-1 text-muted-foreground hover:text-foreground touch-manipulation">
              <X className="w-4 h-4" />
            </button>
          </div>
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">All shortcuts added</p>
          ) : (
            <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {available.map(item => (
                <button
                  key={item.to}
                  onClick={() => { add(item.to); setShowPicker(false) }}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-accent text-left touch-manipulation min-h-[44px] transition-colors"
                >
                  <div className={cn('w-7 h-7 rounded-md flex items-center justify-center shrink-0', item.colour)}>
                    <item.icon className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium leading-tight">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, colour }) {
  return (
    <div className="border rounded-lg p-4">
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center mb-3', colour)}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm font-medium mt-0.5">{label}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

// ── H&S status helpers ───────────────────────────────────────────────────────

const HS_STATUS_STYLES = {
  green:    { dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', label: 'All clear' },
  amber:    { dot: 'bg-amber-500',   badge: 'bg-amber-100 text-amber-700',   label: 'Attention needed' },
  red:      { dot: 'bg-red-500',     badge: 'bg-red-100 text-red-700',       label: 'Needs action' },
  grey:     { dot: 'bg-gray-300',    badge: 'bg-gray-100 text-gray-500',     label: 'Nothing configured' },
  upcoming: { dot: 'bg-gray-100 border border-dashed border-gray-300', badge: 'bg-gray-50 text-gray-400', label: 'Upcoming' },
}

function mondayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

// ── Tile shell — header (icon/title + edit controls) + scrollable body ──────

function TileCard({
  icon: Icon, title, editing, colSpan, height,
  onRemove, onMoveUp, onMoveDown, isFirst, isLast, onResizeWidth, onResizeHeight,
  headerExtra, children,
}) {
  return (
    <div
      style={{ gridColumn: `span ${colSpan}` }}
      className={cn(
        'border rounded-xl bg-background shadow-sm overflow-hidden flex flex-col',
        editing && 'ring-1 ring-primary/30 border-dashed',
      )}>
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
        <span className="w-8 h-8 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </span>
        <span className="flex-1 min-w-0 text-sm font-semibold truncate">{title}</span>
        {!editing && headerExtra}
        {editing && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" onClick={onMoveUp} disabled={isFirst}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation"
              aria-label="Move tile earlier">
              <ChevronUp className="w-4 h-4" />
            </button>
            <button type="button" onClick={onMoveDown} disabled={isLast}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 touch-manipulation"
              aria-label="Move tile later">
              <ChevronDown className="w-4 h-4" />
            </button>
            <button type="button" onClick={onRemove}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent text-destructive touch-manipulation"
              aria-label="Remove tile">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2 border-b bg-muted/10 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Width</span>
            <button type="button" onClick={() => onResizeWidth(-1)} disabled={colSpan <= 1}
              className="w-7 h-7 flex items-center justify-center rounded border hover:bg-accent disabled:opacity-30 touch-manipulation">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="w-10 text-center font-medium">{colSpan}/4</span>
            <button type="button" onClick={() => onResizeWidth(1)} disabled={colSpan >= 4}
              className="w-7 h-7 flex items-center justify-center rounded border hover:bg-accent disabled:opacity-30 touch-manipulation">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Height</span>
            <button type="button" onClick={() => onResizeHeight(-80)} disabled={height <= 160}
              className="w-7 h-7 flex items-center justify-center rounded border hover:bg-accent disabled:opacity-30 touch-manipulation">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="w-14 text-center font-medium">{height}px</span>
            <button type="button" onClick={() => onResizeHeight(80)} disabled={height >= 1200}
              className="w-7 h-7 flex items-center justify-center rounded border hover:bg-accent disabled:opacity-30 touch-manipulation">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="p-4 overflow-y-auto" style={{ height }}>
        {children}
      </div>
    </div>
  )
}

// ── Tile bodies ──────────────────────────────────────────────────────────────

function StatsTodayBody({ todaysBookings, totalCovers, totalRevenue, upcoming }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard icon={CalendarDays} label="Bookings today"
        value={todaysBookings.length} colour="bg-blue-50 text-blue-600" />
      <StatCard icon={Users} label="Covers today"
        value={totalCovers} colour="bg-green-50 text-green-600" />
      <StatCard icon={CreditCard} label="Deposit revenue"
        value={totalRevenue > 0 ? `£${totalRevenue.toFixed(2)}` : '—'}
        colour="bg-amber-50 text-amber-600" />
      <StatCard icon={Clock} label="Upcoming today"
        value={upcoming.length} sub="from now"
        colour="bg-purple-50 text-purple-600" />
    </div>
  )
}

function UpcomingBookingsBody({ upcoming }) {
  if (upcoming.length === 0) return <p className="text-sm text-muted-foreground">No upcoming bookings for today.</p>
  return (
    <div className="border rounded-lg overflow-hidden">
      {upcoming.map((b, i) => (
        <div key={b.id} className={cn('flex items-center gap-4 px-4 py-3', i !== 0 && 'border-t')}>
          <div className="w-14 text-center">
            <p className="text-sm font-bold">{formatTime(b.starts_at)}</p>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{b.guest_name}</p>
            <p className="text-xs text-muted-foreground">
              {b.covers} covers · {b.venue_name} / {b.table_label}
            </p>
          </div>
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLOURS[b.status])}>
            {STATUS_LABELS[b.status]}
          </span>
        </div>
      ))}
    </div>
  )
}

function VenuesStatusBody({ venues }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {venues.map(v => (
        <div key={v.id} className="border rounded-lg px-4 py-3 flex items-center gap-3">
          <div className={cn('w-2 h-2 rounded-full', v.is_active ? 'bg-green-500' : 'bg-gray-300')} />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{v.name}</p>
            <p className="text-xs text-muted-foreground">{v.table_count} tables</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function HsTodayStatusBody({ api }) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-hs-status-today', today],
    queryFn: () => api.get(`/dashboard-tiles/hs-status?from=${today}&to=${today}&today=${today}`),
  })

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  const day = data?.days?.[0]
  if (!day) return null
  const style = HS_STATUS_STYLES[day.status]
  const multiVenue = day.venues.length > 1

  return (
    <div className="space-y-3">
      <div className={cn('inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium', style.badge)}>
        <span className={cn('w-2.5 h-2.5 rounded-full', style.dot)} />
        {style.label}
        {day.expected > 0 && <span className="opacity-70">· {day.completed}/{day.expected} checks complete</span>}
      </div>
      <div className="space-y-3">
        {day.venues.map(v => {
          const checklists = v.checklists ?? []
          const categories = v.categories ?? []
          if (checklists.length === 0 && categories.length === 0) return null
          return (
            <div key={v.venue_id} className="space-y-1">
              {multiVenue && (
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">{v.venue_name}</p>
              )}
              {checklists.map(c => (
                <div key={c.id} className="flex items-center gap-2 text-sm">
                  <span className={cn('w-2 h-2 rounded-full shrink-0', c.completed ? 'bg-emerald-500' : 'bg-gray-300')} />
                  <span className="flex-1 min-w-0 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{c.completed ? 'Done' : 'Not done'}</span>
                </div>
              ))}
              {categories.map(cat => {
                const cStyle = HS_STATUS_STYLES[cat.status]
                return (
                  <div key={cat.key} className="flex items-center gap-2 text-sm">
                    <span className={cn('w-2 h-2 rounded-full shrink-0', cStyle.dot)} />
                    <span className="flex-1 min-w-0 truncate">{cat.label}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{cat.completed}/{cat.expected}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HsWeekStatusBody({ api }) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const weekStart = mondayOfWeek(today)
  const weekEnd = addDays(new Date(weekStart + 'T00:00:00Z'), 6).toISOString().slice(0, 10)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-hs-status-week', weekStart],
    queryFn: () => api.get(`/dashboard-tiles/hs-status?from=${weekStart}&to=${weekEnd}&today=${today}`),
  })

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  const days = data?.days ?? []
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day, i) => {
        const style = HS_STATUS_STYLES[day.status]
        return (
          <div key={day.date} className="flex flex-col items-center gap-1.5"
            title={`${day.date}: ${style.label}${day.expected > 0 ? ` (${day.completed}/${day.expected})` : ''}`}>
            <span className="text-[11px] text-muted-foreground font-medium">{dayLabels[i]}</span>
            <div className={cn('w-full aspect-square rounded-lg flex items-center justify-center', style.badge)}>
              <span className={cn('w-2.5 h-2.5 rounded-full', style.dot)} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Add-tile modal ───────────────────────────────────────────────────────────

function AddTileModal({ catalog, existingTypes, onClose, onAdd, isSaving }) {
  const available = catalog.filter(t => !existingTypes.includes(t.tile_type))
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-sm max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add tile</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Every tile is already on the Overview page.</p>
        ) : (
          <div className="space-y-1.5">
            {available.map(t => {
              const Icon = resolveIcon(t.icon)
              return (
                <button key={t.tile_type} type="button" disabled={isSaving} onClick={() => onAdd(t.tile_type)}
                  className="w-full flex items-center gap-2.5 border rounded-xl px-3 py-2.5 text-sm font-medium touch-manipulation min-h-[48px] hover:bg-accent disabled:opacity-50">
                  <Icon className="w-4 h-4 shrink-0" /> {t.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Visibility modal — which roles can see this tile ────────────────────────

function VisibilityModal({ tile, roles, onClose, onSave, isSaving }) {
  const [hidden, setHidden] = useState(tile.hidden_role_ids ?? [])

  function toggle(roleId) {
    setHidden(ids => ids.includes(roleId) ? ids.filter(x => x !== roleId) : [...ids, roleId])
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-sm max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Visible to</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Untick a role to hide this tile from it.</p>
        <div className="border rounded-md divide-y mb-4">
          {roles.map(r => (
            <label key={r.id} className="flex items-center gap-2 px-3 py-2.5 text-sm touch-manipulation min-h-[44px]">
              <input type="checkbox" checked={!hidden.includes(r.id)} onChange={() => toggle(r.id)} className="w-4 h-4" />
              {r.label}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded text-sm min-h-[44px] touch-manipulation">Cancel</button>
          <button type="button" disabled={isSaving} onClick={() => onSave(hidden)}
            className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50 touch-manipulation">
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const api = useApi()
  const qc  = useQueryClient()
  const today = format(new Date(), 'yyyy-MM-dd')

  const [editing, setEditing] = useState(false)
  const [addTileOpen, setAddTileOpen] = useState(false)
  const [visibilityFor, setVisibilityFor] = useState(null) // tile row or null

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const canManage = me?.permissions?.dashboard === 'manage' || me?.is_platform_admin

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  const { data: todaysBookings = [] } = useQuery({
    queryKey: ['bookings-today', today],
    queryFn:  () => api.get(`/bookings?date=${today}&status=confirmed&limit=200`),
  })

  const { data: catalog = [] } = useQuery({
    queryKey: ['dashboard-tile-catalog'],
    queryFn:  () => api.get('/dashboard-tiles/catalog'),
    enabled:  canManage,
  })
  const { data: fullTiles = [] } = useQuery({
    queryKey: ['dashboard-tiles'],
    queryFn:  () => api.get('/dashboard-tiles'),
    enabled:  canManage && editing,
  })
  const { data: roles = [] } = useQuery({
    queryKey: ['access-roles'],
    queryFn:  () => api.get('/access/roles'),
    enabled:  canManage && editing,
  })

  const tiles = editing && canManage ? fullTiles : (me?.dashboard_tiles ?? [])

  const invalidateTiles = () => {
    qc.invalidateQueries({ queryKey: ['dashboard-tiles'] })
    qc.invalidateQueries({ queryKey: ['me'] })
  }
  const addTile = useMutation({
    mutationFn: (tile_type) => api.post('/dashboard-tiles', { tile_type }),
    onSuccess: () => { invalidateTiles(); setAddTileOpen(false) },
  })
  const removeTile = useMutation({
    mutationFn: (id) => api.delete(`/dashboard-tiles/${id}`),
    onSuccess: invalidateTiles,
  })
  const patchTile = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/dashboard-tiles/${id}`, body),
    onSuccess: () => { invalidateTiles(); setVisibilityFor(null) },
  })
  const reorderTiles = useMutation({
    mutationFn: (ids) => api.patch('/dashboard-tiles/reorder', { ids }),
    onSuccess: invalidateTiles,
  })

  function moveTile(idx, dir) {
    const next = [...tiles]
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= next.length) return
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    reorderTiles.mutate(next.map(t => t.id))
  }

  const totalCovers  = todaysBookings.reduce((s, b) => s + b.covers, 0)
  const totalRevenue = todaysBookings.reduce((s, b) => s + (b.payment_amount ?? 0), 0)
  const upcoming = useMemo(() => todaysBookings
    .filter(b => new Date(b.starts_at) > new Date())
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .slice(0, 8), [todaysBookings])

  function renderTileBody(tileType) {
    switch (tileType) {
      case 'quick_access':      return <Shortcuts />
      case 'stats_today':       return <StatsTodayBody todaysBookings={todaysBookings} totalCovers={totalCovers} totalRevenue={totalRevenue} upcoming={upcoming} />
      case 'upcoming_bookings': return <UpcomingBookingsBody upcoming={upcoming} />
      case 'venues_status':     return <VenuesStatusBody venues={venues} />
      case 'hs_today_status':   return <HsTodayStatusBody api={api} />
      case 'hs_week_status':    return <HsWeekStatusBody api={api} />
      default:                  return null
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <div>
          <h1 className="font-semibold">Overview</h1>
          <p className="text-xs text-muted-foreground">{format(new Date(), 'EEEE d MMMM yyyy')}</p>
        </div>
        {canManage && (
          editing ? (
            <button onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary touch-manipulation min-h-[40px] px-3 py-2 rounded-md hover:bg-primary/10">
              <Check className="w-4 h-4" /> Done
            </button>
          ) : (
            <button onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground touch-manipulation min-h-[40px] px-3 py-2 rounded-md hover:bg-accent hover:text-foreground">
              <Pencil className="w-3.5 h-3.5" /> Customise layout
            </button>
          )
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tiles.length === 0 && !editing && (
          <p className="text-sm text-muted-foreground text-center py-12">
            {canManage ? 'No tiles on this page yet — click "Customise layout" to add some.' : 'Nothing to show here yet.'}
          </p>
        )}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(4, minmax(240px, 1fr))' }}>
          {tiles.map((tile, i) => {
            const meta = TILE_META[tile.tile_type]
            if (!meta) return null
            return (
              <TileCard
                key={tile.id}
                icon={resolveIcon(meta.icon)}
                title={tile.title_override || meta.label}
                editing={editing}
                colSpan={Math.min(tile.col_span ?? meta.default_col_span, 4)}
                height={tile.height_px ?? meta.default_height_px}
                isFirst={i === 0}
                isLast={i === tiles.length - 1}
                onMoveUp={() => moveTile(i, -1)}
                onMoveDown={() => moveTile(i, 1)}
                onRemove={() => removeTile.mutate(tile.id)}
                onResizeWidth={(delta) => patchTile.mutate({ id: tile.id, col_span: Math.min(4, Math.max(1, (tile.col_span ?? meta.default_col_span) + delta)) })}
                onResizeHeight={(delta) => patchTile.mutate({ id: tile.id, height_px: Math.min(1200, Math.max(160, (tile.height_px ?? meta.default_height_px) + delta)) })}
                headerExtra={editing && (
                  <button type="button" onClick={() => setVisibilityFor(tile)}
                    className="text-[11px] text-muted-foreground hover:text-foreground shrink-0 touch-manipulation px-1.5 py-1 rounded hover:bg-accent">
                    {tile.hidden_role_ids?.length ? `Hidden from ${tile.hidden_role_ids.length}` : 'Visible to all'}
                  </button>
                )}
              >
                {renderTileBody(tile.tile_type)}
              </TileCard>
            )
          })}

          {editing && (
            <button onClick={() => setAddTileOpen(true)}
              style={{ gridColumn: 'span 2' }}
              className="border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground hover:border-primary/40 hover:bg-accent touch-manipulation">
              <Plus className="w-6 h-6" />
              <span className="text-sm font-medium">Add tile</span>
            </button>
          )}
        </div>
      </div>

      {addTileOpen && (
        <AddTileModal
          catalog={catalog}
          existingTypes={fullTiles.map(t => t.tile_type)}
          onClose={() => setAddTileOpen(false)}
          onAdd={(tile_type) => addTile.mutate(tile_type)}
          isSaving={addTile.isPending}
        />
      )}

      {visibilityFor && (
        <VisibilityModal
          tile={visibilityFor}
          roles={roles}
          onClose={() => setVisibilityFor(null)}
          onSave={(hidden_role_ids) => patchTile.mutate({ id: visibilityFor.id, hidden_role_ids })}
          isSaving={patchTile.isPending}
        />
      )}
    </div>
  )
}

