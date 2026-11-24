// admin/src/routes/cash.jsx: the Cash Recon area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import { lazy, Suspense } from 'react'
import CashRecon from '@/pages/CashRecon'
import MobileExpenses from '@/pages/mobile/MobileExpenses'
import MobileCashUp from '@/pages/mobile/MobileCashUp'
import MobileWages from '@/pages/mobile/MobileWages'

// Integrations (sales from other tills): loaded on demand, kept out of the main bundle.
const Integrations = lazy(() => import('@/pages/Integrations'))
const Loading = () => <div className="p-6 text-sm text-muted-foreground">Loading...</div>

export const routes = [
  { path: 'cash-recon', shell: 'office', element: <CashRecon /> },
  { path: 'integrations', shell: 'office', element: <Suspense fallback={<Loading />}><Integrations /></Suspense> },
  { path: 'expenses', shell: 'mobile', element: <MobileExpenses /> },
  { path: 'cash-up', shell: 'mobile', element: <MobileCashUp /> },
  { path: 'wages', shell: 'mobile', element: <MobileWages /> },
]
