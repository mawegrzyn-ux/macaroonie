// src/components/layout/AppShell.jsx
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import {
  LayoutDashboard, CalendarDays, BookOpen,
  Building2, Table2, Clock, Settings, Users, UserRound,
  LogOut, Utensils, LayoutTemplate, Menu, X,
  BookMarked, HelpCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

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
  // Default: open on desktop (≥1024px), closed on mobile
  const [open, setOpen] = useState(
    () => typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  )

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
