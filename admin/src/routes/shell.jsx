// admin/src/routes/shell.jsx: the Shell area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import React from 'react'
import { Navigate } from 'react-router-dom'
import Home from '@/pages/Home'
import Settings from '@/pages/Settings'
import NavDesigner from '@/pages/NavDesigner'
import Launcher from '@/pages/Launcher'
import MobileHub from '@/pages/mobile/MobileHub'
import MobileToday from '@/pages/mobile/MobileToday'
import MobileNotices from '@/pages/mobile/MobileNotices'
import { LoadingPage } from './lib/LoadingPage'
// The Docs and Help pages are 1.5 MB of text few people open: their own
// chunks, loaded when opened, so the main bundle stays under the service
// worker's precache limit (vite.config.js maximumFileSizeToCacheInBytes).
const Docs = React.lazy(() => import('@/pages/Docs'))
const Help = React.lazy(() => import('@/pages/Help'))

export const routes = [
  // Home (Pepper-first step 2b): / for everyone. Today was its own page until
  // then: its address (saved links, old notices) goes to Home.
  { index: true, shell: 'office', element: <Home /> },
  { path: 'today', shell: 'office', element: <Navigate to="/" replace /> },
  { path: 'docs', shell: 'office', element: <React.Suspense fallback={<LoadingPage />}><Docs /></React.Suspense> },
  { path: 'help', shell: 'office', element: <React.Suspense fallback={<LoadingPage />}><Help /></React.Suspense> },
  { path: 'settings', shell: 'office', element: <Settings /> },
  { path: 'nav-designer', shell: 'office', element: <NavDesigner /> },
  { path: 'launcher', shell: 'office', element: <Launcher /> },
  { index: true, shell: 'mobile', element: <MobileHub /> },
  { path: 'today', shell: 'mobile', element: <MobileToday /> },
  { path: 'notices', shell: 'mobile', element: <MobileNotices /> },
]
