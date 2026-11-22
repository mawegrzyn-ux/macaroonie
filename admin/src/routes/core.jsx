// admin/src/routes/core.jsx: the Core area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import Venues from '@/pages/Venues'
import Team from '@/pages/Team'
import Access from '@/pages/Access'
import Platform from '@/pages/Platform'
import Backlog from '@/pages/Backlog'
import IssueLog from '@/pages/IssueLog'
import FeatureRequests from '@/pages/FeatureRequests'
import Changelog from '@/pages/Changelog'

export const routes = [
  { path: 'venues', shell: 'office', element: <Venues /> },
  { path: 'team', shell: 'office', element: <Team /> },
  { path: 'access', shell: 'office', element: <Access /> },
  { path: 'platform', shell: 'office', element: <Platform /> },
  { path: 'backlog', shell: 'office', element: <Backlog /> },
  { path: 'issues', shell: 'office', element: <IssueLog /> },
  { path: 'feature-requests', shell: 'office', element: <FeatureRequests /> },
  { path: 'changelog', shell: 'office', element: <Changelog /> },
]
