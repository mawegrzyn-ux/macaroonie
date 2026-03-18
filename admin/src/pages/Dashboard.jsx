// src/pages/Dashboard.jsx
// Summary stats for today + upcoming bookings.
// Quick at-a-glance view for operators opening the app each morning.

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CalendarDays, Users, CreditCard, Clock } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, formatTime, STATUS_COLOURS, STATUS_LABELS } from '@/lib/utils'

function StatCard({ icon: Icon, label, value, sub, colour }) {
  return (
    <div className="border rounded-lg p-4">
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center mb-3', colour)}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm font-medium mt-0.5">{label}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

export default function Dashboard() {
  const api   = useApi()
  const today = format(new Date(), 'yyyy-MM-dd')

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  // Fetch today's bookings across all venues
  const { data: todaysBookings = [] } = useQuery({
    queryKey: ['bookings-today', today],
    queryFn:  () => api.get(`/bookings?date=${today}&status=confirmed&limit=200`),
  })

  const totalCovers   = todaysBookings.reduce((s, b) => s + b.covers, 0)
  const totalRevenue  = todaysBookings.reduce((s, b) => s + (b.payment_amount ?? 0), 0)
  const upcoming      = todaysBookings
    .filter(b => new Date(b.starts_at) > new Date())
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .slice(0, 8)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <div>
          <h1 className="font-semibold">Dashboard</h1>
          <p className="text-xs text-muted-foreground">{format(new Date(), 'EEEE d MMMM yyyy')}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={CalendarDays} label="Bookings today"
            value={todaysBookings.length} colour="bg-blue-50 text-blue-600" />
          <StatCard icon={Users} label="Covers today"
            value={totalCovers} colour="bg-green-50 text-green-600" />
          <StatCard icon={CreditCard} label="Deposit revenue"
            value={totalRevenue > 0 ? `£${totalRevenue.toFixed(2)}` : '—'}
            colour="bg-amber-50 text-amber-600" />
          <StatCard icon={Clock} label="Upcoming today"
            value={upcoming.length} sub="from now"
            colour="bg-purple-50 text-purple-600" />
        </div>

        {/* Upcoming bookings */}
        <div>
          <p className="text-sm font-semibold mb-3">Upcoming today</p>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming bookings for today.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              {upcoming.map((b, i) => (
                <div key={b.id} className={cn(
                  'flex items-center gap-4 px-4 py-3',
                  i !== 0 && 'border-t'
                )}>
                  <div className="w-14 text-center">
                    <p className="text-sm font-bold">{formatTime(b.starts_at)}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{b.guest_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.covers} covers · {b.venue_name} / {b.table_label}
                    </p>
                  </div>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-medium',
                    STATUS_COLOURS[b.status]
                  )}>
                    {STATUS_LABELS[b.status]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Venues quick status */}
        <div>
          <p className="text-sm font-semibold mb-3">Venues</p>
          <div className="grid grid-cols-2 gap-3">
            {venues.map(v => (
              <div key={v.id} className="border rounded-lg px-4 py-3 flex items-center gap-3">
                <div className={cn('w-2 h-2 rounded-full', v.is_active ? 'bg-green-500' : 'bg-gray-300')} />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{v.name}</p>
                  <p className="text-xs text-muted-foreground">{v.table_count} tables</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
