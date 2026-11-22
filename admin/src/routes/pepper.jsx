// admin/src/routes/pepper.jsx: the Pepper area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import ConnectAi from '@/pages/ConnectAi'
import NewLocation from '@/pages/NewLocation'
import AiAssistant from '@/pages/AiAssistant'
import MobileAssistant from '@/pages/mobile/MobileAssistant'

export const routes = [
  // An AI app's connector sign-in (migration 181): its own page, no app shell.
  { path: 'connect-ai', shell: 'bare', element: <ConnectAi /> },
  { path: 'new-location', shell: 'office', element: <NewLocation /> },
  { path: 'new-location/:id', shell: 'office', element: <NewLocation /> },
  { path: 'ai', shell: 'office', element: <AiAssistant /> },
  { path: 'assistant', shell: 'mobile', element: <MobileAssistant /> },
]
