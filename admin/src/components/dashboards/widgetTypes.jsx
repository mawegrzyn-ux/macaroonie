// src/components/dashboards/widgetTypes.jsx
//
// The one widget catalog for every dashboard (migration 152): the H&S, Cash
// and Rota dashboards and the blank ones on the Dashboards page all offer
// every type here, desktop and phone. Keep it in step with WIDGET_MODULE in
// api/src/routes/hsDashboards.js and the hs_dashboard_widgets.widget_type
// CHECK.
//
// Each type adds to its own definition (CASH_WIDGET_TYPES in
// cashRecon/widgets.jsx, ROTA_WIDGET_TYPES in staff/rotaWidgets.jsx, the H&S
// and Menus ones below):
//   group   which heading it sits under in Add widget (WIDGET_GROUPS)
//   module  the module whose data it shows; without view on it the widget
//           isn't offered and shows "no access" instead of its body
//   nav     'day' | 'week' | 'both' | null, what the shared navigator must
//           provide (components/dashboards/nav.jsx); cash widgets are 'week'
//           unless their CASH_WIDGET_TYPES entry says otherwise
// renderWidget() draws any type's body from { widget, venueId, ctx,
// template, onChecklistState }.

import {
  ListChecks, Thermometer, Truck, Flame, ChefHat, ClipboardCheck, Grid3x3,
} from 'lucide-react'
import { ChecklistRunPanel } from '@/components/checklists/shared'
import {
  TempChecksTable, DeliveryChecksPanel, HoldChecksTable, CookingChecksPanel,
} from '@/components/foodSafety/shared'
import { HSActionLogPanel } from '@/components/hsActionLog/shared'
import { AllergenLookup } from '@/components/menus/AllergenMatrix'
import { CASH_WIDGET_TYPES, renderCashWidget } from '@/components/cashRecon/widgets'
import { ROTA_WIDGET_TYPES, renderRotaWidget } from '@/components/staff/rotaWidgets'

export const WIDGET_GROUPS = [
  { key: 'hs',    label: 'Health & safety' },
  { key: 'menus', label: 'Menus' },
  { key: 'cash',  label: 'Cash' },
  { key: 'rota',  label: 'Rota' },
]

const HS_TYPES = [
  { key: 'checklist',       label: 'Checklist',               icon: ListChecks,     defaultTitle: 'Checklist', needsChecklist: true, module: 'checklists',    nav: 'day' },
  { key: 'temp_checks',     label: 'Temperature checks',      icon: Thermometer,    defaultTitle: 'Temperature checks',      module: 'food_safety',   nav: 'day' },
  { key: 'delivery_checks', label: 'Delivery checks',         icon: Truck,          defaultTitle: 'Delivery checks',         module: 'food_safety',   nav: 'day' },
  { key: 'hold_checks',     label: 'Hot / cold hold checks',  icon: Flame,          defaultTitle: 'Hot / cold hold checks',  module: 'food_safety',   nav: 'day' },
  { key: 'cooking_checks',  label: 'Cooking / reheat checks', icon: ChefHat,        defaultTitle: 'Cooking / reheat checks', module: 'food_safety',   nav: 'day' },
  { key: 'action_log',      label: 'Action log',              icon: ClipboardCheck, defaultTitle: 'Action log',              module: 'hs_action_log', nav: null },
].map(t => ({ ...t, group: 'hs' }))

const MENU_TYPES = [
  { key: 'allergen_lookup', label: 'Allergen lookup', icon: Grid3x3, defaultTitle: 'Allergen lookup', module: 'menus', nav: null, group: 'menus' },
]

const ROTA_MODULE = { rota_grid: 'rota', rota_today: 'rota', rota_week_pay: 'rota_pay', rota_tips: 'rota_tips' }

export const WIDGET_TYPES = [
  ...HS_TYPES,
  ...MENU_TYPES,
  ...CASH_WIDGET_TYPES.map(t => ({
    ...t, group: 'cash', nav: t.nav ?? 'week',
    module: t.key === 'cash_tips_payout' ? 'rota_tips' : 'cash_recon',
  })),
  ...ROTA_WIDGET_TYPES.map(t => ({ ...t, group: 'rota', nav: 'week', module: ROTA_MODULE[t.key] })),
]

export const WIDGET_TYPE_BY_KEY = Object.fromEntries(WIDGET_TYPES.map(w => [w.key, w]))

/** Whether the person (from /me) can see this widget type's data. */
export function canUseWidget(meta, me) {
  if (!meta) return false
  if (me?.is_platform_admin) return true
  const level = me?.permissions?.[meta.module]
  return level === 'view' || level === 'manage'
}

/** True when the widgets include an H&S check that follows the selected day. */
export function hasHsDayWidget(widgets) {
  return widgets.some(w => {
    const meta = WIDGET_TYPE_BY_KEY[w.widget_type]
    return meta?.group === 'hs' && meta.nav === 'day'
  })
}

function renderHsWidget({ widget, venueId, ctx, template, onChecklistState }) {
  const { date } = ctx
  switch (widget.widget_type) {
    case 'checklist':       return <ChecklistRunPanel template={template} date={date} hideHeader onStateChange={onChecklistState} />
    case 'temp_checks':     return <TempChecksTable venueId={venueId} date={date} />
    case 'delivery_checks': return <DeliveryChecksPanel venueId={venueId} date={date} />
    case 'hold_checks':     return <HoldChecksTable venueId={venueId} date={date} />
    case 'cooking_checks':  return <CookingChecksPanel venueId={venueId} date={date} />
    case 'action_log':      return <HSActionLogPanel venueId={venueId} />
    case 'allergen_lookup': return <AllergenLookup storeKey={`maca_allergen_lookup_${widget.id}`} />
    default:                return null
  }
}

export function renderWidget(props) {
  const meta = WIDGET_TYPE_BY_KEY[props.widget.widget_type]
  if (!meta) return null
  if (meta.group === 'cash') return renderCashWidget(props)
  if (meta.group === 'rota') return renderRotaWidget(props)
  return renderHsWidget(props)
}

// Same wording as MODULE_LABEL in hsDashboards.js (the 403 on adding one).
export const MODULE_LABEL = {
  checklists: 'Checklists', food_safety: 'Food safety', hs_action_log: 'the H&S Action Log',
  menus: 'Menus', cash_recon: 'Cash reconciliation', rota: 'the Rota',
  rota_pay: 'Rota pay', rota_tips: 'Rota tips',
}

/** Shown in place of a widget's body when the viewer lacks its module. */
export function NoAccess({ meta }) {
  return (
    <p className="text-sm text-muted-foreground py-6 text-center">
      You don't have access to {MODULE_LABEL[meta?.module] ?? 'this'}, so this widget is hidden for you.
    </p>
  )
}
