// src/pages/Dashboards.jsx
//
// Dashboards (/dashboards, `custom_dashboard` core module, migration 152):
// blank dashboards per venue that start empty and take any widget, H&S,
// menus, cash or rota, mixed on one page. Same DashboardPage engine as the
// H&S, Cash and Rota dashboards, pointed at /api/custom-dashboards
// (hs_dashboards rows with kind = 'custom'). Each widget still needs view on
// its own module (components/dashboards/widgetTypes.jsx).

import { LayoutTemplate } from 'lucide-react'
import { DashboardPage } from '@/pages/HSDashboard'

export const CUSTOM_DASHBOARD_CONFIG = {
  apiBase:      '/custom-dashboards',
  keyPrefix:    'custom',
  moduleKey:    'custom_dashboard',
  title:        'Dashboards',
  icon:         LayoutTemplate,
  primaryGroup: null,
  defaultNav:   'day',
  alwaysShowVenuePicker: false,
  emptyText:   'No dashboards yet. Create a blank one, then add any widgets you like: checklists, temperature checks, cash, rota, allergens.',
  emptyWidgetsText: 'This dashboard is blank. Add widgets from any area: H&S, menus, cash or rota.',
}

export default function Dashboards() {
  return <DashboardPage config={CUSTOM_DASHBOARD_CONFIG} />
}
