// admin/src/routes/dashboards.jsx: the Dashboards area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import Dashboard from '@/pages/Dashboard'
import Dashboards from '@/pages/Dashboards'
import HSDashboard from '@/pages/HSDashboard'
import CashDashboard from '@/pages/CashDashboard'
import MobileHSDashboard from '@/pages/mobile/MobileHSDashboard'

export const routes = [
  { path: 'overview', shell: 'office', element: <Dashboard /> },
  { path: 'dashboards', shell: 'office', element: <Dashboards /> },
  { path: 'hs-dashboard', shell: 'office', element: <HSDashboard /> },
  { path: 'cash-dashboard', shell: 'office', element: <CashDashboard /> },
  { path: 'hs-dashboard', shell: 'mobile', element: <MobileHSDashboard /> },
]
