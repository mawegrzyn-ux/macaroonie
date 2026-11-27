// admin/src/routes/recipes.jsx: the Recipes area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import { lazy, Suspense } from 'react'

// Recipes (inventory phase 1): loaded on demand, kept out of the main bundle.
const Recipes = lazy(() => import('@/pages/Recipes'))
// Menu margins (inventory phase 2), on demand too.
const MenuMargins = lazy(() => import('@/pages/MenuMargins'))
const Loading = () => <div className="p-6 text-sm text-muted-foreground">Loading...</div>

export const routes = [
  { path: 'recipes', shell: 'office', element: <Suspense fallback={<Loading />}><Recipes /></Suspense> },
  { path: 'menu-margins', shell: 'office', element: <Suspense fallback={<Loading />}><MenuMargins /></Suspense> },
]
