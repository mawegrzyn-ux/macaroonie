// src/pages/RotaDashboard.jsx
//
// Rota Dashboard (/rota-dashboard, `rota_dashboard` module). Same
// DashboardPage engine as the H&S and Cash dashboards, pointed at
// /api/rota-dashboards (hs_dashboards rows with kind = 'rota', migration
// 106). Week navigator plus a selected day (tap a day heading on the rota
// grid widget). Widgets reuse components/staff/rota.jsx unchanged.

import { CalendarRange, CalendarDays, Wallet, Coins, Users } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { DashboardPage } from '@/pages/HSDashboard'
import { useWeekNav } from '@/components/cashRecon/widgets'
import { isoWeekDates, fmt } from '@/pages/CashRecon'
import { cn } from '@/lib/utils'
import {
  RotaGrid, RotaDayList, RotaPayTable, RotaTipsTable, useRotaPerms, useRotaPay,
} from '@/components/staff/rota'

function PayHeader({ venueId, ctx }) {
  const { canSeePay } = useRotaPerms()
  const { data } = useRotaPay(venueId, ctx.weekStart, canSeePay)
  if (!data) return null
  return <span className="text-sm font-semibold tabular-nums">{fmt(data.totals.pay)}</span>
}

function TipsHeader({ venueId, ctx }) {
  const { canSeePay } = useRotaPerms()
  const { data } = useRotaPay(venueId, ctx.weekStart, canSeePay)
  if (!data) return null
  return <span className="text-sm font-semibold tabular-nums">{fmt(data.tip_pot.value)}</span>
}

export const ROTA_WIDGET_TYPES = [
  { key: 'rota_grid',     label: 'Rota grid',       icon: CalendarRange, defaultTitle: 'Rota' },
  { key: 'rota_today',    label: "Who's on",        icon: Users,         defaultTitle: "Who's on" },
  { key: 'rota_week_pay', label: 'Hours and pay',   icon: Wallet,        defaultTitle: 'Hours and pay', HeaderValue: PayHeader },
  { key: 'rota_tips',     label: 'Tips by points',  icon: Coins,         defaultTitle: 'Tips', HeaderValue: TipsHeader },
]

function DayChips({ ctx }) {
  return (
    <div className="flex flex-wrap gap-1 mb-3">
      {isoWeekDates(ctx.weekStart).map(d => (
        <button key={d} type="button" onClick={() => ctx.setSelectedDay(d)}
          className={cn('h-10 min-w-[44px] px-2 rounded-lg border text-xs font-medium touch-manipulation',
            d === ctx.selectedDay ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
          {format(parseISO(d), 'EEE d')}
        </button>
      ))}
    </div>
  )
}

function PayGate({ children }) {
  const { canSeePay } = useRotaPerms()
  if (!canSeePay) return <p className="text-sm text-muted-foreground py-4 text-center">You don't have access to rota pay.</p>
  return children
}

function RotaWidget({ widget, venueId, ctx }) {
  const { canEditRota, canEditPay } = useRotaPerms()
  switch (widget.widget_type) {
    case 'rota_grid':
      return <RotaGrid venueId={venueId} weekStart={ctx.weekStart} canEdit={canEditRota} dense
        selectedDay={ctx.selectedDay} onSelectDay={ctx.setSelectedDay} />
    case 'rota_today':
      return <><DayChips ctx={ctx} /><RotaDayList venueId={venueId} weekStart={ctx.weekStart} day={ctx.selectedDay} /></>
    case 'rota_week_pay':
      return <PayGate><RotaPayTable venueId={venueId} weekStart={ctx.weekStart} canEdit={canEditPay} /></PayGate>
    case 'rota_tips':
      return <PayGate><RotaTipsTable venueId={venueId} weekStart={ctx.weekStart} canEdit={canEditPay} /></PayGate>
    default:
      return null
  }
}

export function renderRotaWidget(props) {
  return <RotaWidget {...props} />
}

export const ROTA_DASHBOARD_CONFIG = {
  apiBase:      '/rota-dashboards',
  keyPrefix:    'rota',
  title:        'Rota Dashboard',
  icon:         CalendarDays,
  widgetTypes:  ROTA_WIDGET_TYPES,
  useNav:       useWeekNav,
  renderWidget: renderRotaWidget,
  alwaysShowVenuePicker: true,
  emptyText:    "No rota dashboards yet. Create one to lay out the rota, who's on, pay and tips.",
  emptyWidgetsText: "No widgets on this dashboard yet. Add the rota grid, who's on, pay or tips.",
}

export default function RotaDashboard() {
  return <DashboardPage config={ROTA_DASHBOARD_CONFIG} />
}
