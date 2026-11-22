// admin/src/routes/reports.jsx: the Reports area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import React from 'react'
import { LoadingPage } from './lib/LoadingPage'
// Reports: opened by some roles only, so kept out of the main bundle too.
const Reports = React.lazy(() => import('@/pages/Reports'))
const ReportBuilder = React.lazy(() => import('@/pages/ReportBuilder'))
const ReportRuns = React.lazy(() => import('@/pages/ReportRuns'))
const ReportSchedules = React.lazy(() => import('@/pages/ReportSchedules'))
const ReportLayouts = React.lazy(() => import('@/pages/ReportLayouts'))
const ReportPageEditor = React.lazy(() => import('@/pages/ReportPageEditor'))
const ReportView = React.lazy(() => import('@/pages/ReportView'))
const MobileReportList = React.lazy(() => import('@/pages/mobile/MobileReports').then(m => ({ default: m.MobileReportList })))
const MobileReport = React.lazy(() => import('@/pages/mobile/MobileReports').then(m => ({ default: m.MobileReport })))

export const routes = [
  { path: 'reports', shell: 'office', element: <React.Suspense fallback={<LoadingPage />}><Reports /></React.Suspense> },
  { path: 'reports/new', shell: 'office', element: <React.Suspense fallback={<LoadingPage />}><ReportBuilder /></React.Suspense> },
  { path: 'reports/runs', shell: 'office', element: <React.Suspense fallback={<LoadingPage />}><ReportRuns /></React.Suspense> },
  { path: 'reports/schedules', shell: 'office', element: <React.Suspense fallback={<LoadingPage />}><ReportSchedules /></React.Suspense> },
  { path: 'reports/layouts', shell: 'office', element: <React.Suspense fallback={<LoadingPage />}><ReportLayouts /></React.Suspense> },
  { path: 'reports/new-page', shell: 'office', element: <React.Suspense fallback={<LoadingPage />}><ReportPageEditor /></React.Suspense> },
  { path: 'reports/:id/page', shell: 'office', element: <React.Suspense fallback={<LoadingPage />}><ReportPageEditor /></React.Suspense> },
  { path: 'reports/:id', shell: 'office', element: <React.Suspense fallback={<LoadingPage />}><ReportView /></React.Suspense> },
  { path: 'reports/:id/edit', shell: 'office', element: <React.Suspense fallback={<LoadingPage />}><ReportBuilder /></React.Suspense> },
  { path: 'reports', shell: 'mobile', element: <React.Suspense fallback={<LoadingPage />}><MobileReportList /></React.Suspense> },
  { path: 'reports/:ref', shell: 'mobile', element: <React.Suspense fallback={<LoadingPage />}><MobileReport /></React.Suspense> },
]
