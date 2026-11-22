// admin/src/routes/purchasing.jsx: the Purchasing area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import Purchasing from '@/pages/Purchasing'
import OrderLists from '@/pages/OrderLists'
import Inventory from '@/pages/Inventory'
import Suppliers from '@/pages/Suppliers'
import MobilePurchasing from '@/pages/mobile/MobilePurchasing'

export const routes = [
  { path: 'purchasing', shell: 'office', element: <Purchasing /> },
  { path: 'purchasing/lists', shell: 'office', element: <OrderLists /> },
  { path: 'inventory', shell: 'office', element: <Inventory /> },
  { path: 'suppliers', shell: 'office', element: <Suppliers /> },
  { path: 'purchasing', shell: 'mobile', element: <MobilePurchasing /> },
]
