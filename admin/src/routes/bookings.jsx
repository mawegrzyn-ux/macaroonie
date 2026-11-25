// admin/src/routes/bookings.jsx: the Bookings area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import Timeline from '@/pages/Timeline'
import Bookings from '@/pages/Bookings'
import Customers from '@/pages/Customers'
import Tables from '@/pages/Tables'
import Schedule from '@/pages/Schedule'
import Rules from '@/pages/Rules'
import EmailTemplates from '@/pages/EmailTemplates'
import EmailMonitoring from '@/pages/EmailMonitoring'
import WidgetTest from '@/pages/WidgetTest'
import TestData from '@/pages/TestData'
import MobileTimeline from '@/pages/mobile/MobileTimeline'

export const routes = [
  { path: 'timeline', shell: 'office', element: <Timeline /> },
  { path: 'bookings', shell: 'office', element: <Bookings /> },
  { path: 'customers', shell: 'office', element: <Customers /> },
  { path: 'tables', shell: 'office', element: <Tables /> },
  { path: 'schedule', shell: 'office', element: <Schedule /> },
  { path: 'rules', shell: 'office', element: <Rules /> },
  { path: 'email-templates', shell: 'office', element: <EmailTemplates /> },
  { path: 'email-monitoring', shell: 'office', element: <EmailMonitoring /> },
  { path: 'widget-test', shell: 'office', element: <WidgetTest /> },
  { path: 'test-data', shell: 'office', element: <TestData /> },
  { path: 'timeline', shell: 'mobile', element: <MobileTimeline /> },
]
