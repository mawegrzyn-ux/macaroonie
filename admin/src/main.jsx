// src/main.jsx  (replace existing — adds all pages)
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import AppShell    from '@/components/layout/AppShell'
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
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function RequireAuth({ children }) {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0()
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    )
  }
  if (!isAuthenticated) { loginWithRedirect(); return null }
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
        organization: import.meta.env.VITE_AUTH0_ORG_ID,
      }}
      useRefreshTokens
      cacheLocation="localstorage"
    >
      <QueryClientProvider client={queryClient}>
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
                <Route path="widget-test" element={<WidgetTest />} />
                <Route path="team"        element={<Placeholder title="Team management" />} />
                <Route path="docs"        element={<Docs />} />
                <Route path="help"        element={<Help />} />
              </Route>
            </Routes>
          </RequireAuth>
        </BrowserRouter>
      </QueryClientProvider>
    </Auth0Provider>
  </React.StrictMode>
)
