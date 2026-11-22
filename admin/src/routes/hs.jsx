// admin/src/routes/hs.jsx: the Health & safety area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import FoodSafety from '@/pages/FoodSafety'
import Checklists from '@/pages/Checklists'
import HSActionLog from '@/pages/HSActionLog'
import LegacyImport from '@/pages/LegacyImport'

export const routes = [
  { path: 'food-safety', shell: 'office', element: <FoodSafety /> },
  { path: 'checklists', shell: 'office', element: <Checklists /> },
  { path: 'hs-action-log', shell: 'office', element: <HSActionLog /> },
  { path: 'legacy-import', shell: 'office', element: <LegacyImport /> },
]
