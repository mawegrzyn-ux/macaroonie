// src/pages/RotaDashboard.jsx
//
// Rota Dashboard (/rota-dashboard, `rota_dashboard` module). Same
// DashboardPage engine as the H&S and Cash dashboards, pointed at
// /api/rota-dashboards (hs_dashboards rows with kind = 'rota', migration
// 106). Rota widgets (components/staff/rotaWidgets.jsx) read the week and a
// selected day (tap a day heading on the rota grid widget); since migration
// 152 the dashboard can hold any other widget too.

import { CalendarDays } from 'lucide-react'
import { DashboardPage } from '@/pages/HSDashboard'

export const ROTA_DASHBOARD_CONFIG = {
  apiBase:      '/rota-dashboards',
  keyPrefix:    'rota',
  moduleKey:    'rota_dashboard',
  title:        'Rota Dashboard',
  icon:         CalendarDays,
  primaryGroup: 'rota',
  defaultNav:   'week',
  alwaysShowVenuePicker: true,
  emptyText:    "No rota dashboards yet. Create one to lay out the rota, who's on, pay and tips.",
  emptyWidgetsText: "No widgets on this dashboard yet. Add the rota grid, who's on, pay, tips, or any other widget.",
}

export default function RotaDashboard() {
  return <DashboardPage config={ROTA_DASHBOARD_CONFIG} />
}
