// src/main.jsx: the providers, the sign-in gate, the shells, and every area's routes (src/routes/)
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Flag touch devices on <html> before first render so the Tailwind
// `notouch:` variant (tailwind.config.js) can gate styles the same way
// AppShell's IS_TOUCH check does.
if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) {
  document.documentElement.setAttribute('data-touch', '')
}

// ops.<domain> is the phone app's own origin: point the page at its manifest
// before anything renders, so Android installs it as "Macaroonie Ops" and not
// as the admin (MobileShell swaps the other tags when it mounts).
if (typeof window !== 'undefined' && window.location.hostname.startsWith('ops.')) {
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/ops.webmanifest')
}
// installer.<domain> is the installer app's own origin (pages/installer):
// its manifest from the start, so it installs as "Macaroonie Installer".
if (typeof window !== 'undefined' && window.location.hostname.startsWith('installer.')) {
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/installer.webmanifest')
}

// A picture or link dropped where nothing takes it does nothing, instead of
// the browser opening it over the admin (and losing unsaved work).
import { installDropGuard } from '@/lib/fileDrop'
installDropGuard()

import AppShell    from '@/components/layout/AppShell'
import MobileShell from '@/components/mobile/MobileShell'
import TenantGate  from '@/components/TenantGate'
import { TimelineSettingsProvider } from '@/contexts/TimelineSettingsContext'
import { SettingsProvider } from '@/contexts/SettingsContext'
import './index.css'
import { IS_OPS_HOST, IS_INSTALLER_HOST } from '@/lib/hosts'
import { inOfficeApp, OfficeAuthProvider } from '@/lib/officeApp'
import InstallerShell  from '@/components/installer/InstallerShell'

// Every area's pages (docs/PARALLEL_WORK.md 3.4): admin/src/routes/<area>.jsx
// each export `routes`, a list of { path | index, shell, element }. The shell
// is the layout a page opens in: 'office' (AppShell), 'mobile' (MobileShell),
// 'installer' (InstallerShell) or 'bare' (none). React Router ranks routes by
// their paths, so the files need no order; the routes kept below (redirects
// and the phone's catch-all) come after the gathered ones.
const SHELLS = ['bare', 'installer', 'office', 'mobile']
const AREA_ROUTES = Object.entries(import.meta.glob('./routes/*.jsx', { eager: true }))
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .flatMap(([file, m]) => (m.routes || []).map(r => ({ ...r, file })))
for (const r of AREA_ROUTES) {
  if (!SHELLS.includes(r.shell)) console.error('Route ' + (r.path || 'index') + ' in ' + r.file + ' has no known shell: ' + r.shell)
}
const routesIn = shell => AREA_ROUTES.filter(r => r.shell === shell).map(r => (r.index
  ? <Route key={shell + ':index'} index element={r.element} />
  : <Route key={shell + ':' + r.path} path={r.path} element={r.element} />))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

// Inside the Macaroonie Office app, sign-in is the app's (lib/officeApp.jsx):
// its bridge fills Auth0's context, so the pages work unchanged.
const AuthProvider = inOfficeApp()
  ? ({ children }) => <OfficeAuthProvider>{children}</OfficeAuthProvider>
  : Auth0Provider

// Invitation links still need the Auth0 organization param so the invite
// can be accepted. Everyday login does NOT pass an organization — after
// identity is established, TenantGate lets the user pick a restaurant.
function RequireAuth({ children }) {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0()

  const params = new URLSearchParams(window.location.search)
  const invitation   = params.get('invitation')
  const organization = params.get('organization')
  const hasInviteParams = !!(invitation && organization)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    )
  }

  // Handle invitation links even if a session already exists — the
  // invitation acceptance must run regardless of current auth state.
  if (hasInviteParams) {
    loginWithRedirect({ authorizationParams: { invitation, organization } })
    return null
  }

  if (!isAuthenticated) {
    // Come back to the page asked for (a deep link, the connector sign-in
    // page), not the Overview: onRedirectCallback below.
    loginWithRedirect({ appState: { returnTo: window.location.pathname + window.location.search } })
    return null
  }
  return children
}

/** After Auth0 sends the person back: to the page they asked for. */
function onRedirectCallback(appState) {
  const to = appState?.returnTo
  if (to && to !== '/' && to.startsWith('/')) window.location.replace(to)
  else window.history.replaceState({}, document.title, window.location.pathname)
}

// A device's QR code opens <installer>/link/<code>: the installer's Link page.
function LinkRedirect() {
  const { code } = useParams()
  return <Navigate to={'/install/link/' + encodeURIComponent(code || '')} replace />
}

// A page that moved (migration 241 gave the designers their own addresses):
// the old address goes to the new one, keeping its id and its ?query.
function Moved({ to }) {
  const params = useParams()
  const { search } = useLocation()
  return <Navigate to={to(params) + search} replace />
}

const Placeholder = ({ title }) => (
  <div className="flex items-center justify-center h-full">
    <p className="text-muted-foreground text-sm">{title} — coming soon</p>
  </div>
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience:     import.meta.env.VITE_AUTH0_AUDIENCE,
        scope:        'openid profile email',
        // Do NOT set organization here — login is identity-only. The restaurant
        // is picked in TenantGate and sent as X-Tenant-Id. Invitation links
        // still pass organization via loginWithRedirect in RequireAuth.
      }}
      useRefreshTokens
      cacheLocation="localstorage"
      onRedirectCallback={onRedirectCallback}
    >
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
        <TimelineSettingsProvider>
        <BrowserRouter>
          <RequireAuth>
            <TenantGate>
            <Routes>
              {routesIn('bare')}
              {/* The installer app (installer.<domain>, migration 184) and its QR code links. */}
              <Route path="install" element={<InstallerShell />}>
                {routesIn('installer')}
              </Route>
              <Route path="link/:code" element={<LinkRedirect />} />
              {/* ops.<domain> is the phone app only, installer.<domain> the installer only (lib/hosts.js) */}
              <Route element={IS_INSTALLER_HOST ? <Navigate to="/install" replace /> : IS_OPS_HOST ? <Navigate to="/mobile" replace /> : <AppShell />}>
                {routesIn('office')}
                <Route path="pos/kiosks/designs/:id" element={<Moved to={p => '/pos/kiosk-designs/' + p.id} />} />
                <Route path="pos/printing/designs/:id" element={<Moved to={p => '/pos/print-designs/' + p.id} />} />
                {/* The old address. nginx sends everything under /reservations to
                    the API (the guests' widget), so this only ever worked for
                    links inside the app; the page lives under /website. */}
                <Route path="reservations-widget" element={<Navigate to="/website/reservations-widget" replace />} />
                <Route path="menus/:id/design"      element={<Moved to={p => '/menus/print-designs/' + p.id} />} />
              </Route>
              <Route path="mobile" element={IS_INSTALLER_HOST ? <Navigate to="/install" replace /> : <MobileShell />}>
                {routesIn('mobile')}
                {/* A page the phone no longer has (Dashboards): the hub. */}
                <Route path="*"            element={<Navigate to="/mobile" replace />} />
              </Route>
            </Routes>
            </TenantGate>
          </RequireAuth>
        </BrowserRouter>
        </TimelineSettingsProvider>
        </SettingsProvider>
      </QueryClientProvider>
    </AuthProvider>
  </React.StrictMode>
)
