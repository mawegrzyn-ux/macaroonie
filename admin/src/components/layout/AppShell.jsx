// src/components/layout/AppShell.jsx
import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, CalendarDays, BookOpen,
  Building2, Table2, Clock, Settings, Users, UserRound,
  LogOut, Utensils, LayoutTemplate, Menu, X,
  BookMarked, HelpCircle, SlidersHorizontal,
  Eye, EyeOff, Layers, RefreshCw, Maximize2, Minimize2, Columns,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApi } from '@/lib/api'
import { useTimelineSettings } from '@/contexts/TimelineSettingsContext'

const NAV = [
  { label: 'Dashboard',   to: '/',            icon: LayoutDashboard },
  { label: 'Timeline',    to: '/timeline',    icon: CalendarDays },
  { label: 'Bookings',    to: '/bookings',    icon: BookOpen },
  { label: 'Customers',   to: '/customers',   icon: UserRound },
  null,
  { label: 'Venues',      to: '/venues',      icon: Building2 },
  { label: 'Tables',      to: '/tables',      icon: Table2 },
  { label: 'Schedule',    to: '/schedule',    icon: Clock },
  { label: 'Rules',       to: '/rules',       icon: Settings },
  { label: 'Settings',    to: '/settings',    icon: SlidersHorizontal },
  { label: 'Widget test', to: '/widget-test', icon: LayoutTemplate },
  null,
  { label: 'Team',          to: '/team',   icon: Users },
  null,
  { label: 'Documentation', to: '/docs',   icon: BookMarked },
  { label: 'Help',          to: '/help',   icon: HelpCircle },
]

function NavItem({ item, open }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      title={!open ? item.label : undefined}
      className={({ isActive }) => cn(
        'flex items-center gap-3 py-2 rounded-md text-sm font-medium transition-colors',
        open ? 'px-3' : 'justify-center px-2',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {open && <span className="whitespace-nowrap">{item.label}</span>}
    </NavLink>
  )
}

export default function AppShell() {
  const { user, logout } = useAuth0()
  const location         = useLocation()
  const api              = useApi()
  const tlSettings       = useTimelineSettings()
  const isOnTimeline     = location.pathname === '/timeline'

  // Default: open on desktop (≥1024px), closed on mobile
  const [open, setOpen] = useState(
    () => typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  )

  // Fullscreen state — tracked here so the sidebar toggle can update its icon
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])
  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.()
    else document.exitFullscreen?.()
  }

  // Venues list — only fetched when on timeline (TanStack Query caches so
  // Timeline's own venues query reuses the same data with no extra request)
  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
    enabled:  isOnTimeline,
  })

  // Derived effective venueId (mirrors Timeline's own fallback logic)
  const effectiveVenueId = tlSettings.venueId ?? venues[0]?.id ?? ''

  return (
    <div className="flex h-screen overflow-hidden bg-background">

      {/* Mobile backdrop — tap to close */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar
          Mobile: fixed overlay (w-56 when open, w-0 when closed)
          Desktop: in-flow (w-56 when open, w-14 icon-only when closed) */}
      <aside className={cn(
        'flex flex-col border-r bg-background z-30 transition-[width] duration-200 overflow-hidden shrink-0',
        'fixed inset-y-0 left-0 lg:relative',
        open ? 'w-56' : 'w-0 lg:w-14',
      )}>

        {/* Logo row */}
        <div className={cn(
          'flex items-center h-14 border-b shrink-0',
          open ? 'px-4 gap-2' : 'justify-center px-0',
        )}>
          {open ? (
            <>
              <Utensils className="w-5 h-5 text-primary shrink-0" />
              <span className="font-semibold text-sm flex-1 whitespace-nowrap">Macaroonie</span>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded hover:bg-accent text-muted-foreground"
                title="Collapse sidebar"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            // Desktop icon-only: clicking logo expands sidebar
            <button
              onClick={() => setOpen(true)}
              className="p-2 rounded hover:bg-accent text-primary"
              title="Expand sidebar"
            >
              <Utensils className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {NAV.map((item, i) =>
            item === null
              ? <div key={i} className={cn('border-t', open ? 'my-2' : 'my-1')} />
              : <NavItem key={item.to} item={item} open={open} />
          )}
        </nav>

        {/* Timeline view settings — shown above logout when on the Timeline page */}
        {isOnTimeline && (
          <div className={cn('shrink-0 border-t', open ? 'p-2' : 'p-1')}>
            {open ? (
              <>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1.5">
                  Timeline
                </p>
                {/* Venue selector */}
                {venues.length > 1 && (
                  <select
                    value={effectiveVenueId}
                    onChange={e => tlSettings.setVenueId(e.target.value)}
                    className="w-full text-xs border rounded px-2 py-1.5 mb-1.5 bg-background touch-manipulation"
                  >
                    {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                )}
                {/* Toggle buttons */}
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => tlSettings.setHideInactive(v => !v)}
                    title={tlSettings.hideInactive ? 'Show inactive bookings' : 'Hide inactive bookings'}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded text-xs border touch-manipulation transition-colors',
                      tlSettings.hideInactive
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'text-muted-foreground border-border hover:bg-accent',
                    )}
                  >
                    {tlSettings.hideInactive ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    Inactive
                  </button>
                  <button
                    onClick={() => tlSettings.setGroupBySections(v => !v)}
                    title={tlSettings.groupBySections ? 'Hide section dividers' : 'Show section dividers'}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded text-xs border touch-manipulation transition-colors',
                      tlSettings.groupBySections
                        ? 'bg-primary/10 text-primary border-primary/30'
                        : 'text-muted-foreground border-border hover:bg-accent',
                    )}
                  >
                    <Layers className="w-3 h-3" />
                    Sections
                  </button>
                  <button
                    onClick={() => tlSettings.setPanelMode(v => !v)}
                    title={tlSettings.panelMode ? 'Drawer overlay mode' : 'Side panel mode'}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded text-xs border touch-manipulation transition-colors',
                      tlSettings.panelMode
                        ? 'bg-primary/10 text-primary border-primary/30'
                        : 'text-muted-foreground border-border hover:bg-accent',
                    )}
                  >
                    <Columns className="w-3 h-3" />
                    Panel
                  </button>
                  <button
                    onClick={tlSettings.triggerRefetch}
                    title="Refresh timeline"
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs border touch-manipulation text-muted-foreground border-border hover:bg-accent transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Refresh
                  </button>
                  <button
                    onClick={toggleFullscreen}
                    title={isFullscreen ? 'Exit full screen' : 'Full screen'}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs border touch-manipulation text-muted-foreground border-border hover:bg-accent transition-colors"
                  >
                    {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                    {isFullscreen ? 'Exit' : 'Full'}
                  </button>
                </div>
              </>
            ) : (
              /* Icon-only mode */
              <div className="flex flex-col items-center gap-0.5">
                <button
                  onClick={() => tlSettings.setHideInactive(v => !v)}
                  title={tlSettings.hideInactive ? 'Show inactive' : 'Hide inactive'}
                  className={cn(
                    'p-2 rounded touch-manipulation transition-colors',
                    tlSettings.hideInactive ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {tlSettings.hideInactive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => tlSettings.setGroupBySections(v => !v)}
                  title={tlSettings.groupBySections ? 'Hide sections' : 'Show sections'}
                  className={cn(
                    'p-2 rounded touch-manipulation transition-colors',
                    tlSettings.groupBySections ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  <Layers className="w-4 h-4" />
                </button>
                <button
                  onClick={() => tlSettings.setPanelMode(v => !v)}
                  title={tlSettings.panelMode ? 'Drawer overlay mode' : 'Side panel mode'}
                  className={cn(
                    'p-2 rounded touch-manipulation transition-colors',
                    tlSettings.panelMode ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  <Columns className="w-4 h-4" />
                </button>
                <button
                  onClick={tlSettings.triggerRefetch}
                  title="Refresh"
                  className="p-2 rounded hover:bg-accent text-muted-foreground touch-manipulation"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit full screen' : 'Full screen'}
                  className="p-2 rounded hover:bg-accent text-muted-foreground touch-manipulation"
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>
        )}

        {/* User footer */}
        <div className="shrink-0 p-2 border-t">
          {open ? (
            <div className="flex items-center gap-2 px-1 py-1">
              <img
                src={user?.picture}
                alt={user?.name}
                className="w-7 h-7 rounded-full bg-muted shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{user?.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
              <button
                onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
                className="p-1.5 rounded hover:bg-accent text-muted-foreground shrink-0"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
              className="w-full flex justify-center p-2 rounded hover:bg-accent text-muted-foreground"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Outlet />
      </main>

      {/* Mobile-only: floating burger button when sidebar is closed */}
      {!open && (
        <button
          className="fixed top-3.5 left-3.5 z-10 p-2 rounded-md bg-background border shadow-sm lg:hidden"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}
    </div>
  )
}
