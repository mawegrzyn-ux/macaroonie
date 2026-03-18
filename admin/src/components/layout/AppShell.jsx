// src/components/layout/AppShell.jsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import {
  LayoutDashboard, CalendarDays, BookOpen,
  Building2, Table2, Clock, Settings, Users,
  ChevronRight, LogOut, Utensils
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  { label: 'Dashboard',  to: '/',          icon: LayoutDashboard },
  { label: 'Timeline',   to: '/timeline',   icon: CalendarDays },
  { label: 'Bookings',   to: '/bookings',   icon: BookOpen },
  null, // divider
  { label: 'Venues',     to: '/venues',     icon: Building2 },
  { label: 'Tables',     to: '/tables',     icon: Table2 },
  { label: 'Schedule',   to: '/schedule',   icon: Clock },
  { label: 'Rules',      to: '/rules',      icon: Settings },
  null,
  { label: 'Team',       to: '/team',       icon: Users },
]

function NavItem({ item }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) => cn(
        'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {item.label}
    </NavLink>
  )
}

export default function AppShell() {
  const { user, logout } = useAuth0()

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col border-r bg-background">
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 h-14 border-b">
          <Utensils className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm">Macaroonie</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {NAV.map((item, i) =>
            item === null
              ? <div key={i} className="my-2 border-t" />
              : <NavItem key={item.to} item={item} />
          )}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t">
          <div className="flex items-center gap-3 px-2 py-1.5 rounded-md">
            <img
              src={user?.picture}
              alt={user?.name}
              className="w-7 h-7 rounded-full bg-muted"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{user?.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
            <button
              onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
