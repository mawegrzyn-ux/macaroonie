// src/pages/Rota.jsx
//
// Weekly rota (/rota, `rota` module): staff as rows, days as columns.
// Day-parts mode = ON/OFF per shift; hourly mode = start/end periods.
// Below the grid: hours and pay per person (with overrides and "Fill Cash
// Recon wages") for people with `rota_pay`, and tips (pots, shares, moves)
// for people with `rota_tips`; each shows on its own. Components live in components/staff/rota.jsx and are shared
// with the Rota dashboard widgets.

import { CalendarRange } from 'lucide-react'
import { useWeekNav } from '@/components/cashRecon/widgets'
import { useVenues, useVenueChoice, PageHeader, VenuePicker } from '@/components/staff/shared'
import { RotaGrid, RotaPayTable, RotaTipsTable, useRotaPerms } from '@/components/staff/rota'

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
            <RotaGrid venueId={venueId} weekStart={ctx.weekStart} canEdit={canEditRota} />
            {(canSeePay || canSeeTips) && (
              <div className={canSeePay && canSeeTips ? 'grid gap-6 xl:grid-cols-2' : 'grid gap-6'}>
                {canSeePay && (
                  <section className="space-y-2 min-w-0">
                    <h2 className="text-sm font-semibold">Hours and pay</h2>
                    <RotaPayTable venueId={venueId} weekStart={ctx.weekStart} canEdit={canEditPay} />
                  </section>
                )}
                {canSeeTips && (
                  <section className="space-y-2 min-w-0">
                    <h2 className="text-sm font-semibold">Tips</h2>
                    <RotaTipsTable venueId={venueId} weekStart={ctx.weekStart} canEdit={canEditTips} />
                  </section>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
