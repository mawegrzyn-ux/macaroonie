// src/pages/CashDashboard.jsx
//
// Cash Recon Dashboard (/cash-dashboard). Named dashboards per venue, each
// a layout of widgets: days of the week, day and week balances, the editable
// reconciliation grid, wages paid, petty cash, and (since migration 152)
// any other widget too, H&S, menus or rota.
//
// Runs on the same DashboardPage engine as the H&S Dashboard (tabs, edit
// layout, row-spanning grid, full screen), pointed at /api/cash-dashboards
// (hs_dashboards rows with kind = 'cash', migration 101). Cash widgets read
// the week and a selected day from the shared navigator, which the day
// tiles widget sets; see components/cashRecon/widgets.jsx.

import { Wallet } from 'lucide-react'
import { DashboardPage } from '@/pages/HSDashboard'

export const CASH_DASHBOARD_CONFIG = {
  apiBase:      '/cash-dashboards',
  keyPrefix:    'cash',
  title:        'Cash Dashboard',
  icon:         Wallet,
  primaryGroup: 'cash',
  defaultNav:   'week',
  // Same rule as the Cash Recon page: always show the venue picker.
  alwaysShowVenuePicker: true,
  emptyText:   'No cash dashboards yet. Create one to lay out the week grid, balances, wages and petty cash.',
  emptyWidgetsText: 'No widgets on this dashboard yet. Add the reconciliation grid, a balance, the days of the week, or any other widget.',
}

export default function CashDashboard() {
  return <DashboardPage config={CASH_DASHBOARD_CONFIG} />
}
