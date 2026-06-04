// src/pages/Dashboard.jsx
// Summary stats + customisable quick-access shortcuts.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  CalendarDays, Users, CreditCard, Clock,
  BookOpen, UserRound, Building2, Table2, Settings,
  Globe, ChefHat, FolderOpen, MessageSquare, ClipboardList,
  Wallet, Mail, Activity, SlidersHorizontal, LayoutTemplate,
  Shield, AlertCircle, Lightbulb, Newspaper, BookMarked,
  HelpCircle, Plus, X, Pencil, Check,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, formatTime, STATUS_COLOURS, STATUS_LABELS } from '@/lib/utils'

// ── Shortcut registry ─────────────────────────────────────────────────────────
// Mirrors NAV in AppShell (minus Dashboard itself).

const SHORTCUT_OPTIONS = [
  { to: '/timeline',             label: 'Timeline',             icon: CalendarDays,    colour: 'bg-sky-100 text-sky-600' },
  { to: '/bookings',             label: 'Bookings',             icon: BookOpen,        colour: 'bg-blue-100 text-blue-600' },
  { to: '/customers',            label: 'Customers',            icon: UserRound,       colour: 'bg-indigo-100 text-indigo-600' },
  { to: '/order-sheets',         label: 'Order sheets',         icon: ClipboardList,   colour: 'bg-violet-100 text-violet-600' },
  { to: '/order-sheets/templates', label: 'Order templates',   icon: ClipboardList,   colour: 'bg-purple-100 text-purple-600' },
  { to: '/cash-recon',           label: 'Cash recon',           icon: Wallet,          colour: 'bg-emerald-100 text-emerald-600' },
  { to: '/email-templates',      label: 'Emails',               icon: Mail,            colour: 'bg-rose-100 text-rose-600' },
  { to: '/email-monitoring',     label: 'Email monitor',        icon: Activity,        colour: 'bg-orange-100 text-orange-600' },
  { to: '/venues',               label: 'Venues',               icon: Building2,       colour: 'bg-teal-100 text-teal-600' },
  { to: '/tables',               label: 'Tables',               icon: Table2,          colour: 'bg-cyan-100 text-cyan-600' },
  { to: '/schedule',             label: 'Schedule',             icon: Clock,           colour: 'bg-amber-100 text-amber-600' },
  { to: '/rules',                label: 'Rules',                icon: Settings,        colour: 'bg-yellow-100 text-yellow-600' },
  { to: '/website',              label: 'Website',              icon: Globe,           colour: 'bg-lime-100 text-lime-600' },
  { to: '/reservations-widget',  label: 'Widget',               icon: LayoutTemplate,  colour: 'bg-green-100 text-green-600' },
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

// ── Shortcuts bar ─────────────────────────────────────────────────────────────

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

      {/* Shortcut tiles */}
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

        {/* Add tile (always shown in edit mode, or as the only tile when empty) */}
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

      {/* Picker */}
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const api   = useApi()
  const today = format(new Date(), 'yyyy-MM-dd')

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  const { data: todaysBookings = [] } = useQuery({
    queryKey: ['bookings-today', today],
    queryFn:  () => api.get(`/bookings?date=${today}&status=confirmed&limit=200`),
  })

  const totalCovers  = todaysBookings.reduce((s, b) => s + b.covers, 0)
  const totalRevenue = todaysBookings.reduce((s, b) => s + (b.payment_amount ?? 0), 0)
  const upcoming     = todaysBookings
    .filter(b => new Date(b.starts_at) > new Date())
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .slice(0, 8)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <div>
          <h1 className="font-semibold">Dashboard</h1>
          <p className="text-xs text-muted-foreground">{format(new Date(), 'EEEE d MMMM yyyy')}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Customisable shortcuts */}
        <Shortcuts />

        {/* Stats */}
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

        {/* Upcoming bookings */}
        <div>
          <p className="text-sm font-semibold mb-3">Upcoming today</p>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming bookings for today.</p>
          ) : (
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
          )}
        </div>

        {/* Venues quick status */}
        <div>
          <p className="text-sm font-semibold mb-3">Venues</p>
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
        </div>

      </div>
    </div>
  )
}
