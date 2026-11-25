// admin/src/routes/rota.jsx: the Staff & rota area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import Staff from '@/pages/Staff'
import StaffRoles from '@/pages/StaffRoles'
import Rota from '@/pages/Rota'
import RotaSetup from '@/pages/RotaSetup'
import RotaDashboard from '@/pages/RotaDashboard'
import MobileRota from '@/pages/mobile/MobileRota'

export const routes = [
  { path: 'staff', shell: 'office', element: <Staff /> },
  { path: 'staff/roles', shell: 'office', element: <StaffRoles /> },
  { path: 'rota', shell: 'office', element: <Rota /> },
  { path: 'rota/setup', shell: 'office', element: <RotaSetup /> },
  { path: 'rota-dashboard', shell: 'office', element: <RotaDashboard /> },
  { path: 'rota', shell: 'mobile', element: <MobileRota /> },
]
