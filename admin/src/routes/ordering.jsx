// admin/src/routes/ordering.jsx: the Online ordering area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import Orders from '@/pages/Orders'
import OrderingSettings from '@/pages/OrderingSettings'
import Promotions from '@/pages/Promotions'
import MobileOrders from '@/pages/mobile/MobileOrders'

export const routes = [
  { path: 'orders', shell: 'office', element: <Orders /> },
  { path: 'orders/settings', shell: 'office', element: <OrderingSettings /> },
  { path: 'promotions', shell: 'office', element: <Promotions /> },
  { path: 'orders', shell: 'mobile', element: <MobileOrders /> },
]
