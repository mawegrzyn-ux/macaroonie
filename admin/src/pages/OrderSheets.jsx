// src/pages/OrderSheets.jsx
// Order Sheets management page — order list + order detail panel.
import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  X, Plus, ChevronRight, Package, ClipboardList,
  CheckCircle, AlertCircle, Loader2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApi } from '@/lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(dateStr) {
  if (!dateStr) return ''
  try {
    return format(parseISO(String(dateStr)), 'EEE d MMM yyyy')
  } catch {
    return String(dateStr)
  }
}

function fmtDateShort(dateStr) {
  if (!dateStr) return ''
  try {
    return format(parseISO(String(dateStr)), 'd MMM')
  } catch {
    return String(dateStr)
  }
}

const STATUS_LABEL = { ordering: 'Ordering', ready: 'Ready', placed: 'Placed' }
const STATUS_BADGE = {
  ordering: 'bg-blue-100 text-blue-800',
  ready:    'bg-amber-100 text-amber-800',
  placed:   'bg-green-100 text-green-800',
}

function StatusBadge({ status }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-700')}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

// ── New Order Modal ────────────────────────────────────────────────────────────

function NewOrderModal({ onClose, onCreated }) {
  const api = useApi()
  const queryClient = useQueryClient()

  const [templateId, setTemplateId] = useState('')
  const [venueId, setVenueId]       = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [error, setError] = useState('')

  const { data: templates = [] } = useQuery({
    queryKey: ['order-sheets', 'templates'],
    queryFn:  () => api.get('/order-sheets/templates'),
  })

  const { data: allVenues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  const selectedTemplate = templates.find(t => t.id === templateId)
  const assignedVenueIds = selectedTemplate?.venue_ids ?? []
  const venuesForTemplate = allVenues.filter(v => assignedVenueIds.includes(v.id))

  // When template changes reset venue if not in new set
  useEffect(() => {
    if (venueId && !assignedVenueIds.includes(venueId)) setVenueId('')
  }, [templateId]) // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useMutation({
    mutationFn: (body) => api.post('/order-sheets/orders', body),
    onSuccess: (order) => {
      queryClient.invalidateQueries(['order-sheets'])
      onCreated(order)
    },
    onError: (err) => setError(err?.message ?? 'Failed to create order'),
  })

  function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!templateId) return setError('Select a template')
    if (!venueId)    return setError('Select a venue')
    if (!deliveryDate) return setError('Set a delivery date')
    createMutation.mutate({ template_id: templateId, venue_id: venueId, delivery_date: deliveryDate })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-base font-semibold">New Order</h2>
          <button onClick={onClose} className="p-2 rounded hover:bg-accent text-muted-foreground touch-manipulation">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Template */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Template <span className="text-red-500">*</span></label>
            <select
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background touch-manipulation min-h-[44px]"
              required
            >
              <option value="">Select template…</option>
              {templates.filter(t => t.is_active).map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Venue */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Venue <span className="text-red-500">*</span></label>
            <select
              value={venueId}
              onChange={e => setVenueId(e.target.value)}
              disabled={!templateId}
              className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background touch-manipulation min-h-[44px] disabled:opacity-50"
              required
            >
              <option value="">{templateId ? 'Select venue…' : 'Select template first…'}</option>
              {venuesForTemplate.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            {templateId && venuesForTemplate.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">No venues assigned to this template</p>
            )}
          </div>

          {/* Delivery date */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Delivery date <span className="text-red-500">*</span></label>
            <div className="relative">
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2.5 text-sm min-h-[44px] touch-manipulation cursor-pointer bg-background">
                <span className={deliveryDate ? 'text-foreground' : 'text-muted-foreground'}>
                  {deliveryDate ? fmtDate(deliveryDate) : 'Pick a date…'}
                </span>
              </div>
              <input
                type="date"
                value={deliveryDate}
                onChange={e => setDeliveryDate(e.target.value)}
                required
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border rounded-lg py-2.5 text-sm font-medium touch-manipulation min-h-[48px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1 bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-medium touch-manipulation min-h-[48px] disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating…' : 'Create Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Order Detail Panel ─────────────────────────────────────────────────────────

function OrderDetail({ orderId, isAdmin, onClose, onDeleted }) {
  const api = useApi()
  const queryClient = useQueryClient()

  const { data: order, isLoading } = useQuery({
    queryKey: ['order-sheets', 'orders', orderId],
    queryFn:  () => api.get(`/order-sheets/orders/${orderId}`),
    enabled:  !!orderId,
  })

  // Local qty state keyed by item_id
  const [qtys, setQtys]         = useState({})
  const [notes, setNotes]       = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [dirty, setDirty]       = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [actionError, setActionError] = useState('')

  // Sync local state when order loads
  useEffect(() => {
    if (!order) return
    const initial = {}
    for (const item of order.items ?? []) {
      initial[item.id] = item.qty != null ? String(item.qty) : ''
    }
    setQtys(initial)
    setNotes(order.notes ?? '')
    setDeliveryDate(order.delivery_date ? String(order.delivery_date).slice(0, 10) : '')
    setDirty(false)
    setDeleteConfirm(false)
    setActionError('')
  }, [order?.id, order?.status]) // reset when id or status changes

  function setQty(itemId, val) {
    setQtys(prev => ({ ...prev, [itemId]: val }))
    setDirty(true)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items = (order?.items ?? []).map(item => ({
        item_id: item.id,
        qty: qtys[item.id] !== '' && qtys[item.id] != null ? Number(qtys[item.id]) : null,
        unit_price: item.unit_price ?? null,
      }))
      await api.put(`/order-sheets/orders/${orderId}/items`, { items })
      if (order?.status === 'ordering') {
        const patchBody = {}
        if (notes !== (order.notes ?? '')) patchBody.notes = notes
        if (deliveryDate !== String(order.delivery_date).slice(0, 10)) patchBody.delivery_date = deliveryDate
        if (Object.keys(patchBody).length > 0) {
          await api.patch(`/order-sheets/orders/${orderId}`, patchBody)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['order-sheets'])
      setDirty(false)
    },
    onError: (err) => setActionError(err?.message ?? 'Save failed'),
  })

  const statusMutation = useMutation({
    mutationFn: async (newStatus) => {
      // Save items first if ordering
      if (order?.status === 'ordering' && dirty) {
        const items = (order?.items ?? []).map(item => ({
          item_id: item.id,
          qty: qtys[item.id] !== '' && qtys[item.id] != null ? Number(qtys[item.id]) : null,
          unit_price: item.unit_price ?? null,
        }))
        await api.put(`/order-sheets/orders/${orderId}/items`, { items })
        const patchBody = {}
        if (notes !== (order.notes ?? '')) patchBody.notes = notes
        if (deliveryDate !== String(order.delivery_date).slice(0, 10)) patchBody.delivery_date = deliveryDate
        if (Object.keys(patchBody).length > 0) {
          await api.patch(`/order-sheets/orders/${orderId}`, patchBody)
        }
      }
      return api.patch(`/order-sheets/orders/${orderId}/status`, { status: newStatus })
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['order-sheets'])
      setDirty(false)
    },
    onError: (err) => setActionError(err?.message ?? 'Status change failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/order-sheets/orders/${orderId}`),
    onSuccess: () => {
      queryClient.invalidateQueries(['order-sheets'])
      onDeleted?.()
    },
    onError: (err) => setActionError(err?.message ?? 'Delete failed'),
  })

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!order) return null

  const isOrdering = order.status === 'ordering'
  const isReady    = order.status === 'ready'
  const isPlaced   = order.status === 'placed'

  // Pad history to always 3 columns
  const history = order.history ?? []
  const histCols = [
    history[0] ?? null,
    history[1] ?? null,
    history[2] ?? null,
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b shrink-0 gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-base truncate">{order.template_name}</h2>
          <p className="text-sm text-muted-foreground truncate">{order.venue_name} · {fmtDate(order.delivery_date)}</p>
          <div className="mt-1.5">
            <StatusBadge status={order.status} />
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded hover:bg-accent text-muted-foreground shrink-0 touch-manipulation">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-5">

          {/* Delivery date edit (ordering only) */}
          {isOrdering && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Delivery date</label>
              <div className="relative inline-block">
                <div className="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm touch-manipulation cursor-pointer bg-background min-h-[44px] min-w-[180px]">
                  <span>{deliveryDate ? fmtDate(deliveryDate) : 'Pick a date…'}</span>
                </div>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={e => { setDeliveryDate(e.target.value); setDirty(true) }}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* Items table */}
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm border-collapse min-w-[500px]">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-3 font-medium text-muted-foreground text-xs">Item</th>
                  <th className="text-left py-2 pr-3 font-medium text-muted-foreground text-xs whitespace-nowrap">Unit</th>
                  {order.show_prices && (
                    <th className="text-right py-2 pr-3 font-medium text-muted-foreground text-xs whitespace-nowrap">Price</th>
                  )}
                  <th className="text-right py-2 pr-3 font-medium text-muted-foreground text-xs whitespace-nowrap">Suggested</th>
                  {histCols.map((h, i) => (
                    <th key={i} className="text-right py-2 pr-3 font-medium text-muted-foreground text-xs whitespace-nowrap">
                      {h ? fmtDateShort(h.delivery_date) : '—'}
                    </th>
                  ))}
                  <th className="text-right py-2 font-medium text-muted-foreground text-xs whitespace-nowrap">Qty</th>
                </tr>
              </thead>
              <tbody>
                {(order.items ?? []).map(item => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-3 font-medium">{item.name}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground text-xs">{item.unit}</td>
                    {order.show_prices && (
                      <td className="py-2.5 pr-3 text-right text-xs text-muted-foreground">
                        {item.price != null ? `£${Number(item.price).toFixed(2)}` : '—'}
                      </td>
                    )}
                    <td className="py-2.5 pr-3 text-right text-xs text-muted-foreground">
                      {item.suggested_qty != null ? Number(item.suggested_qty) : '—'}
                    </td>
                    {histCols.map((h, i) => {
                      const hQty = h ? (h.item_qtys ?? {})[item.id] : null
                      return (
                        <td key={i} className="py-2.5 pr-3 text-right text-xs text-muted-foreground">
                          {hQty != null ? Number(hQty) : '—'}
                        </td>
                      )
                    })}
                    <td className="py-2.5 text-right">
                      {isOrdering ? (
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="1"
                          value={qtys[item.id] ?? ''}
                          onChange={e => setQty(item.id, e.target.value)}
                          className="w-20 h-12 text-center text-base border rounded-lg px-2 touch-manipulation"
                          placeholder="0"
                        />
                      ) : (
                        <span className="text-sm font-medium">
                          {qtys[item.id] !== '' && qtys[item.id] != null ? Number(qtys[item.id]) : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {(order.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6 + (order.show_prices ? 1 : 0)} className="py-8 text-center text-sm text-muted-foreground">
                      No items in this template
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Notes */}
          {isOrdering ? (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={e => { setNotes(e.target.value); setDirty(true) }}
                rows={2}
                placeholder="Optional notes…"
                className="w-full border rounded-lg px-3 py-2 text-sm resize-none touch-manipulation"
              />
            </div>
          ) : order.notes ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
              <p className="text-sm bg-muted/40 rounded-lg px-3 py-2">{order.notes}</p>
            </div>
          ) : null}

          {actionError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {actionError}
            </div>
          )}

          {/* Save (ordering) */}
          {isOrdering && (
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !dirty}
              className="w-full bg-primary text-primary-foreground rounded-lg py-3 text-sm font-medium touch-manipulation min-h-[48px] disabled:opacity-40"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          )}

          {/* Status transitions */}
          <div className="space-y-2">
            {isOrdering && (
              <button
                onClick={() => statusMutation.mutate('ready')}
                disabled={statusMutation.isPending}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-3 text-sm font-semibold touch-manipulation min-h-[48px] disabled:opacity-50"
              >
                {statusMutation.isPending ? 'Updating…' : 'Mark as Ready'}
              </button>
            )}
            {isReady && (
              <>
                <button
                  onClick={() => statusMutation.mutate('placed')}
                  disabled={statusMutation.isPending}
                  className="w-full bg-green-600 hover:bg-green-700 text-white rounded-lg py-3 text-sm font-semibold touch-manipulation min-h-[48px] disabled:opacity-50"
                >
                  {statusMutation.isPending ? 'Updating…' : 'Mark as Placed'}
                </button>
                {isAdmin && (
                  <button
                    onClick={() => statusMutation.mutate('ordering')}
                    disabled={statusMutation.isPending}
                    className="w-full border rounded-lg py-3 text-sm text-muted-foreground touch-manipulation min-h-[48px] disabled:opacity-50"
                  >
                    Revert to Ordering
                  </button>
                )}
              </>
            )}
            {isPlaced && isAdmin && (
              <>
                <button
                  onClick={() => statusMutation.mutate('ready')}
                  disabled={statusMutation.isPending}
                  className="w-full border rounded-lg py-3 text-sm text-muted-foreground touch-manipulation min-h-[48px] disabled:opacity-50"
                >
                  Revert to Ready
                </button>
                <button
                  onClick={() => statusMutation.mutate('ordering')}
                  disabled={statusMutation.isPending}
                  className="w-full border rounded-lg py-3 text-sm text-muted-foreground touch-manipulation min-h-[48px] disabled:opacity-50"
                >
                  Revert to Ordering
                </button>
              </>
            )}
          </div>

          {/* Delete (admin only) */}
          {isAdmin && (
            <div className="pt-2 border-t">
              {!deleteConfirm ? (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="text-sm text-red-600 underline-offset-2 hover:underline touch-manipulation py-2"
                >
                  Delete order
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-red-600">Delete this order?</span>
                  <button
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                    className="bg-red-600 text-white text-sm rounded-lg px-4 py-2 touch-manipulation min-h-[40px]"
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    className="text-sm text-muted-foreground border rounded-lg px-4 py-2 touch-manipulation min-h-[40px]"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Order List Card ────────────────────────────────────────────────────────────

function OrderCard({ order, isSelected, onClick }) {
  const filledCount = order.filled_count ?? 0
  const itemCount   = order.item_count ?? 0

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-4 border-b last:border-0 hover:bg-accent/50 transition-colors touch-manipulation',
        isSelected && 'bg-accent',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{order.template_name}</p>
          <p className="text-xs text-muted-foreground truncate">{order.venue_name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(order.delivery_date)}</p>
        </div>
        <div className="shrink-0 text-right space-y-1">
          <StatusBadge status={order.status} />
          <p className="text-xs text-muted-foreground">{filledCount}/{itemCount} items</p>
        </div>
      </div>
    </button>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

const ALL_STATUSES = ['ordering', 'ready', 'placed']

export default function OrderSheets() {
  const api = useApi()
  const queryClient = useQueryClient()

  const [selectedStatuses, setSelectedStatuses] = useState(['ordering'])
  const [selectedOrderId, setSelectedOrderId]   = useState(null)
  const [showNewModal, setShowNewModal]          = useState(false)

  // Resizable panel
  const [panelWidth, setPanelWidth] = useState(420)
  const resizeRef = useRef(null)

  const handleResizeStart = useCallback((e) => {
    e.preventDefault()
    const startX     = e.clientX
    const startWidth = panelWidth

    function onMove(e2) {
      const delta = startX - e2.clientX
      setPanelWidth(Math.min(620, Math.max(280, startWidth + delta)))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [panelWidth])

  // Me query for admin check
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn:  () => api.get('/api/me'),
    staleTime: 120_000,
  })
  const isAdmin = me?.role === 'admin' || me?.role === 'owner'

  // Orders list
  const statusParam = selectedStatuses.join(',')
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['order-sheets', 'orders', statusParam],
    queryFn:  () => api.get(`/order-sheets/orders?status=${encodeURIComponent(statusParam)}`),
  })

  // Status counts from query (approx — refetches when filter changes)
  function toggleStatus(s) {
    setSelectedStatuses(prev =>
      prev.includes(s)
        ? prev.length > 1 ? prev.filter(x => x !== s) : prev  // keep at least one
        : [...prev, s]
    )
    setSelectedOrderId(null)
  }

  function handleCreated(order) {
    setShowNewModal(false)
    setSelectedStatuses(['ordering'])
    setSelectedOrderId(order.id)
    queryClient.invalidateQueries(['order-sheets'])
  }

  function handleDeleted() {
    setSelectedOrderId(null)
    queryClient.invalidateQueries(['order-sheets'])
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* Left column */}
      <div className={cn(
        'flex flex-col border-r bg-background overflow-hidden',
        selectedOrderId ? 'hidden md:flex md:w-80 lg:w-96 shrink-0' : 'flex-1',
      )}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-muted-foreground" />
            <h1 className="font-semibold text-sm">Order Sheets</h1>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium touch-manipulation min-h-[40px]"
          >
            <Plus className="w-3.5 h-3.5" />
            New order
          </button>
        </div>

        {/* Status filter tabs */}
        <div className="flex border-b shrink-0 px-2 pt-2 gap-1">
          {ALL_STATUSES.map(s => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={cn(
                'px-3 py-2 text-xs font-medium rounded-t border-b-2 transition-colors touch-manipulation min-h-[40px]',
                selectedStatuses.includes(s)
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {/* Orders list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <Package className="w-8 h-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No orders found</p>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedStatuses.length === 1 && selectedStatuses[0] === 'ordering'
                  ? 'Create a new order to get started'
                  : 'Try adjusting the status filter above'}
              </p>
            </div>
          ) : (
            orders.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                isSelected={order.id === selectedOrderId}
                onClick={() => setSelectedOrderId(order.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel — desktop: resizable; mobile: full page when selected */}
      {selectedOrderId && (
        <>
          {/* Resize handle — desktop only */}
          <div
            ref={resizeRef}
            onMouseDown={handleResizeStart}
            className="hidden md:block w-1 cursor-col-resize bg-border hover:bg-primary/30 transition-colors shrink-0"
          />

          <div
            className={cn(
              'flex flex-col bg-background overflow-hidden',
              'flex-1 md:flex-none',
            )}
            style={{ width: typeof window !== 'undefined' && window.innerWidth >= 768 ? panelWidth : undefined }}
          >
            <OrderDetail
              orderId={selectedOrderId}
              isAdmin={isAdmin}
              onClose={() => setSelectedOrderId(null)}
              onDeleted={handleDeleted}
            />
          </div>
        </>
      )}

      {/* New order modal */}
      {showNewModal && (
        <NewOrderModal
          onClose={() => setShowNewModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
