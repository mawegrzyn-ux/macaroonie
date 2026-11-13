// src/components/reports/FromReport.jsx
//
// The way back to a report from a record it opened (docs/REPORTS.md 8). A
// report's row opens the check, order, booking, customer or dish on its own
// page; this bar sits above that page and goes back to the report as it was
// left: its choices, the rows opened up, where it was scrolled to (the
// report's history entry keeps them: ReportView's openRecord()).
//
// It shows on the history entry the report opened (location.state.fromReport)
// and goes with it: a page the record's page or the menu opens next has no
// such state, so the bar isn't there. Back goes back through the history to
// the report's own entry when it can, so the browser's Back and Forward still
// make sense afterwards; else (no history index, a reloaded tab that lost
// it) it opens the report again with the visit it was left with.

import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, BarChart3 } from 'lucide-react'

export default function FromReport() {
  const location = useLocation()
  const navigate = useNavigate()
  const from = location.state?.fromReport
  if (!from || typeof from.path !== 'string' || !from.path.startsWith('/reports/')) return null

  const back = () => {
    const here = window.history.state?.idx
    const steps = typeof here === 'number' && typeof from.idx === 'number' ? here - from.idx : 0
    if (steps > 0) navigate(-steps)
    else navigate(from.path, { state: from.visit ? { visit: from.visit } : null })
  }

  return (
    <div className="shrink-0 border-b bg-background px-4 max-lg:notouch:pl-14 flex items-center gap-2 min-h-[48px]" data-testid="from-report">
      <button type="button" onClick={back} data-testid="from-report-back"
        className="inline-flex items-center gap-2 min-h-[48px] min-w-[48px] px-3 -ml-3 max-lg:notouch:ml-0 rounded-lg text-sm font-medium touch-manipulation hover:bg-muted max-w-full">
        <ChevronLeft className="w-4 h-4 shrink-0" />
        <BarChart3 className="w-4 h-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">Back to the report{from.name ? ': ' + from.name : ''}</span>
      </button>
    </div>
  )
}
