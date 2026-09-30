// src/pages/FoodSafety.jsx
// SFBB food safety temperature & delivery logs (per venue). Recording only:
// fridges, hold stations, check times and cooking sessions are set up in
// H&S settings (components/hs/HsSetup.jsx).

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Thermometer, Truck, Flame, ChefHat } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { HsSettingsButton, ClosedDayNotice } from '@/components/hs/HsSettings'
import {
  TempChecksTable, DeliveryChecksBoard, HoldChecksTable, CookingChecksPanel, EndOfDayReview,
} from '@/components/foodSafety/shared'

const TABS = [
  { key: 'today',     label: 'Today',     icon: Thermometer },
  { key: 'deliveries',label: 'Deliveries',icon: Truck },
  { key: 'holds',     label: 'Holds',     icon: Flame },
  { key: 'cooking',   label: 'Cooking',   icon: ChefHat },
]

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// Shown where a check list is empty because nothing is set up yet.
function SetupPrompt({ text, venueId, section, label }) {
  return (
    <div className="border rounded-xl p-8 text-center">
      <p className="text-muted-foreground text-sm mb-3">{text}</p>
      <div className="flex justify-center">
        <HsSettingsButton venueId={venueId} section={section} label={label}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] touch-manipulation" />
      </div>
    </div>
  )
}

export default function FoodSafety() {
  const api = useApi()

  const [tab, setTab] = useState('today')
  const [venueId, setVenueId] = useState('')
  const [date, setDate] = useState(todayStr())

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn: () => api.get('/venues'),
  })

  useEffect(() => {
    if (!venueId && venues.length) setVenueId(venues[0].id)
  }, [venues, venueId])

  const enabled = !!venueId

  const { data: deliveries = [] } = useQuery({
    queryKey: ['fs-deliveries', venueId, date],
    queryFn: () => api.get(`/food-safety/deliveries?venue_id=${venueId}&date=${date}`),
    enabled,
  })

  const { data: holds = [] } = useQuery({
    queryKey: ['fs-holds', venueId, date],
    queryFn: () => api.get(`/food-safety/holds?venue_id=${venueId}&date=${date}`),
    enabled,
  })

  const { data: cooking = [] } = useQuery({
    queryKey: ['fs-cooking', venueId, date],
    queryFn: () => api.get(`/food-safety/cooking?venue_id=${venueId}&date=${date}`),
    enabled,
  })

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold">Food safety</h1>
          <div className="flex flex-wrap items-center gap-2">
            {venues.length > 1 && (
              <select value={venueId} onChange={e => setVenueId(e.target.value)}
                className="border rounded px-3 py-2 text-sm bg-background min-h-[44px]">
                {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )}
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="border rounded px-3 py-2 text-sm bg-background min-h-[44px]" />
            <HsSettingsButton venueId={venueId || null} />
          </div>
        </div>

        {venueId && <ClosedDayNotice venueId={venueId} date={date} className="mb-4" />}

        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex gap-1 overflow-x-auto pb-1">
            {TABS.map(t => {
              const Icon = t.icon
              return (
                <button key={t.key} type="button" onClick={() => setTab(t.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 min-h-[44px] rounded-md text-sm font-medium whitespace-nowrap transition-colors touch-manipulation',
                    tab === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                  )}>
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              )
            })}
          </div>
          {venueId && <EndOfDayReview venueId={venueId} date={date} />}
        </div>

        {!venueId ? (
          <p className="text-muted-foreground text-sm py-12 text-center">Select a venue to begin.</p>
        ) : tab === 'today' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Equipment temperatures — {format(new Date(date + 'T12:00:00'), 'd MMM yyyy')}</h2>
            </div>

            <TempChecksTable
              venueId={venueId}
              date={date}
              emptyState={<SetupPrompt venueId={venueId} section="equipment" label="Add fridges and freezers"
                text="No fridges or freezers yet. Add them in H&S settings." />}
            />

            <div className="grid sm:grid-cols-3 gap-3">
              <div className="border rounded-xl p-4">
                <p className="text-xs font-medium text-muted-foreground mb-1">Deliveries</p>
                <p className="text-2xl font-semibold">{deliveries.length}</p>
              </div>
              <div className="border rounded-xl p-4">
                <p className="text-xs font-medium text-muted-foreground mb-1">Hold checks</p>
                <p className="text-2xl font-semibold">{holds.length}</p>
              </div>
              <div className="border rounded-xl p-4">
                <p className="text-xs font-medium text-muted-foreground mb-1">Cooking checks</p>
                <p className="text-2xl font-semibold">{cooking.length}</p>
              </div>
            </div>
          </div>
        ) : tab === 'deliveries' ? (
          <div>
            <h2 className="font-semibold mb-4">Delivery checks</h2>
            <DeliveryChecksBoard venueId={venueId} date={date} />
          </div>
        ) : tab === 'holds' ? (
          <div>
            <h2 className="font-semibold mb-4">Hot / cold hold checks — {format(new Date(date + 'T12:00:00'), 'd MMM yyyy')}</h2>
            <HoldChecksTable
              venueId={venueId}
              date={date}
              emptyState={<SetupPrompt venueId={venueId} section="hold_stations" label="Add hold stations"
                text="No hold stations yet. Add a bain-marie, salad bar or other station in H&S settings." />}
            />
          </div>
        ) : tab === 'cooking' ? (
          <div>
            <h2 className="font-semibold mb-4">Cooking / reheat checks</h2>
            <CookingChecksPanel venueId={venueId} date={date} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
