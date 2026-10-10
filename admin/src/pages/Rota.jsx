// src/pages/Rota.jsx
//
// Weekly rota (/rota, `rota` module): staff as rows, days as columns.
// Day-parts mode = ON/OFF per shift; hourly mode = start/end periods.
// Below the grid: hours and pay per person (with overrides and "Fill Cash
// Recon wages") for people with `rota_pay`, and tips (pots, shares, moves)
// for people with `rota_tips`; each shows on its own. Components live in components/staff/rota.jsx and are shared
// with the Rota dashboard widgets.

import { CalendarRange, Wallet, Coins } from 'lucide-react'
import { useWeekNav } from '@/components/cashRecon/widgets'
import { useVenues, useVenueChoice, PageHeader, VenuePicker } from '@/components/staff/shared'
import { RotaGrid, RotaPayTable, RotaTipsTable, useRotaPerms } from '@/components/staff/rota'
import { PayHeader, TipsHeader } from '@/pages/RotaDashboard'

// Same card as the Rota dashboard's widgets: accent header bar with an
// icon, title and the week's total, white body.
function Panel({ icon: Icon, title, value, children }) {
  return (
    <section className="border rounded-xl bg-background shadow-sm overflow-hidden min-w-0">
      <div className="flex items-center gap-2 px-4 py-3 section-head">
        <span className="w-8 h-8 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </span>
        <h2 className="flex-1 min-w-0 text-sm font-semibold truncate">{title}</h2>
        {value}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export default function Rota() {
  const { data: venues = [] } = useVenues()
  const [venueId, setVenueId] = useVenueChoice(venues)
  const { ctx, element: weekNav } = useWeekNav()
  const { canEditRota, canSeePay, canEditPay, canSeeTips, canEditTips } = useRotaPerms()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={CalendarRange} title="Rota">
        <VenuePicker venues={venues} venueId={venueId} onChange={setVenueId} />
        {weekNav}
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        {venueId && (
          <div className="p-4 space-y-6">
            <Panel icon={CalendarRange} title="Rota">
              <RotaGrid venueId={venueId} weekStart={ctx.weekStart} canEdit={canEditRota} />
            </Panel>
            {(canSeePay || canSeeTips) && (
              <div className={canSeePay && canSeeTips ? 'grid gap-6 xl:grid-cols-2' : 'grid gap-6'}>
                {canSeePay && (
                  <Panel icon={Wallet} title="Hours and pay" value={<PayHeader venueId={venueId} ctx={ctx} />}>
                    <RotaPayTable venueId={venueId} weekStart={ctx.weekStart} canEdit={canEditPay} />
                  </Panel>
                )}
                {canSeeTips && (
                  <Panel icon={Coins} title="Tips" value={<TipsHeader venueId={venueId} ctx={ctx} />}>
                    <RotaTipsTable venueId={venueId} weekStart={ctx.weekStart} canEdit={canEditTips} />
                  </Panel>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
