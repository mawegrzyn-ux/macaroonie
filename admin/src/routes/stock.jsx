// admin/src/routes/stock.jsx: the Stock area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import { lazy, Suspense } from 'react'

// Stock (inventory phase 4a): loaded on demand, kept out of the main bundle.
const Stock = lazy(() => import('@/pages/Stock'))
// Counting on the phone, on demand too.
const MobileStockCount = lazy(() => import('@/pages/mobile/MobileStockCount'))
const Loading = () => <div className="p-6 text-sm text-muted-foreground">Loading...</div>

export const routes = [
  { path: 'stock', shell: 'office', element: <Suspense fallback={<Loading />}><Stock /></Suspense> },
  { path: 'stock-count', shell: 'mobile', element: <Suspense fallback={<Loading />}><MobileStockCount /></Suspense> },
]
