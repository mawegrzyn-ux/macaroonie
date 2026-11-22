// admin/src/routes/screens.jsx: the Menu screens area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import Screens from '@/pages/Screens'
import ScreenDesigner from '@/pages/ScreenDesigner'

export const routes = [
  { path: 'screens', shell: 'office', element: <Screens page="screens" /> },
  { path: 'screens/boards', shell: 'office', element: <Screens page="boards" /> },
  { path: 'screens/playlists', shell: 'office', element: <Screens page="playlists" /> },
  { path: 'screens/walls', shell: 'office', element: <Screens page="walls" /> },
  { path: 'screens/boards/:id', shell: 'office', element: <ScreenDesigner /> },
]
