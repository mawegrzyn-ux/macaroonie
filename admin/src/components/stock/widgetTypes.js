// src/components/stock/widgetTypes.js
//
// The stock and costing dashboard widgets (inventory phase 6b, migration 313;
// docs/INVENTORY.md 10.3), as the one widget catalog takes them
// (components/dashboards/widgetTypes.jsx adds them to WIDGET_TYPES). Only the
// names and icons live here, so the catalog stays light; the bodies are
// components/stock/widgets.jsx, loaded when a dashboard has one. Keep the keys
// and modules in step with WIDGET_MODULE in api/src/routes/hsDashboards.js and
// the hs_dashboard_widgets.widget_type CHECK.
//
//   stock_food_cost       food cost % actual and theoretical (Costing; the % needs Till reports too)
//   stock_waste_week      waste in the dashboard's week by reason (Stock; values need Costing)
//   stock_variance_items  the newest stock period's biggest unexplained items (Stock; pounds need Costing)
//   stock_menu_margins    the week's sold margins by menu (Costing; sales need Till reports)

import { Percent, Trash2, Scale, BadgePercent } from 'lucide-react'

export const STOCK_WIDGET_TYPES = [
  { key: 'stock_food_cost', label: 'Food cost % actual and theoretical', icon: Percent, defaultTitle: 'Food cost', module: 'costing', nav: 'week' },
  { key: 'stock_waste_week', label: 'Waste this week by reason', icon: Trash2, defaultTitle: 'Waste this week', module: 'stock', nav: 'week' },
  { key: 'stock_variance_items', label: 'Top variance items', icon: Scale, defaultTitle: 'Top variance items', module: 'stock', nav: null },
  { key: 'stock_menu_margins', label: 'Margin by menu', icon: BadgePercent, defaultTitle: 'Margin by menu', module: 'costing', nav: 'week' },
].map(t => ({ ...t, group: 'stock' }))
