// src/components/layout/AppShell.jsx
import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, CalendarDays, BookOpen,
  Building2, Table2, Clock, Settings, Users, UserRound,
  LogOut, LayoutTemplate, Menu, X,
  BookMarked, HelpCircle, SlidersHorizontal, Globe,
  Eye, EyeOff, Layers, RefreshCw, Maximize2, Minimize2, Columns, LayoutList,
  Wallet, Mail, Shield, ChevronDown, Activity, FolderOpen, ChefHat,
} from 'lucide-react'

// Macaroon SVG logo — matches favicon.svg
function MacaroonIcon({ className = 'w-5 h-5' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className={className} aria-hidden="true">
      <ellipse cx="32" cy="42" rx="22" ry="10" fill="#f4a7b9"/>
      <circle cx="22" cy="41" r="1.8" fill="#e8829a" opacity="0.7"/>
      <circle cx="32" cy="43" r="1.8" fill="#e8829a" opacity="0.7"/>
      <circle cx="42" cy="41" r="1.8" fill="#e8829a" opacity="0.7"/>
      <circle cx="27" cy="39" r="1.4" fill="#e8829a" opacity="0.5"/>
      <circle cx="37" cy="39" r="1.4" fill="#e8829a" opacity="0.5"/>
      <ellipse cx="32" cy="34" rx="22" ry="5" fill="#fdf3c8"/>
      <ellipse cx="32" cy="26" rx="22" ry="10" fill="#f4a7b9"/>
      <circle cx="22" cy="25" r="1.8" fill="#e8829a" opacity="0.7"/>
      <circle cx="32" cy="27" r="1.8" fill="#e8829a" opacity="0.7"/>
      <circle cx="42" cy="25" r="1.8" fill="#e8829a" opacity="0.7"/>
      <circle cx="27" cy="23" r="1.4" fill="#e8829a" opacity="0.5"/>
      <circle cx="37" cy="23" r="1.4" fill="#e8829a" opacity="0.5"/>
      <ellipse cx="28" cy="20" rx="8" ry="4" fill="white" opacity="0.25"/>
    </svg>
  )
}
import { cn } from '@/lib/utils'
import { useApi } from '@/lib/api'
import { useTimelineSettings } from '@/contexts/TimelineSettingsContext'
import { useSettings } from '@/contexts/SettingsContext'

// `module` keys map onto tenant_modules + tenant_roles permissions
// loaded by /api/me. Entries with no module are always shown.
const NAV = [
  { label: 'Dashboard',   to: '/',            icon: LayoutDashboard,    module: 'dashboard' },
  { label: 'Timeline',    to: '/timeline',    icon: CalendarDays,       module: 'bookings' },
  { label: 'Bookings',    to: '/bookings',    icon: BookOpen,           module: 'bookings' },
  { label: 'Customers',   to: '/customers',   icon: UserRound,          module: 'customers' },
  null,
  { label: 'Venues',      to: '/venues',      icon: Building2,          module: 'venues' },
  { label: 'Tables',      to: '/tables',      icon: Table2,             module: 'tables' },
  { label: 'Schedule',    to: '/schedule',    icon: Clock,              module: 'schedule' },
  { label: 'Rules',       to: '/rules',       icon: Settings,           module: 'rules' },
  { label: 'Website',     to: '/website',     icon: Globe,              module: 'website' },
  { label: 'Booking widget', to: '/widget-settings', icon: LayoutTemplate, module: 'website' },
  { label: 'Menus',       to: '/menus',       icon: ChefHat,            module: 'menus' },
  { label: 'Media',       to: '/media',       icon: FolderOpen,         module: 'website' },
  { label: 'Cash Recon',  to: '/cash-recon',       icon: Wallet,        module: 'cash_recon' },
  { label: 'Emails',      to: '/email-templates', icon: Mail,           module: 'email_templates' },
  { label: 'Email monitor', to: '/email-monitoring', icon: Activity,    module: 'email_templates' },
  { label: 'Settings',    to: '/settings',         icon: SlidersHorizontal, module: 'settings' },
  { label: 'Widget test', to: '/widget-test', icon: LayoutTemplate,     module: 'widget_test' },
  null,
  { label: 'Team',          to: '/team',   icon: Users,                 module: 'team' },
  { label: 'Access',        to: '/access', icon: Shield,                module: 'team' },
  null,
  { label: 'Documentation', to: '/docs',   icon: BookMarked,            module: 'documentation' },
  { label: 'Help',          to: '/help',   icon: HelpCircle,            module: 'documentation' },
]

const PLATFORM_NAV = [
  { label: 'Tenants',   to: '/platform', icon: Shield },
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
  const { sidebarExpandedDefault } = useSettings()
  const isOnTimeline     = location.pathname === '/timeline'

  // Default: on desktop use the saved preference, on mobile always start closed
  const [open, setOpen] = useState(
    () => typeof window !== 'undefined'
      ? window.innerWidth >= 1024 ? sidebarExpandedDefault : false
      : sidebarExpandedDefault
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

  // /api/me — current user profile + available tenants for org switcher
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn:  () => api.get('/me'),
    staleTime: 120_000,
  })
  const isPlatformAdmin   = me?.is_platform_admin
  const availableTenants  = me?.available_tenants ?? []
  const currentTenant     = me?.current_tenant
  const hasMultipleTenants = availableTenants.length > 1

  // Org switch: re-authenticate with a different organization
  const { loginWithRedirect } = useAuth0()
  function switchTenant(tenantId) {
    const tenant = availableTenants.find(t => t.id === tenantId)
    if (!tenant) return
    // We need the Auth0 org_id, not our internal tenant_id.
    // For now, redirect to login with the tenant slug hint.
    // The Auth0 Action resolves the org from the login.
    loginWithRedirect({
      authorizationParams: {
        organization: tenant.auth0_org_id || undefined,
        prompt: 'login',
      },
    })
  }

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
              <MacaroonIcon className="w-6 h-6 shrink-0" />
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
              <MacaroonIcon className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Org switcher — shown when user has multiple tenants */}
        {open && hasMultipleTenants && (
          <div className="shrink-0 px-3 py-2 border-b">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Tenant
            </p>
            <select
              value={currentTenant?.id || ''}
              onChange={e => switchTenant(e.target.value)}
              className="w-full text-xs border rounded px-2 py-1.5 bg-background touch-manipulation min-h-[36px]"
            >
              {availableTenants.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}
        {!open && hasMultipleTenants && (
          <div className="shrink-0 border-b flex justify-center py-1.5">
            <button
              onClick={() => setOpen(true)}
              title={`Switch tenant (${currentTenant?.name || ''})`}
              className="p-2 rounded hover:bg-accent text-muted-foreground"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Nav links — filter out modules where permission is 'none' (or
             item module is unknown to /me, e.g. while loading). */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {(() => {
            const perms = me?.permissions ?? {}
            const visible = NAV.map(item => {
              if (item === null) return item
              if (!item.module) return item   // always-on entries (none currently)
              const lvl = perms[item.module] ?? 'manage'  // before /me loads, show all to avoid flash
              return lvl === 'none' ? null : item
            })
            // collapse consecutive nulls so we don't render empty dividers
            const cleaned = []
            for (let i = 0; i < visible.length; i++) {
              if (visible[i] === null && visible[i - 1] === null) continue
              cleaned.push(visible[i])
            }
            return cleaned.map((item, i) =>
              item === null
                ? <div key={`sep-${i}`} className={cn('border-t', open ? 'my-2' : 'my-1')} />
                : <NavItem key={item.to} item={item} open={open} />
            )
          })()}
          {isPlatformAdmin && (
            <>
              <div className={cn('border-t', open ? 'my-2' : 'my-1')} />
              {PLATFORM_NAV.map(item => (
                <NavItem key={item.to} item={item} open={open} />
              ))}
            </>
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
                    onClick={() => tlSettings.setTileMode(m => m === 'compact' ? 'extensive' : 'compact')}
                    title={tlSettings.tileMode === 'extensive' ? 'Switch to compact tiles' : 'Switch to detailed tiles'}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded text-xs border touch-manipulation transition-colors',
                      tlSettings.tileMode === 'extensive'
                        ? 'bg-primary/10 text-primary border-primary/30'
                        : 'text-muted-foreground border-border hover:bg-accent',
                    )}
                  >
                    <LayoutList className="w-3 h-3" />
                    Detail
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
                  onClick={() => tlSettings.setTileMode(m => m === 'compact' ? 'extensive' : 'compact')}
                  title={tlSettings.tileMode === 'extensive' ? 'Compact tiles' : 'Detailed tiles'}
                  className={cn(
                    'p-2 rounded touch-manipulation transition-colors',
                    tlSettings.tileMode === 'extensive' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  <LayoutList className="w-4 h-4" />
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
