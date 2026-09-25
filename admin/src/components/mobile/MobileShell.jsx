// src/components/mobile/MobileShell.jsx
//
// Layout shell for the /mobile/* section — a phone-portrait-first area of
// the same admin SPA (same Auth0 session, same API, same deploy). It swaps
// the page's PWA manifest + icons to a distinct "Macaroonie Ops" identity
// while any /mobile route is mounted, so "Add to Home Screen" installs a
// separate-looking app even though it's the same origin and bundle.
//
// New mobile-optimised modules register in mobile/registry.js and get a
// tile on the hub screen automatically — this shell + registry pair is the
// reusable piece, not a one-off page.

import { useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, LogOut, LayoutGrid } from 'lucide-react'
import { useApi } from '@/lib/api'
import { applySiteTheme } from '@/contexts/SettingsContext'
import { MOBILE_MODULES } from '@/mobile/registry'
import MobileViewToggle from '@/components/MobileViewToggle'

const MAIN_MANIFEST_HREF = '/manifest.webmanifest'
const MOBILE_MANIFEST_HREF = '/mobile.webmanifest'
const MAIN_TOUCH_ICON = '/apple-touch-icon.png'
const MOBILE_TOUCH_ICON = '/mobile-apple-touch-icon.png'
const MAIN_THEME_COLOR = '#630812'
const MOBILE_THEME_COLOR = '#0f5c4f'

function useMobileManifest() {
  useEffect(() => {
    const manifestLink = document.querySelector('link[rel="manifest"]')
    const touchIconLink = document.querySelector('link[rel="apple-touch-icon"]')
    const themeMeta = document.querySelector('meta[name="theme-color"]')
    const titleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]')

    const prevManifest = manifestLink?.getAttribute('href') ?? MAIN_MANIFEST_HREF
    const prevTouchIcon = touchIconLink?.getAttribute('href') ?? MAIN_TOUCH_ICON
    const prevTheme = themeMeta?.getAttribute('content') ?? MAIN_THEME_COLOR
    const prevTitle = titleMeta?.getAttribute('content') ?? 'Macaroonie'

    manifestLink?.setAttribute('href', MOBILE_MANIFEST_HREF)
    touchIconLink?.setAttribute('href', MOBILE_TOUCH_ICON)
    themeMeta?.setAttribute('content', MOBILE_THEME_COLOR)
    titleMeta?.setAttribute('content', 'Macaroonie Ops')

    return () => {
      manifestLink?.setAttribute('href', prevManifest)
      touchIconLink?.setAttribute('href', prevTouchIcon)
      themeMeta?.setAttribute('content', prevTheme)
      titleMeta?.setAttribute('content', prevTitle)
    }
  }, [])
}

export default function MobileShell() {
  useMobileManifest()

  const { logout } = useAuth0()
  const location = useLocation()
  const navigate = useNavigate()
  const api = useApi()

  // /mobile mounts under its own shell, never AppShell — so the site-accent
  // theme AppShell applies from GET /me has to be fetched here too, or the
  // H&S Dashboard widget headers (which use --site-accent) fall back to the
  // hardcoded default colour instead of the tenant's actual brand colour.
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get('/me'),
    staleTime: 120_000,
  })
  useEffect(() => {
    if (me?.site_theme) applySiteTheme(me.site_theme)
  }, [me?.site_theme])

  const isHub = location.pathname === '/mobile' || location.pathname === '/mobile/'
  const activeModule = MOBILE_MODULES.find(m => location.pathname.startsWith(m.path))
  const title = isHub ? 'Ops' : (activeModule?.label ?? 'Ops')

  function handleLogout() {
    try { localStorage.removeItem('maca_auth0_org_hint') } catch {}
    logout({ logoutParams: { returnTo: window.location.origin } })
  }

  return (
    <div
      className="flex flex-col bg-background text-foreground"
      style={{ height: '100dvh' }}
    >
      <header
        className="shrink-0 flex items-center gap-2 border-b px-3 bg-background z-10"
        style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))', paddingBottom: '0.625rem' }}
      >
        {isHub ? (
          <span className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#0f5c4f]/10 text-[#0f5c4f] shrink-0">
            <LayoutGrid className="w-5 h-5" />
          </span>
        ) : (
          <NavLink
            to="/mobile"
            className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-accent shrink-0 touch-manipulation"
            aria-label="Back to Ops home"
          >
            <ArrowLeft className="w-5 h-5" />
          </NavLink>
        )}
        <h1 className="flex-1 min-w-0 text-base font-semibold truncate">{title}</h1>
        <button
          type="button"
          onClick={handleLogout}
          className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground shrink-0 touch-manipulation"
          aria-label="Sign out"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto overscroll-contain">
        <Outlet />
      </main>
      <MobileViewToggle target="standard" />
    </div>
  )
}
