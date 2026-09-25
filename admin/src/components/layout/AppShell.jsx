// src/components/layout/AppShell.jsx
import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useQuery } from '@tanstack/react-query'
import * as LucideIcons from 'lucide-react'
import {
  LogOut, Menu, X,
  Eye, EyeOff, RefreshCw, Maximize2, Minimize2, Columns, LayoutList, Layers,
  Shield, ChevronDown, Hand, KanbanSquare, LayoutGrid,
} from 'lucide-react'

// nav_items.icon is a plain lucide-react component name (string), set by
// the nav designer's icon picker — resolve it dynamically instead of
// maintaining a hand-written name → component map. Falls back to a
// generic dot if an icon name is missing/renamed/typo'd, rather than
// crashing the whole sidebar.
function resolveIcon(name) {
  return LucideIcons[name] || LucideIcons.Circle
}

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
import { useApi, setSelectedTenant } from '@/lib/api'
import TenantSwitcherModal from '@/components/TenantSwitcherModal'
import MobileSuggestModal from '@/components/MobileSuggestModal'
import MobileViewToggle from '@/components/MobileViewToggle'
import { useTimelineSettings } from '@/contexts/TimelineSettingsContext'
import { useSettings, applySiteTheme } from '@/contexts/SettingsContext'

// The tenant-customisable nav tree comes from /api/me's nav_tree (see
// the nav designer, api/src/routes/nav.js) — already filtered server-side
// to what this user's role can see (module permissions + per-item
// hidden_role_ids). This file no longer hardcodes the nav structure at
// all; it just renders whatever tree it's handed. `toNavItem` adapts one
// API node (route/icon-as-string) into the shape NavItem expects
// (to/icon-as-component), recursively.
function toNavItem(node) {
  const children = (node.children || []).filter(c => c.kind === 'link').map(toNavItem)
  return {
    label: node.label,
    to: node.route,
    icon: resolveIcon(node.icon),
    // An item with children needs exact-match active state, or its own
    // NavLink stays "active" while browsing any child's route too (NavLink
    // defaults to prefix matching) — same reasoning the old hardcoded nav
    // applied to Order sheets/Menus/Emails.
    end: children.length > 0,
    children,
  }
}

const PLATFORM_NAV = [
  { label: 'Tenants',   to: '/platform', icon: Shield },
  { label: 'Backlog',   to: '/backlog',  icon: KanbanSquare },
]

function NavItem({ item, open }) {
  const location = useLocation()
  const Icon = item.icon
  const children = item.children || []
  const childActive = children.some(c =>
    location.pathname === c.to || location.pathname.startsWith(c.to + '/'))
  const parentActive = location.pathname === item.to
  const [expanded, setExpanded] = useState(childActive || parentActive)

  useEffect(() => {
    if (childActive || parentActive) setExpanded(true)
  }, [childActive, parentActive])

  return (
    <div>
      <div className="flex items-center">
        <NavLink
          to={item.to}
          end={item.end ?? item.to === '/'}
          title={!open ? item.label : undefined}
          className={({ isActive }) => cn(
            'flex items-center gap-3 py-2 rounded-md text-sm font-medium transition-colors flex-1 min-w-0',
            open ? 'px-3' : 'justify-center px-2',
            (isActive)
              ? 'bg-primary text-primary-foreground'
              : childActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <Icon className="w-4 h-4 shrink-0" />
          {open && <span className="whitespace-nowrap truncate">{item.label}</span>}
        </NavLink>
        {open && children.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 mr-1 rounded text-muted-foreground hover:bg-accent"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && expanded && children.length > 0 && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l pl-1">
          {children.map(c => <NavItem key={c.to} item={c} open={open} />)}
        </div>
      )}
    </div>
  )
}

export default function AppShell() {
  const { user, logout } = useAuth0()
  const location         = useLocation()

  function handleLogout() {
    try { localStorage.removeItem('maca_auth0_org_hint') } catch {}
    logout({ logoutParams: { returnTo: window.location.origin } })
  }
  const api              = useApi()
  const tlSettings       = useTimelineSettings()
  const { sidebarExpandedDefault } = useSettings()
  const isOnTimeline     = location.pathname === '/timeline'

  const [open, setOpen] = useState(
    () => typeof window !== 'undefined'
      ? window.innerWidth >= 1024 ? sidebarExpandedDefault : false
      : sidebarExpandedDefault
  )

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

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
    enabled:  isOnTimeline,
  })

  const effectiveVenueId = tlSettings.venueId ?? venues[0]?.id ?? ''

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn:  () => api.get('/me'),
    staleTime: 120_000,
  })
  const isPlatformAdmin   = me?.is_platform_admin
  const availableTenants  = me?.available_tenants ?? []
  const currentTenant     = me?.current_tenant
  const hasTenants        = availableTenants.length > 0
  const canSwitchTenant   = availableTenants.length > 1
  const isLauncherMode    = currentTenant?.nav_style === 'launcher'

  useEffect(() => {
    if (me?.site_theme) applySiteTheme(me.site_theme)
  }, [me?.site_theme])

  const [switcherOpen, setSwitcherOpen] = useState(false)

  function switchTenant(tenantId) {
    if (!tenantId) return
    setSelectedTenant(tenantId)
    window.location.reload()
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={cn(
        'flex flex-col border-r bg-background z-30 transition-[width] duration-200 overflow-hidden shrink-0',
        'fixed inset-y-0 left-0 lg:relative',
        open ? 'w-56' : 'w-0 lg:w-14',
      )}>
        <div className={cn(
          'flex items-center h-14 border-b shrink-0',
          open ? 'px-4 gap-2' : 'justify-center px-0',
        )}>
          {open ? (
            <>
              <MacaroonIcon className="w-6 h-6 shrink-0" />
              {canSwitchTenant ? (
                <button
                  type="button"
                  onClick={() => setSwitcherOpen(true)}
                  className="flex-1 min-w-0 flex items-center gap-1 -mx-1 px-1 py-1.5 rounded text-left touch-manipulation hover:bg-accent"
                  title={currentTenant ? `Tenant: ${currentTenant.name} — click to switch` : 'No tenant selected — click to switch'}
                >
                  <span className={cn('font-semibold text-sm truncate leading-none', !currentTenant && 'text-amber-600')}>
                    {currentTenant ? currentTenant.name : 'Choose a restaurant'}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                </button>
              ) : (
                <span className="font-semibold text-sm flex-1 truncate leading-none">
                  {currentTenant ? currentTenant.name : 'Macaroonie'}
                </span>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded hover:bg-accent text-muted-foreground shrink-0"
                title="Collapse sidebar"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              onClick={() => setOpen(true)}
              className="p-2 rounded hover:bg-accent text-primary"
              title="Expand sidebar"
            >
              <MacaroonIcon className="w-6 h-6" />
            </button>
          )}
        </div>
        {open && hasTenants && !currentTenant && (
          <button
            type="button"
            onClick={() => setSwitcherOpen(true)}
            className="shrink-0 w-full text-left px-4 py-1.5 text-[11px] font-medium text-amber-600 bg-amber-50 border-b touch-manipulation hover:bg-amber-100"
          >
            No tenant selected — tap to choose a restaurant
          </button>
        )}
        {!open && hasTenants && (
          <div className="shrink-0 border-b flex justify-center py-1.5">
            <button
              onClick={() => setSwitcherOpen(true)}
              title={currentTenant ? `Tenant: ${currentTenant.name} — click to switch` : 'No tenant selected — click to switch'}
              className={cn(
                'p-2 rounded touch-manipulation',
                !currentTenant ? 'text-amber-500 hover:bg-amber-50' : 'hover:bg-accent text-muted-foreground',
              )}
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        )}
        {switcherOpen && (
          <TenantSwitcherModal
            tenants={availableTenants}
            currentTenantId={currentTenant?.id}
            onPick={switchTenant}
            onClose={() => setSwitcherOpen(false)}
            title="Switch restaurant"
            subtitle="Pick which restaurant to work in."
          />
        )}
        <nav className="flex-1 overflow-y-auto p-2 space-y-3">
          {isLauncherMode ? (
            // Launcher mode: the sidebar tree is switched off tenant-wide
            // (Settings → Navigation) in favour of the quick-access tile
            // grid. Keep one link back to it so nobody's stranded — the
            // launcher itself surfaces everything else the role can reach.
            <NavItem item={{ label: 'Quick access', to: '/launcher', icon: LayoutGrid, children: [] }} open={open} />
          ) : (
            (me?.nav_tree ?? []).map(node => {
              if (node.kind === 'section') {
                const items = (node.children || []).filter(c => c.kind === 'link').map(toNavItem)
                if (!items.length) return null
                return (
                  <div key={node.id}>
                    {open && (
                      <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {node.label}
                      </p>
                    )}
                    <div className="space-y-0.5">
                      {items.map(item => <NavItem key={item.to} item={item} open={open} />)}
                    </div>
                  </div>
                )
              }
              return <NavItem key={node.id} item={toNavItem(node)} open={open} />
            })
          )}
          {isPlatformAdmin && (
            <>
              {open && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Platform
                </p>
              )}
              <div className="space-y-0.5">
                {PLATFORM_NAV.map(item => (
                  <NavItem key={item.to} item={item} open={open} />
                ))}
              </div>
            </>
          )}
        </nav>
        {isOnTimeline && (
          <div className={cn('shrink-0 border-t', open ? 'p-2' : 'p-1')}>
            {open ? (
              <>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1.5">
                  Timeline
                </p>
                {venues.length > 1 && (
                  <select
                    value={effectiveVenueId}
                    onChange={e => tlSettings.setVenueId(e.target.value)}
                    className="w-full text-xs border rounded px-2 py-1.5 mb-1.5 bg-background touch-manipulation"
                  >
                    {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                )}
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
                    onClick={() => tlSettings.setManualMode(v => !v)}
                    title={tlSettings.manualMode ? 'Manual mode on' : 'Manual mode off'}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded text-xs border touch-manipulation transition-colors',
                      tlSettings.manualMode
                        ? 'bg-amber-500 text-white border-amber-600'
                        : 'text-muted-foreground border-border hover:bg-accent',
                    )}
                  >
                    <Hand className="w-3 h-3" />
                    Manual
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
                  onClick={() => tlSettings.setManualMode(v => !v)}
                  title={tlSettings.manualMode ? 'Manual mode on' : 'Manual mode off'}
                  className={cn(
                    'p-2 rounded touch-manipulation transition-colors',
                    tlSettings.manualMode ? 'text-white bg-amber-500' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  <Hand className="w-4 h-4" />
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
                {currentTenant ? (
                  <p className="text-xs text-muted-foreground truncate">{currentTenant.name}</p>
                ) : (
                  <p className="text-xs text-amber-500 truncate">No tenant</p>
                )}
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded hover:bg-accent text-muted-foreground shrink-0"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogout}
              className="w-full flex justify-center p-2 rounded hover:bg-accent text-muted-foreground"
              title={`Sign out${currentTenant ? ` (${currentTenant.name})` : ''}`}
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Outlet />
      </main>
      {!open && (
        <button
          className="fixed top-3.5 left-3.5 z-40 p-2 rounded-md bg-background border shadow-sm lg:hidden"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}
      <MobileSuggestModal />
      <MobileViewToggle target="mobile" />
    </div>
  )
}
