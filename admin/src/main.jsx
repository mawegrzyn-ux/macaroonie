// src/main.jsx  (replace existing — adds all pages)
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import AppShell    from '@/components/layout/AppShell'
import { TimelineSettingsProvider } from '@/contexts/TimelineSettingsContext'
import { SettingsProvider } from '@/contexts/SettingsContext'
import Dashboard   from '@/pages/Dashboard'
import Timeline    from '@/pages/Timeline'
import Bookings    from '@/pages/Bookings'
import Customers   from '@/pages/Customers'
import Venues      from '@/pages/Venues'
import Tables      from '@/pages/Tables'
import Schedule    from '@/pages/Schedule'
import Rules       from '@/pages/Rules'
import WidgetTest  from '@/pages/WidgetTest'
import Docs        from '@/pages/Docs'
import Help        from '@/pages/Help'
import Settings    from '@/pages/Settings'
import Website     from '@/pages/Website'
import WidgetSettings from '@/pages/WidgetSettings'
import CashRecon      from '@/pages/CashRecon'
import EmailTemplates from '@/pages/EmailTemplates'
import EmailMonitoring from '@/pages/EmailMonitoring'
import Media          from '@/pages/Media'
import Menus          from '@/pages/Menus'
import Team           from '@/pages/Team'
import Access         from '@/pages/Access'
import Platform       from '@/pages/Platform'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function RequireAuth({ children }) {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0()

  // Detect Auth0 organization invitation params on the current URL.
  // When a user clicks the invitation email link Auth0 redirects them
  // here with `?invitation=...&organization=...`. We must forward those
  // to /authorize so the invitation is accepted; otherwise Auth0 just
  // sees a non-member trying to log into the org and rejects with
  // "user X is not part of org_Y".
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
    loginWithRedirect()
    return null
  }
  return children
}

const Placeholder = ({ title }) => (
  <div className="flex items-center justify-center h-full">
    <p className="text-muted-foreground text-sm">{title} — coming soon</p>
  </div>
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience:     import.meta.env.VITE_AUTH0_AUDIENCE,
        scope:        'openid profile email',
        ...(import.meta.env.VITE_AUTH0_ORG_ID ? { organization: import.meta.env.VITE_AUTH0_ORG_ID } : {}),
      }}
      useRefreshTokens
      cacheLocation="localstorage"
    >
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
        <TimelineSettingsProvider>
        <BrowserRouter>
          <RequireAuth>
            <Routes>
              <Route element={<AppShell />}>
                <Route index          element={<Dashboard />} />
                <Route path="timeline" element={<Timeline />} />
                <Route path="bookings"   element={<Bookings />} />
                <Route path="customers" element={<Customers />} />
                <Route path="venues"    element={<Venues />} />
                <Route path="tables"   element={<Tables />} />
                <Route path="schedule" element={<Schedule />} />
                <Route path="rules"       element={<Rules />} />
                <Route path="website"     element={<Website />} />
                <Route path="widget-settings" element={<WidgetSettings />} />
                <Route path="cash-recon" element={<CashRecon />} />
                <Route path="email-templates" element={<EmailTemplates />} />
                <Route path="email-monitoring" element={<EmailMonitoring />} />
                <Route path="media"            element={<Media />} />
                <Route path="menus"            element={<Menus />} />
                <Route path="widget-test" element={<WidgetTest />} />
                <Route path="team"        element={<Team />} />
                <Route path="access"      element={<Access />} />
                <Route path="platform"    element={<Platform />} />
                <Route path="docs"        element={<Docs />} />
                <Route path="help"        element={<Help />} />
                <Route path="settings"    element={<Settings />} />
              </Route>
            </Routes>
          </RequireAuth>
        </BrowserRouter>
        </TimelineSettingsProvider>
        </SettingsProvider>
      </QueryClientProvider>
    </Auth0Provider>
  </React.StrictMode>
)
