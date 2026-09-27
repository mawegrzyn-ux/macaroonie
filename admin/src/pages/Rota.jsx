// src/pages/Rota.jsx
//
// Weekly rota (/rota, `rota` module): staff as rows, days as columns.
// Day-parts mode = ON/OFF per shift; hourly mode = start/end periods.
// Below the grid, for people with `rota_pay`: hours and pay per person
// (with overrides and "Fill Cash Recon wages") and the tip pot split by
// points. Components live in components/staff/rota.jsx and are shared
// with the Rota dashboard widgets.

import { CalendarRange } from 'lucide-react'
import { useWeekNav } from '@/components/cashRecon/widgets'
import { useVenues, useVenueChoice, PageHeader, VenuePicker } from '@/components/staff/shared'
import { RotaGrid, RotaPayTable, RotaTipsTable, useRotaPerms } from '@/components/staff/rota'

export default function Rota() {
  const { data: venues = [] } = useVenues()
  const [venueId, setVenueId] = useVenueChoice(venues)
  const { ctx, element: weekNav } = useWeekNav()
  const { canEditRota, canSeePay, canEditPay } = useRotaPerms()

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
            {canSeePay && (
              <div className="grid gap-6 xl:grid-cols-2">
                <section className="space-y-2 min-w-0">
                  <h2 className="text-sm font-semibold">Hours and pay</h2>
                  <RotaPayTable venueId={venueId} weekStart={ctx.weekStart} canEdit={canEditPay} />
                </section>
                <section className="space-y-2 min-w-0">
                  <h2 className="text-sm font-semibold">Tips by points</h2>
                  <RotaTipsTable venueId={venueId} weekStart={ctx.weekStart} canEdit={canEditPay} />
                </section>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
