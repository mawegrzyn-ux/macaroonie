// src/main.jsx  (replace existing — adds all pages)
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
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
import MobileHub   from '@/pages/mobile/MobileHub'
import MobileHSDashboard from '@/pages/mobile/MobileHSDashboard'
import MobileDashboards from '@/pages/mobile/MobileDashboard'
import MobileExpenses from '@/pages/mobile/MobileExpenses'
import MobilePurchasing from '@/pages/mobile/MobilePurchasing'
import MobileCashUp from '@/pages/mobile/MobileCashUp'
import MobileWages from '@/pages/mobile/MobileWages'
import TenantGate  from '@/components/TenantGate'
import ConnectAi   from '@/pages/ConnectAi'
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
import CashRecon      from '@/pages/CashRecon'
import EmailTemplates from '@/pages/EmailTemplates'
import EmailMonitoring from '@/pages/EmailMonitoring'
import Media          from '@/pages/Media'
import Reviews        from '@/pages/Reviews'
import Menus          from '@/pages/Menus'
import MenuVariantGroups from '@/pages/MenuVariantGroups'
import MenuDietaryTags from '@/pages/MenuDietaryTags'
import MenuAllergenMatrix from '@/pages/MenuAllergenMatrix'
import MenuTax from '@/pages/MenuTax'
import MenuDeliveroo from '@/pages/MenuDeliveroo'
import MenuTranslations from '@/pages/MenuTranslations'
import MenuDesigner from '@/pages/MenuDesigner'
import Screens from '@/pages/Screens'
import ScreenDesigner from '@/pages/ScreenDesigner'
import Team           from '@/pages/Team'
import Access         from '@/pages/Access'
import Platform       from '@/pages/Platform'
import Backlog         from '@/pages/Backlog'
import IssueLog        from '@/pages/IssueLog'
import FeatureRequests from '@/pages/FeatureRequests'
import Changelog       from '@/pages/Changelog'
import Purchasing           from '@/pages/Purchasing'
import OrderLists           from '@/pages/OrderLists'
import Inventory            from '@/pages/Inventory'
import Suppliers            from '@/pages/Suppliers'
import TestData        from '@/pages/TestData'
import LegacyImport     from '@/pages/LegacyImport'
import FoodSafety      from '@/pages/FoodSafety'
import Checklists      from '@/pages/Checklists'
import HSDashboard     from '@/pages/HSDashboard'
import CashDashboard   from '@/pages/CashDashboard'
import Staff           from '@/pages/Staff'
import StaffRoles      from '@/pages/StaffRoles'
import Rota            from '@/pages/Rota'
import RotaSetup       from '@/pages/RotaSetup'
import RotaDashboard   from '@/pages/RotaDashboard'
import Dashboards      from '@/pages/Dashboards'
import HSActionLog     from '@/pages/HSActionLog'
import Orders          from '@/pages/Orders'
import OrderingSettings from '@/pages/OrderingSettings'
import PosSetup from '@/pages/PosSetup'
import PosFloor from '@/pages/PosFloor'
import PosReports from '@/pages/PosReports'
import KioskDesigner from '@/pages/KioskDesigner'
import Promotions from '@/pages/Promotions'
import MobileOrders    from '@/pages/mobile/MobileOrders'
import MobileAllergens from '@/pages/mobile/MobileAllergens'
import MobileAssistant from '@/pages/mobile/MobileAssistant'
import AiAssistant     from '@/pages/AiAssistant'
import NavDesigner     from '@/pages/NavDesigner'
import Launcher        from '@/pages/Launcher'
import './index.css'
import { IS_OPS_HOST, IS_INSTALLER_HOST } from '@/lib/hosts'
import InstallerShell  from '@/components/installer/InstallerShell'
import InstallerHome   from '@/pages/installer/InstallerHome'
import InstallerLink   from '@/pages/installer/InstallerLink'
import InstallerAdd    from '@/pages/installer/InstallerAdd'
import InstallerDevice from '@/pages/installer/InstallerDevice'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

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
              {/* An AI app's connector sign-in (migration 181): its own page, no app shell. */}
              <Route path="connect-ai" element={<ConnectAi />} />
              {/* The installer app (installer.<domain>, migration 184) and its QR code links. */}
              <Route path="install" element={<InstallerShell />}>
                <Route index element={<InstallerHome />} />
                <Route path="link" element={<InstallerLink />} />
                <Route path="link/:code" element={<InstallerLink />} />
                <Route path="add" element={<InstallerAdd />} />
                <Route path="device/:kind/:id" element={<InstallerDevice />} />
              </Route>
              <Route path="link/:code" element={<LinkRedirect />} />
              {/* ops.<domain> is the phone app only, installer.<domain> the installer only (lib/hosts.js) */}
              <Route element={IS_INSTALLER_HOST ? <Navigate to="/install" replace /> : IS_OPS_HOST ? <Navigate to="/mobile" replace /> : <AppShell />}>
                <Route index          element={<Dashboard />} />
                <Route path="dashboards" element={<Dashboards />} />
                <Route path="timeline" element={<Timeline />} />
                <Route path="bookings"   element={<Bookings />} />
                <Route path="customers" element={<Customers />} />
                <Route path="orders" element={<Orders />} />
                <Route path="orders/settings" element={<OrderingSettings />} />
                <Route path="pos" element={<PosSetup />} />
                <Route path="pos/floor" element={<PosFloor />} />
                <Route path="pos/reports" element={<PosReports />} />
                <Route path="pos/kiosk-designs/:id" element={<KioskDesigner />} />
                <Route path="promotions" element={<Promotions />} />
                <Route path="venues"    element={<Venues />} />
                <Route path="tables"   element={<Tables />} />
                <Route path="schedule" element={<Schedule />} />
                <Route path="rules"       element={<Rules />} />
                <Route path="website"     element={<Website />} />
                <Route path="reservations-widget" element={<Navigate to="/website?section=tenant-widget" replace />} />
                <Route path="cash-recon" element={<CashRecon />} />
                <Route path="food-safety" element={<FoodSafety />} />
                <Route path="checklists" element={<Checklists />} />
                <Route path="hs-dashboard" element={<HSDashboard />} />
                <Route path="cash-dashboard" element={<CashDashboard />} />
                <Route path="staff"          element={<Staff />} />
                <Route path="staff/roles"    element={<StaffRoles />} />
                <Route path="rota"           element={<Rota />} />
                <Route path="rota/setup"     element={<RotaSetup />} />
                <Route path="rota-dashboard" element={<RotaDashboard />} />
                <Route path="hs-action-log" element={<HSActionLog />} />
                <Route path="email-templates" element={<EmailTemplates />} />
                <Route path="email-monitoring" element={<EmailMonitoring />} />
                <Route path="media"            element={<Media />} />
                <Route path="reviews"         element={<Reviews />} />
                <Route path="menus"            element={<Menus />} />
                <Route path="menus/variant-groups" element={<MenuVariantGroups />} />
                <Route path="menus/dietary-tags"    element={<MenuDietaryTags />} />
                <Route path="menus/allergens"       element={<MenuAllergenMatrix />} />
                <Route path="menus/tax"             element={<MenuTax />} />
                <Route path="menus/deliveroo"       element={<MenuDeliveroo />} />
                <Route path="menus/translations"    element={<MenuTranslations />} />
                <Route path="menus/:id/design"      element={<MenuDesigner />} />
                <Route path="screens"               element={<Screens />} />
                <Route path="screens/boards/:id"    element={<ScreenDesigner />} />
                <Route path="widget-test" element={<WidgetTest />} />
                <Route path="test-data"   element={<TestData />} />
                <Route path="legacy-import" element={<LegacyImport />} />
                <Route path="team"        element={<Team />} />
                <Route path="access"      element={<Access />} />
                <Route path="platform"           element={<Platform />} />
                <Route path="backlog"            element={<Backlog />} />
                <Route path="issues"             element={<IssueLog />} />
                <Route path="feature-requests"   element={<FeatureRequests />} />
                <Route path="changelog"          element={<Changelog />} />
                <Route path="purchasing"              element={<Purchasing />} />
                <Route path="purchasing/lists"        element={<OrderLists />} />
                <Route path="inventory"               element={<Inventory />} />
                <Route path="suppliers"               element={<Suppliers />} />
                <Route path="docs"               element={<Docs />} />
                <Route path="help"        element={<Help />} />
                <Route path="settings"    element={<Settings />} />
                <Route path="ai"          element={<AiAssistant />} />
                <Route path="nav-designer" element={<NavDesigner />} />
                <Route path="launcher"     element={<Launcher />} />
              </Route>
              <Route path="mobile" element={IS_INSTALLER_HOST ? <Navigate to="/install" replace /> : <MobileShell />}>
                <Route index          element={<MobileHub />} />
                <Route path="hs-dashboard" element={<MobileHSDashboard />} />
                <Route path="dashboards"   element={<MobileDashboards />} />
                <Route path="expenses"     element={<MobileExpenses />} />
                <Route path="purchasing" element={<MobilePurchasing />} />
                <Route path="cash-up"      element={<MobileCashUp />} />
                <Route path="wages"        element={<MobileWages />} />
                <Route path="orders"       element={<MobileOrders />} />
                <Route path="allergens"    element={<MobileAllergens />} />
                <Route path="assistant"    element={<MobileAssistant />} />
              </Route>
            </Routes>
            </TenantGate>
          </RequireAuth>
        </BrowserRouter>
        </TimelineSettingsProvider>
        </SettingsProvider>
      </QueryClientProvider>
    </Auth0Provider>
  </React.StrictMode>
)
