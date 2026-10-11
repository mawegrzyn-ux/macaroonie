// src/pages/mobile/MobileHSDashboard.jsx
//
// Phone-portrait H&S Dashboard for the Ops app: MobileDashboardPage
// (MobileDashboard.jsx) pointed at the H&S dashboards. Since migration 152
// those can hold any widget, not only H&S ones.

import { MobileDashboardPage } from '@/pages/mobile/MobileDashboard'

export default function MobileHSDashboard() {
  return (
    <MobileDashboardPage
      apiBase="/hs-dashboards"
      keyPrefix="hs"
      emptyText="No dashboards yet. Set one up on the H&S Dashboard in the office admin."
      emptyWidgetsText="Nothing on this dashboard yet. Add checklists and checks to it on the H&S Dashboard in the office admin."
    />
  )
}
