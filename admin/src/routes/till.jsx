// admin/src/routes/till.jsx: the Till (Store tech) area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import InstallerHome from '@/pages/installer/InstallerHome'
import InstallerLink from '@/pages/installer/InstallerLink'
import InstallerAdd from '@/pages/installer/InstallerAdd'
import InstallerDevice from '@/pages/installer/InstallerDevice'
import PosSetup from '@/pages/PosSetup'
import PosFloor from '@/pages/PosFloor'
import PosReports from '@/pages/PosReports'
import TillLayoutDesigner from '@/pages/TillLayoutDesigner'
import OrderFlowDesigner from '@/pages/OrderFlowDesigner'

export const routes = [
  { index: true, shell: 'installer', element: <InstallerHome /> },
  { path: 'link', shell: 'installer', element: <InstallerLink /> },
  { path: 'link/:code', shell: 'installer', element: <InstallerLink /> },
  { path: 'add', shell: 'installer', element: <InstallerAdd /> },
  { path: 'device/:kind/:id', shell: 'installer', element: <InstallerDevice /> },
  { path: 'pos', shell: 'office', element: <PosSetup /> },
  { path: 'pos/:tab', shell: 'office', element: <PosSetup /> },
  { path: 'pos/floor', shell: 'office', element: <PosFloor /> },
  { path: 'pos/reports', shell: 'office', element: <PosReports /> },
  { path: 'pos/layouts/:id', shell: 'office', element: <TillLayoutDesigner /> },
  { path: 'pos/flows/:id', shell: 'office', element: <OrderFlowDesigner /> },
]
