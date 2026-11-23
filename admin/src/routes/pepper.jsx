// admin/src/routes/pepper.jsx: the Pepper area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import React from 'react'
import ConnectAi from '@/pages/ConnectAi'
import NewLocation from '@/pages/NewLocation'
import AiAssistant from '@/pages/AiAssistant'
import MobileAssistant from '@/pages/mobile/MobileAssistant'
// Done by Pepper (step 4e): loaded on demand, kept out of the main bundle.
const PepperDone = React.lazy(() => import('@/pages/PepperDone'))
// For review (step 5c): Waiting and Done by Pepper, loaded on demand.
const Review = React.lazy(() => import('@/pages/Review'))
const Loading = () => <div className="p-6 text-sm text-muted-foreground">Loading...</div>

export const routes = [
  // An AI app's connector sign-in (migration 181): its own page, no app shell.
  { path: 'connect-ai', shell: 'bare', element: <ConnectAi /> },
  { path: 'new-location', shell: 'office', element: <NewLocation /> },
  { path: 'new-location/:id', shell: 'office', element: <NewLocation /> },
  { path: 'ai', shell: 'office', element: <AiAssistant /> },
  { path: 'pepper/done', shell: 'office', element: <React.Suspense fallback={<Loading />}><PepperDone /></React.Suspense> },
  { path: 'review', shell: 'office', element: <React.Suspense fallback={<Loading />}><Review /></React.Suspense> },
  { path: 'assistant', shell: 'mobile', element: <MobileAssistant /> },
]
