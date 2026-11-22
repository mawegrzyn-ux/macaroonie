// admin/src/routes/cash.jsx: the Cash Recon area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import CashRecon from '@/pages/CashRecon'
import MobileExpenses from '@/pages/mobile/MobileExpenses'
import MobileCashUp from '@/pages/mobile/MobileCashUp'
import MobileWages from '@/pages/mobile/MobileWages'

export const routes = [
  { path: 'cash-recon', shell: 'office', element: <CashRecon /> },
  { path: 'expenses', shell: 'mobile', element: <MobileExpenses /> },
  { path: 'cash-up', shell: 'mobile', element: <MobileCashUp /> },
  { path: 'wages', shell: 'mobile', element: <MobileWages /> },
]
