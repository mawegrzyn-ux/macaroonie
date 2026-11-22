// admin/src/routes/website.jsx: the Website area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import Website from '@/pages/Website'
import Brand from '@/pages/Brand'
import ReservationsWidget from '@/pages/ReservationsWidget'
import Media from '@/pages/Media'
import Reviews from '@/pages/Reviews'

export const routes = [
  // One component, two pages: the keys keep one page's open section out of the other
  { path: 'website', shell: 'office', element: <Website key="settings" /> },
  { path: 'website/builder', shell: 'office', element: <Website key="builder" builder /> },
  { path: 'brand', shell: 'office', element: <Brand /> },
  { path: 'website/reservations-widget', shell: 'office', element: <ReservationsWidget /> },
  { path: 'media', shell: 'office', element: <Media /> },
  { path: 'reviews', shell: 'office', element: <Reviews /> },
]
