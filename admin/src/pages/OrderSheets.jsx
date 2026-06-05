// src/pages/OrderSheets.jsx
// Order Sheets management page — order list + order detail panel.
import { useState, useRef, useCallback, useEffect, useMemo, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  X, Plus, Minus, ChevronDown, Package, ClipboardList,
  CheckCircle, AlertCircle, Loader2, Search
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

/** Returns the next calendar date (YYYY-MM-DD) whose day-of-week is in deliveryDays. */
function nextDeliveryDate(deliveryDays) {
  if (!deliveryDays || deliveryDays.length === 0) return ''
  const today = new Date()
  for (let i = 0; i <= 7; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    if (deliveryDays.includes(d.getDay())) {
      return d.toISOString().slice(0, 10)
    }
  }
  return ''
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

  // When template changes: reset venue if not in new set, auto-set delivery date
  useEffect(() => {
    if (!templateId) return
    const tmpl = templates.find(t => t.id === templateId)
    if (venueId && !assignedVenueIds.includes(venueId)) setVenueId('')
    if (tmpl?.delivery_days?.length > 0) {
      const next = nextDeliveryDate(tmpl.delivery_days)
      if (next) setDeliveryDate(next)
    }
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
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
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
  const [showSaved, setShowSaved]       = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [actionError, setActionError] = useState('')
  const [searchQuery, setSearchQuery]   = useState('')

  const autosaveTimerRef = useRef(null)
  const savedTimerRef    = useRef(null)

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
    clearTimeout(autosaveTimerRef.current)
  }, [order?.id, order?.status]) // reset when id or status changes

  function scheduleAutosave() {
    clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => saveMutation.mutate(), 700)
  }

  function setQty(itemId, val) {
    setQtys(prev => ({ ...prev, [itemId]: val }))
    setDirty(true)
    scheduleAutosave()
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
      setShowSaved(true)
      clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setShowSaved(false), 2000)
    },
    onError: (err) => setActionError(err?.message ?? 'Save failed'),
  })

  const statusMutation = useMutation({
    mutationFn: async (newStatus) => {
      // Cancel any pending autosave — we'll save synchronously below if needed
      clearTimeout(autosaveTimerRef.current)
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
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-base truncate">{order.template_name}</h2>
          <p className="text-sm text-muted-foreground truncate">{order.venue_name} · {fmtDate(order.delivery_date)}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <StatusBadge status={order.status} />
            {isOrdering && saveMutation.isPending && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />Saving…
              </span>
            )}
            {isOrdering && !saveMutation.isPending && showSaved && (
              <span className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />Saved
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isOrdering && (
            <button
              onClick={() => statusMutation.mutate('ready')}
              disabled={statusMutation.isPending}
              className="bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-4 py-2.5 text-sm font-semibold touch-manipulation min-h-[44px] disabled:opacity-50 whitespace-nowrap"
            >
              {statusMutation.isPending ? '…' : 'Mark as Ready'}
            </button>
          )}
          <button onClick={onClose} className="p-2 rounded hover:bg-accent text-muted-foreground touch-manipulation">
            <X className="w-4 h-4" />
          </button>
        </div>
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
                  onChange={e => { setDeliveryDate(e.target.value); setDirty(true); scheduleAutosave() }}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                />
              </div>
            </div>
          )}

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search items…"
              className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm bg-background touch-manipulation min-h-[40px]"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground touch-manipulation">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Items table — overflow-y-clip keeps sticky thead working inside x-scroll */}
          <div className="overflow-x-auto overflow-y-clip -mx-4 px-4">
            {(() => {
              const allItems = order.items ?? []
              const filtered = searchQuery
                ? allItems.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
                : allItems
              // Group by category; use template name as fallback for uncategorised items
              const fallbackCat = order.template_name
              const groups = []
              const seen = new Map()
              for (const item of filtered) {
                const cat = item.category || fallbackCat
                if (!seen.has(cat)) { const g = { name: cat, items: [] }; seen.set(cat, g); groups.push(g) }
                seen.get(cat).items.push(item)
              }
              const showGroupHeaders = groups.length > 1 || (groups.length === 1 && groups[0].items.some(i => i.category))
              const colCount = 4 + (order.show_prices ? 1 : 0) + histCols.length
              return (
                <table className="w-full text-sm border-collapse min-w-[500px]">
                  <thead className="sticky top-0 z-10 bg-background">
                    <tr className="border-b">
                      <th className="text-left py-2 pr-3 font-medium text-muted-foreground text-xs">Item</th>
                      <th className="text-left py-2 pr-3 font-medium text-muted-foreground text-xs whitespace-nowrap">Unit</th>
                      {order.show_prices && (
                        <th className="text-right py-2 pr-3 font-medium text-muted-foreground text-xs whitespace-nowrap">Price</th>
                      )}
                      <th className="text-right py-2 pr-3 font-medium text-muted-foreground text-xs whitespace-nowrap">Qty</th>
                      <th className="text-right py-2 pr-3 font-medium text-muted-foreground text-xs whitespace-nowrap">Suggested</th>
                      {histCols.map((h, i) => (
                        <th key={i} className="text-right py-2 pr-3 font-medium text-muted-foreground text-xs whitespace-nowrap">
                          {h ? fmtDateShort(h.delivery_date) : '—'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={colCount} className="py-8 text-center text-sm text-muted-foreground">
                          {searchQuery ? 'No items match your search' : 'No items in this template'}
                        </td>
                      </tr>
                    ) : groups.map(group => (
                      <Fragment key={group.name}>
                        {showGroupHeaders && (
                          <tr className="bg-muted/40">
                            <td colSpan={colCount} className="py-1.5 px-3 text-xs font-semibold text-muted-foreground">
                              {group.name}
                            </td>
                          </tr>
                        )}
                        {group.items.map(item => (
                          <tr key={item.id} className="border-b last:border-0">
                            <td className="py-2.5 pr-3 font-medium">{item.name}</td>
                            <td className="py-2.5 pr-3 text-muted-foreground text-xs">{item.unit}</td>
                            {order.show_prices && (
                              <td className="py-2.5 pr-3 text-right text-xs text-muted-foreground">
                                {item.price != null ? `£${Number(item.price).toFixed(2)}` : '—'}
                              </td>
                            )}
                            <td className="py-2 pr-3 text-right">
                              {isOrdering ? (
                                <div className="flex items-center justify-end gap-1">
                                  <button type="button"
                                    onClick={() => setQty(item.id, String(Math.max(0, (Number(qtys[item.id]) || 0) - 1)))}
                                    className="w-8 h-10 flex items-center justify-center border rounded-lg hover:bg-accent text-muted-foreground touch-manipulation shrink-0">
                                    <Minus className="w-3.5 h-3.5" />
                                  </button>
                                  <input type="number" inputMode="numeric" min="0" step="1"
                                    value={qtys[item.id] ?? ''}
                                    onChange={e => setQty(item.id, e.target.value)}
                                    className="w-14 h-10 text-center text-sm border rounded-lg px-1 touch-manipulation"
                                    placeholder="0" />
                                  <button type="button"
                                    onClick={() => setQty(item.id, String((Number(qtys[item.id]) || 0) + 1))}
                                    className="w-8 h-10 flex items-center justify-center border rounded-lg hover:bg-accent text-muted-foreground touch-manipulation shrink-0">
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-sm font-medium">
                                  {qtys[item.id] !== '' && qtys[item.id] != null ? Number(qtys[item.id]) : '—'}
                                </span>
                              )}
                            </td>
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
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )
            })()}
          </div>

          {/* Notes */}
          {isOrdering ? (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={e => { setNotes(e.target.value); setDirty(true); scheduleAutosave() }}
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

          {/* Status transitions */}
          <div className="space-y-2">
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

  const [selectedStatuses, setSelectedStatuses] = useState(['ordering', 'ready', 'placed'])
  const [selectedOrderId, setSelectedOrderId]   = useState(null)
  const [showNewModal, setShowNewModal]          = useState(false)
  const [filterVenueId, setFilterVenueId]        = useState('')

  // Resizable list panel (left side)
  const [listWidth, setListWidth] = useState(320)
  const resizeRef = useRef(null)

  const handleResizeStart = useCallback((e) => {
    e.preventDefault()
    const startX     = e.clientX
    const startWidth = listWidth
    function onMove(e2) {
      setListWidth(Math.min(480, Math.max(240, startWidth + (e2.clientX - startX))))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [listWidth])

  // Me query for admin check
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn:  () => api.get('/me'),
    staleTime: 120_000,
  })
  const isAdmin = me?.role === 'admin' || me?.role === 'owner'

  // Venues for filter dropdown
  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
    staleTime: 300_000,
  })

  // Always-on active orders (ordering status) — drives the toolbar
  const { data: activeOrders = [] } = useQuery({
    queryKey: ['order-sheets', 'orders', 'active'],
    queryFn:  () => api.get('/order-sheets/orders?status=ordering'),
    staleTime: 0,
  })

  // Orders list — respects status filter + venue filter
  const statusParam = selectedStatuses.join(',')
  const venueParam  = filterVenueId ? `&venue_id=${encodeURIComponent(filterVenueId)}` : ''
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['order-sheets', 'orders', statusParam, filterVenueId],
    queryFn:  () => api.get(`/order-sheets/orders?status=${encodeURIComponent(statusParam)}${venueParam}`),
  })

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
    setSelectedStatuses(['ordering', 'ready', 'placed'])
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
      <div
        className={cn(
          'flex flex-col border-r bg-background overflow-hidden',
          selectedOrderId ? 'hidden md:flex shrink-0' : 'flex-1',
        )}
        style={selectedOrderId ? { width: listWidth } : undefined}
      >

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

        {/* Active orders toolbar — quick-access pills for orders in "ordering" state */}
        {activeOrders.length > 0 && (
          <div className="px-3 pt-2.5 pb-2 border-b bg-muted/30 shrink-0">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Active</p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {activeOrders.map(order => (
                <button
                  key={order.id}
                  onClick={() => setSelectedOrderId(order.id)}
                  className={cn(
                    'flex-none inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors touch-manipulation whitespace-nowrap min-h-[32px]',
                    selectedOrderId === order.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:bg-accent',
                  )}
                >
                  <span className="font-semibold">{order.template_name}</span>
                  <span className="opacity-60">· {order.venue_name} · {fmtDateShort(order.delivery_date)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Venue filter */}
        <div className="px-3 py-2 border-b shrink-0">
          <div className="relative">
            <select
              value={filterVenueId}
              onChange={e => { setFilterVenueId(e.target.value); setSelectedOrderId(null) }}
              className="w-full border rounded-lg px-3 pr-8 py-2 text-xs bg-background touch-manipulation min-h-[36px] appearance-none"
            >
              <option value="">All venues</option>
              {venues.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>
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
                {filterVenueId
                  ? 'No orders for this venue with the selected filters'
                  : 'Create a new order to get started'}
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

          <div className="flex-1 flex flex-col bg-background overflow-hidden min-w-0">
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
