// admin/src/routes/loyalty.jsx: the Loyalty area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import Loyalty from '@/pages/Loyalty'

export const routes = [
  { path: 'loyalty', shell: 'office', element: <Loyalty /> },
]
