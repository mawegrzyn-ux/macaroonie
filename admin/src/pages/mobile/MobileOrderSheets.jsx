// src/pages/mobile/MobileOrderSheets.jsx
// Mobile-optimised Order Sheets — unlike the other /mobile modules, the
// desktop OrderSheets.jsx page already collapses to a single-column,
// full-page-detail-on-select layout at phone width (its own list/detail
// panel is `hidden md:flex` when an order is selected), so there's no
// rebuild needed for the body components themselves. What genuinely
// differs is the shell: OrderSheets.jsx renders its own page header
// (title + pl-14 space reserved for AppShell's mobile hamburger button)
// and a resizable desktop list panel — both AppShell-specific and
// redundant under MobileShell, which already renders its own back-arrow
// header with the module title. This page reuses OrderCard / OrderDetail /
// NewOrderModal / FilterModal verbatim (exported from OrderSheets.jsx)
// and only replaces the outer chrome + list-vs-detail switching.
import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Package, Plus, Filter } from 'lucide-react'
import { useApi } from '@/lib/api'
import {
  OrderCard, OrderDetail, NewOrderModal, FilterModal,
  ALL_STATUSES, DEFAULT_STATUSES,
} from '@/pages/OrderSheets'

export default function MobileOrderSheets() {
  const api = useApi()
  const queryClient = useQueryClient()

  const [selectedStatuses, setSelectedStatuses] = useState(DEFAULT_STATUSES)
  const [selectedOrderId, setSelectedOrderId]   = useState(null)
  const [showNewModal, setShowNewModal]         = useState(false)
  const [showFilterModal, setShowFilterModal]   = useState(false)
  const [filterVenueId, setFilterVenueId]       = useState('')

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn:  () => api.get('/me'),
    staleTime: 120_000,
  })
  const isAdmin   = me?.is_platform_admin || me?.permissions?.order_sheets === 'manage'
  const canCreate = me?.is_platform_admin || me?.permissions?.order_sheets === 'manage'

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
    staleTime: 300_000,
  })

  const statusParam = selectedStatuses.join(',')
  const venueParam  = filterVenueId ? `&venue_id=${encodeURIComponent(filterVenueId)}` : ''
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['order-sheets', 'orders', statusParam, filterVenueId],
    queryFn:  () => api.get(`/order-sheets/orders?status=${encodeURIComponent(statusParam)}${venueParam}`),
  })

  const filtersActive = useMemo(() => {
    const defaultSet = new Set(DEFAULT_STATUSES)
    const currentSet = new Set(selectedStatuses)
    const sameStatuses = defaultSet.size === currentSet.size && [...defaultSet].every(s => currentSet.has(s))
    return !sameStatuses || !!filterVenueId
  }, [selectedStatuses, filterVenueId])

  function applyFilters({ statuses, venueId }) {
    setSelectedStatuses(statuses)
    setFilterVenueId(venueId)
    setSelectedOrderId(null)
  }

  function handleCreated(order) {
    setShowNewModal(false)
    setSelectedStatuses(ALL_STATUSES)
    setSelectedOrderId(order.id)
    queryClient.invalidateQueries(['order-sheets'])
  }

  function handleDeleted() {
    setSelectedOrderId(null)
    queryClient.invalidateQueries(['order-sheets'])
  }

  // Order selected — full-page detail, same component the desktop page
  // switches to at phone width.
  if (selectedOrderId) {
    return (
      <div className="h-full">
        <OrderDetail
          orderId={selectedOrderId}
          isAdmin={isAdmin}
          onClose={() => setSelectedOrderId(null)}
          onDeleted={handleDeleted}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 p-3 border-b shrink-0">
        <div className="relative">
          <button
            onClick={() => setShowFilterModal(true)}
            className="flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm font-medium touch-manipulation min-h-[40px] hover:bg-accent"
          >
            <Filter className="w-3.5 h-3.5" />
            Filter
          </button>
          {filtersActive && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />
          )}
        </div>
        {canCreate && (
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium touch-manipulation min-h-[40px]"
          >
            <Plus className="w-3.5 h-3.5" />
            New order
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 px-4 text-center">
          <Package className="w-8 h-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No orders found</p>
          <p className="text-xs text-muted-foreground mt-1">
            {filtersActive ? 'Try adjusting your filters' : 'Create a new order to get started'}
          </p>
        </div>
      ) : (
        <div className="flex-1">
          {orders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              isSelected={false}
              onClick={() => setSelectedOrderId(order.id)}
            />
          ))}
        </div>
      )}

      {showNewModal && (
        <NewOrderModal
          onClose={() => setShowNewModal(false)}
          onCreated={handleCreated}
        />
      )}

      {showFilterModal && (
        <FilterModal
          onClose={() => setShowFilterModal(false)}
          venues={venues}
          currentStatuses={selectedStatuses}
          currentVenueId={filterVenueId}
          onApply={applyFilters}
        />
      )}
    </div>
  )
}
