// src/components/installer/InstallerShell.jsx
//
// Layout for the installer app (/install, served on installer.<domain>;
// pages/installer, migration 184): a phone app for linking the tills,
// kitchen screens, kiosks and menu screens at a venue. Header only (back,
// title, restaurant group, sign out), the venue being set up below it on
// the home page. While mounted it points the page at the installer's own
// manifest and icon, so it installs as "Macaroonie Installer".
import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, LogOut, Building2, Wrench } from 'lucide-react'
import { useApi, setSelectedTenant } from '@/lib/api'
import PageErrorBoundary from '@/components/PageErrorBoundary'
import TenantSwitcherModal from '@/components/TenantSwitcherModal'
import { InstallerContext, useInstallerVenues } from '@/pages/installer/shared'

const INSTALLER_MANIFEST = '/installer.webmanifest'
const INSTALLER_TOUCH_ICON = '/installer-apple-touch-icon.png'
const INSTALLER_THEME = '#1f3a5f'

function useInstallerManifest() {
  useEffect(() => {
    const tags = [
      [document.querySelector('link[rel="manifest"]'), 'href', INSTALLER_MANIFEST],
      [document.querySelector('link[rel="apple-touch-icon"]'), 'href', INSTALLER_TOUCH_ICON],
      [document.querySelector('meta[name="theme-color"]'), 'content', INSTALLER_THEME],
      [document.querySelector('meta[name="apple-mobile-web-app-title"]'), 'content', 'Installer'],
    ]
    const before = tags.map(([el, attr]) => el?.getAttribute(attr))
    tags.forEach(([el, attr, value]) => el?.setAttribute(attr, value))
    const title = document.title
    document.title = 'Macaroonie Installer'
    return () => {
      tags.forEach(([el, attr], i) => { if (el && before[i] != null) el.setAttribute(attr, before[i]) })
      document.title = title
    }
  }, [])
}

const TITLES = [
  [/^\/install\/link/, 'Link a device'],
  [/^\/install\/add/, 'Add a device'],
  [/^\/install\/device\//, 'Device'],
]

export default function InstallerShell() {
  useInstallerManifest()
  const { logout } = useAuth0()
  const location = useLocation()
  const api = useApi()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 120_000 })
  const venues = useInstallerVenues()
  const [switching, setSwitching] = useState(false)

  const isHome = /^\/install\/?$/.test(location.pathname)
  const title = isHome ? 'Installer' : (TITLES.find(([re]) => re.test(location.pathname))?.[1] || 'Installer')
  const tenants = me?.available_tenants || []
  const ctx = useMemo(() => ({ ...venues, me }), [venues, me])

  function signOut() {
    logout({ logoutParams: { returnTo: window.location.origin } })
  }

  return (
    <div className="flex flex-col bg-page text-foreground" style={{ height: '100dvh' }}>
      <header className="shrink-0 flex items-center gap-2 border-b px-3 bg-background z-10"
        style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))', paddingBottom: '0.625rem' }}>
        {isHome ? (
          <span className="w-11 h-11 flex items-center justify-center rounded-xl bg-[#1f3a5f] text-white shrink-0">
            <Wrench className="w-5 h-5" />
          </span>
        ) : (
          <NavLink to="/install" className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-accent shrink-0 touch-manipulation" aria-label="Back to the installer home">
            <ArrowLeft className="w-5 h-5" />
          </NavLink>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">{title}</h1>
          {me?.current_tenant?.name && <div className="text-xs text-muted-foreground truncate">{me.current_tenant.name}</div>}
        </div>
        {tenants.length > 1 && (
          <button type="button" onClick={() => setSwitching(true)} aria-label="Change restaurant group"
            className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-accent text-muted-foreground shrink-0 touch-manipulation">
            <Building2 className="w-5 h-5" />
          </button>
        )}
        <button type="button" onClick={signOut} aria-label="Sign out"
          className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-accent text-muted-foreground shrink-0 touch-manipulation">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-xl mx-auto p-4 pb-10" style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}>
          <InstallerContext.Provider value={ctx}>
            <PageErrorBoundary key={location.pathname}>
              <Outlet />
            </PageErrorBoundary>
          </InstallerContext.Provider>
        </div>
      </main>

      {switching && (
        <TenantSwitcherModal
          tenants={tenants}
          currentTenantId={me?.current_tenant?.id}
          title="Choose a restaurant group"
          onClose={() => setSwitching(false)}
          onPick={id => { setSelectedTenant(id); window.location.reload() }}
        />
      )}
    </div>
  )
}
