// admin/src/routes/kiosk.jsx: the Kiosk area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import KioskAnalytics from '@/pages/KioskAnalytics'
import KioskDesigner from '@/pages/KioskDesigner'

export const routes = [
  { path: 'pos/kiosk-analytics', shell: 'office', element: <KioskAnalytics /> },
  { path: 'pos/kiosk-designs/:id', shell: 'office', element: <KioskDesigner /> },
]
