// src/pages/OrderSheetTemplates.jsx
import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical, Plus, Trash2, X, ClipboardList, Loader2, AlertCircle,
  Check, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApi } from '@/lib/api'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Display order: Mon–Sun
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-10 h-6 rounded-full transition-colors cursor-pointer touch-manipulation',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span className={cn(
        'absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
        checked ? 'translate-x-5' : 'translate-x-1',
      )} />
    </div>
  )
}

function SectionCard({ title, children, action }) {
  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function SortableItemRow({ item, showPrices, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 py-2.5 border-b last:border-0">
      <button {...attributes} {...listeners} className="p-1.5 text-muted-foreground cursor-grab active:cursor-grabbing touch-manipulation shrink-0">
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <span className="text-sm font-medium truncate flex-1">{item.name}</span>
        <span className="text-xs text-muted-foreground shrink-0">{item.unit}</span>
        {showPrices && item.price != null && (
          <span className="text-xs text-muted-foreground shrink-0">£{Number(item.price).toFixed(2)}</span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => onEdit(item)} className="p-2 rounded hover:bg-accent text-muted-foreground touch-manipulation" title="Edit">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDelete(item.id)} className="p-2 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 touch-manipulation" title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

function TemplateEditor({ templateId, isAdmin, onClose, onSaved, onDeleted }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const isNew = templateId === '__new__'

  const { data: template, isLoading } = useQuery({
    queryKey: ['order-sheets', 'templates', templateId],
    queryFn:  () => api.get(`/order-sheets/templates/${templateId}`),
    enabled:  !!templateId && !isNew,
  })

  const { data: allVenues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  const [name, setName]                 = useState('')
  const [showPrices, setShowPrices]     = useState(false)
  const [isActive, setIsActive]         = useState(true)
  const [deliveryDays, setDeliveryDays] = useState([])
  const [basicError, setBasicError]     = useState('')
  const [basicSaved, setBasicSaved]     = useState(false)

  const [venueIds, setVenueIds]   = useState([])
  const [venueError, setVenueError] = useState('')
  const [venueSaved, setVenueSaved] = useState(false)

  const [items, setItems]             = useState([])
  const [editingItem, setEditingItem] = useState(null)
  const [newItemName, setNewItemName] = useState('')
  const [newItemUnit, setNewItemUnit] = useState('')
  const [newItemPrice, setNewItemPrice] = useState('')
  const [itemError, setItemError]     = useState('')
  const [deleteItemId, setDeleteItemId] = useState(null)

  const [suggestedQtys, setSuggestedQtys] = useState({})
  const [suggestSaved, setSuggestSaved]   = useState(false)
  const [suggestError, setSuggestError]   = useState('')

  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteError, setDeleteError]     = useState('')

  useEffect(() => {
    if (!template) return
    setName(template.name ?? '')
    setShowPrices(template.show_prices ?? false)
    setIsActive(template.is_active ?? true)
    setDeliveryDays(template.delivery_days ?? [])
    setVenueIds(template.venue_ids ?? [])
    setItems(template.items ?? [])
    const sqMap = {}
    for (const item of template.items ?? []) {
      sqMap[item.id] = {}
      if (item.suggested_qty && typeof item.suggested_qty === 'object') {
        for (const [vid, qty] of Object.entries(item.suggested_qty)) {
          sqMap[item.id][vid] = qty != null ? String(qty) : ''
        }
      }
    }
    setSuggestedQtys(sqMap)
  }, [template?.id, template?.updated_at]) // eslint-disable-line

  const sensors = useSensors(useSensor(PointerSensor), useSensor(TouchSensor))

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const reordered = arrayMove(items, items.findIndex(i => i.id === active.id), items.findIndex(i => i.id === over.id))
    setItems(reordered)
    api.patch(`/order-sheets/templates/${templateId}/item-order`, { ids: reordered.map(i => i.id) })
      .then(() => queryClient.invalidateQueries(['order-sheets', 'templates']))
      .catch(() => {})
  }

  const saveBasicMutation = useMutation({
    mutationFn: () => isNew
      ? api.post('/order-sheets/templates', { name, show_prices: showPrices, venue_ids: venueIds })
      : api.patch(`/order-sheets/templates/${templateId}`, { name, show_prices: showPrices, is_active: isActive, delivery_days: deliveryDays }),
    onSuccess: (result) => {
      queryClient.invalidateQueries(['order-sheets', 'templates'])
      setBasicSaved(true); setTimeout(() => setBasicSaved(false), 2000)
      if (isNew) onSaved?.(result)
    },
    onError: (err) => setBasicError(err?.message ?? 'Save failed'),
  })

  const saveVenuesMutation = useMutation({
    mutationFn: () => api.put(`/order-sheets/templates/${templateId}/venues`, { venue_ids: venueIds }),
    onSuccess: () => {
      queryClient.invalidateQueries(['order-sheets', 'templates'])
      setVenueSaved(true); setTimeout(() => setVenueSaved(false), 2000)
    },
    onError: (err) => setVenueError(err?.message ?? 'Save failed'),
  })

  const addItemMutation = useMutation({
    mutationFn: () => api.post(`/order-sheets/templates/${templateId}/items`, {
      name: newItemName.trim(), unit: newItemUnit.trim(),
      price: newItemPrice !== '' ? Number(newItemPrice) : null,
    }),
    onSuccess: (item) => {
      setItems(prev => [...prev, item])
      setSuggestedQtys(prev => ({ ...prev, [item.id]: {} }))
      setNewItemName(''); setNewItemUnit(''); setNewItemPrice(''); setItemError('')
      queryClient.invalidateQueries(['order-sheets', 'templates'])
    },
    onError: (err) => setItemError(err?.message ?? 'Add failed'),
  })

  const editItemMutation = useMutation({
    mutationFn: (item) => api.patch(`/order-sheets/templates/${templateId}/items/${item.id}`, { name: item.name, unit: item.unit, price: item.price ?? null }),
    onSuccess: (updated) => { setItems(prev => prev.map(i => i.id === updated.id ? updated : i)); setEditingItem(null) },
  })

  const deleteItemMutation = useMutation({
    mutationFn: (itemId) => api.delete(`/order-sheets/templates/${templateId}/items/${itemId}`),
    onSuccess: (_, itemId) => {
      setItems(prev => prev.filter(i => i.id !== itemId))
      setSuggestedQtys(prev => { const next = { ...prev }; delete next[itemId]; return next })
      setDeleteItemId(null)
      queryClient.invalidateQueries(['order-sheets', 'templates'])
    },
  })

  const deleteTemplateMutation = useMutation({
    mutationFn: () => api.delete(`/order-sheets/templates/${templateId}`),
    onSuccess: () => {
      queryClient.invalidateQueries(['order-sheets', 'templates'])
      onDeleted?.()
    },
    onError: (err) => setDeleteError(err?.message ?? 'Delete failed'),
  })

  async function saveSuggestedQtys() {
    setSuggestError('')
    try {
      for (const item of items) {
        const venueQtys = assignedVenues
          .map(v => ({ venue_id: v.id, qty: Number((suggestedQtys[item.id] ?? {})[v.id] ?? 0) }))
          .filter(v => (suggestedQtys[item.id] ?? {})[v.venue_id] !== '')
        await api.put(`/order-sheets/templates/${templateId}/items/${item.id}/suggested`, { venue_qtys: venueQtys })
      }
      queryClient.invalidateQueries(['order-sheets', 'templates'])
      setSuggestSaved(true); setTimeout(() => setSuggestSaved(false), 2000)
    } catch (err) {
      setSuggestError(err?.message ?? 'Save failed')
    }
  }

  function toggleDeliveryDay(day) {
    setDeliveryDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
  }

  const assignedVenues = allVenues.filter(v => venueIds.includes(v.id))
  const showSuggestedSection = !isNew && assignedVenues.length > 0 && items.length > 0

  if (!isNew && isLoading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="font-semibold text-sm truncate">{isNew ? 'New Template' : (template?.name ?? 'Template')}</h2>
        <button onClick={onClose} className="p-2 rounded hover:bg-accent text-muted-foreground touch-manipulation">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">

        {/* Basic info */}
        <SectionCard title="Basic info">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Name <span className="text-red-500">*</span></label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Weekly Produce Order"
                className="w-full border rounded-lg px-3 py-2.5 text-sm touch-manipulation min-h-[44px]" />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Show prices</p>
                <p className="text-xs text-muted-foreground">Show unit price column in order forms</p>
              </div>
              <Toggle checked={showPrices} onChange={setShowPrices} />
            </div>

            {!isNew && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">Inactive templates are hidden from new orders</p>
                </div>
                <Toggle checked={isActive} onChange={setIsActive} />
              </div>
            )}

            {/* Delivery days */}
            <div>
              <p className="text-sm font-medium mb-1">Delivery days</p>
              <p className="text-xs text-muted-foreground mb-2">The date picker defaults to the nearest upcoming delivery day</p>
              <div className="flex gap-2 flex-wrap">
                {DAY_ORDER.map(day => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDeliveryDay(day)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium border touch-manipulation min-h-[36px] transition-colors',
                      deliveryDays.includes(day)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:border-primary/50',
                    )}
                  >
                    {DAY_LABELS[day]}
                  </button>
                ))}
              </div>
            </div>

            {basicError && <p className="text-sm text-red-600">{basicError}</p>}
            <button
              onClick={() => { setBasicError(''); saveBasicMutation.mutate() }}
              disabled={saveBasicMutation.isPending || !name.trim()}
              className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium touch-manipulation min-h-[44px] disabled:opacity-50"
            >
              {saveBasicMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : basicSaved ? <Check className="w-3.5 h-3.5" /> : null}
              {isNew ? 'Create template' : 'Save basic info'}
            </button>
          </div>
        </SectionCard>

        {/* Assigned venues */}
        {!isNew && (
          <SectionCard title="Assigned venues">
            <div className="space-y-3">
              {allVenues.length === 0 ? (
                <p className="text-sm text-muted-foreground">No venues found</p>
              ) : (
                <div className="space-y-2">
                  {allVenues.map(venue => (
                    <label key={venue.id} className="flex items-center gap-3 cursor-pointer touch-manipulation min-h-[44px]">
                      <input type="checkbox" checked={venueIds.includes(venue.id)}
                        onChange={e => setVenueIds(prev => e.target.checked ? [...prev, venue.id] : prev.filter(id => id !== venue.id))}
                        className="w-4 h-4 rounded" />
                      <span className="text-sm">{venue.name}</span>
                    </label>
                  ))}
                </div>
              )}
              {venueError && <p className="text-sm text-red-600">{venueError}</p>}
              <button
                onClick={() => { setVenueError(''); saveVenuesMutation.mutate() }}
                disabled={saveVenuesMutation.isPending}
                className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium touch-manipulation min-h-[44px] disabled:opacity-50"
              >
                {saveVenuesMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : venueSaved ? <Check className="w-3.5 h-3.5" /> : null}
                Save venues
              </button>
            </div>
          </SectionCard>
        )}

        {/* Items */}
        {!isNew && (
          <SectionCard title="Items">
            <div className="space-y-3">
              {items.length > 0 && (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                    {items.map(item => (
                      editingItem?.id === item.id ? (
                        <div key={item.id} className="flex items-center gap-2 py-2.5 border-b last:border-0">
                          <div className="p-1.5 shrink-0"><GripVertical className="w-4 h-4 text-muted-foreground opacity-30" /></div>
                          <input type="text" value={editingItem.name} onChange={e => setEditingItem(p => ({ ...p, name: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && editItemMutation.mutate(editingItem)}
                            className="flex-1 border rounded px-2 py-1.5 text-sm min-w-0 touch-manipulation" placeholder="Item name" autoFocus />
                          <input type="text" value={editingItem.unit} onChange={e => setEditingItem(p => ({ ...p, unit: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && editItemMutation.mutate(editingItem)}
                            className="w-20 border rounded px-2 py-1.5 text-sm touch-manipulation" placeholder="Unit" />
                          {showPrices && (
                            <input type="number" inputMode="decimal" min="0" step="0.01" value={editingItem.price ?? ''}
                              onChange={e => setEditingItem(p => ({ ...p, price: e.target.value !== '' ? Number(e.target.value) : null }))}
                              onKeyDown={e => e.key === 'Enter' && editItemMutation.mutate(editingItem)}
                              className="w-20 border rounded px-2 py-1.5 text-sm touch-manipulation" placeholder="Price" />
                          )}
                          <button onClick={() => editItemMutation.mutate(editingItem)} className="p-2 text-primary touch-manipulation"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditingItem(null)} className="p-2 text-muted-foreground touch-manipulation"><X className="w-4 h-4" /></button>
                        </div>
                      ) : deleteItemId === item.id ? (
                        <div key={item.id} className="flex items-center gap-2 py-2.5 border-b last:border-0">
                          <span className="text-sm text-red-600 flex-1">Delete "{item.name}"?</span>
                          <button onClick={() => deleteItemMutation.mutate(item.id)} disabled={deleteItemMutation.isPending}
                            className="text-xs bg-red-600 text-white rounded px-3 py-1.5 touch-manipulation min-h-[36px]">Delete</button>
                          <button onClick={() => setDeleteItemId(null)}
                            className="text-xs border rounded px-3 py-1.5 touch-manipulation min-h-[36px]">Cancel</button>
                        </div>
                      ) : (
                        <SortableItemRow key={item.id} item={item} showPrices={showPrices} onEdit={setEditingItem} onDelete={setDeleteItemId} />
                      )
                    ))}
                  </SortableContext>
                </DndContext>
              )}
              {items.length === 0 && <p className="text-sm text-muted-foreground py-2">No items yet — add one below.</p>}

              <div className="pt-3 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-2">Add item</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="text" value={newItemName} onChange={e => setNewItemName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addItemMutation.mutate()}
                    placeholder="Item name *" className="flex-1 min-w-[120px] border rounded-lg px-3 py-2 text-sm touch-manipulation min-h-[44px]" />
                  <input type="text" value={newItemUnit} onChange={e => setNewItemUnit(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addItemMutation.mutate()}
                    placeholder="Unit *" className="w-24 border rounded-lg px-3 py-2 text-sm touch-manipulation min-h-[44px]" />
                  {showPrices && (
                    <input type="number" inputMode="decimal" min="0" step="0.01" value={newItemPrice}
                      onChange={e => setNewItemPrice(e.target.value)}
                      placeholder="Price" className="w-24 border rounded-lg px-3 py-2 text-sm touch-manipulation min-h-[44px]" />
                  )}
                  <button onClick={() => { if (!newItemName.trim()) return setItemError('Name required'); if (!newItemUnit.trim()) return setItemError('Unit required'); addItemMutation.mutate() }}
                    disabled={addItemMutation.isPending}
                    className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px] disabled:opacity-50">
                    {addItemMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Add
                  </button>
                </div>
                {itemError && <p className="text-sm text-red-600 mt-1.5">{itemError}</p>}
              </div>
            </div>
          </SectionCard>
        )}

        {/* Suggested quantities */}
        {showSuggestedSection && (
          <SectionCard title="Suggested quantities">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Set a suggested quantity per item per venue to help staff when filling in orders.</p>
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="min-w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Item</th>
                      {assignedVenues.map(v => (
                        <th key={v.id} className="text-center py-2 px-2 text-xs font-medium text-muted-foreground whitespace-nowrap">{v.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id} className="border-b last:border-0">
                        <td className="py-2.5 pr-4 font-medium text-sm">{item.name}</td>
                        {assignedVenues.map(venue => (
                          <td key={venue.id} className="py-2.5 px-2 text-center">
                            <input type="number" inputMode="decimal" min="0" step="1"
                              value={(suggestedQtys[item.id] ?? {})[venue.id] ?? ''}
                              onChange={e => setSuggestedQtys(prev => ({ ...prev, [item.id]: { ...(prev[item.id] ?? {}), [venue.id]: e.target.value } }))}
                              className="w-20 h-10 text-center text-sm border rounded px-1 touch-manipulation" placeholder="0" />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {suggestError && <div className="flex items-center gap-2 text-sm text-red-600"><AlertCircle className="w-4 h-4 shrink-0" />{suggestError}</div>}
              <button onClick={saveSuggestedQtys}
                className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium touch-manipulation min-h-[44px]">
                {suggestSaved ? <Check className="w-3.5 h-3.5" /> : null}
                Save suggested quantities
              </button>
            </div>
          </SectionCard>
        )}

        {/* Delete template */}
        {!isNew && isAdmin && (
          <div className="pt-2 border-t">
            {!deleteConfirm ? (
              <button onClick={() => setDeleteConfirm(true)}
                className="text-sm text-red-600 underline-offset-2 hover:underline touch-manipulation py-2">
                Delete template
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-red-600 font-medium">Delete "{template?.name}"? This cannot be undone.</p>
                {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
                <div className="flex gap-3">
                  <button onClick={() => deleteTemplateMutation.mutate()} disabled={deleteTemplateMutation.isPending}
                    className="bg-red-600 text-white text-sm rounded-lg px-4 py-2.5 touch-manipulation min-h-[44px] disabled:opacity-50">
                    {deleteTemplateMutation.isPending ? 'Deleting…' : 'Yes, delete template'}
                  </button>
                  <button onClick={() => { setDeleteConfirm(false); setDeleteError('') }}
                    className="text-sm border rounded-lg px-4 py-2.5 touch-manipulation min-h-[44px]">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TemplateCard({ template, isSelected, onClick }) {
  return (
    <button onClick={onClick}
      className={cn('w-full text-left p-4 border-b last:border-0 hover:bg-accent/50 transition-colors touch-manipulation', isSelected && 'bg-accent')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{template.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {template.item_count} item{template.item_count !== 1 ? 's' : ''} · {(template.venue_ids ?? []).length} venue{(template.venue_ids ?? []).length !== 1 ? 's' : ''}
          </p>
          {(template.delivery_days ?? []).length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {DAY_ORDER.filter(d => (template.delivery_days ?? []).includes(d)).map(d => DAY_LABELS[d]).join(', ')}
            </p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {template.show_prices && <span className="text-[10px] bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">Prices</span>}
          <span className={cn('text-[10px] rounded-full px-2 py-0.5', template.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
            {template.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>
    </button>
  )
}

export default function OrderSheetTemplates() {
  const api = useApi()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState(null)
  const [panelWidth, setPanelWidth] = useState(500)

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/api/me'), staleTime: 120_000 })
  const isAdmin = me?.role === 'admin' || me?.role === 'owner'

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['order-sheets', 'templates'],
    queryFn:  () => api.get('/order-sheets/templates'),
  })

  const handleResizeStart = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX; const startWidth = panelWidth
    function onMove(e2) { setPanelWidth(Math.min(700, Math.max(320, startWidth - (e2.clientX - startX)))) }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }, [panelWidth])

  function handleSaved(newTemplate) {
    queryClient.invalidateQueries(['order-sheets', 'templates'])
    if (newTemplate?.id) setSelectedId(newTemplate.id)
  }

  function handleDeleted() {
    queryClient.invalidateQueries(['order-sheets', 'templates'])
    setSelectedId(null)
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className={cn('flex flex-col border-r bg-background overflow-hidden', selectedId ? 'hidden md:flex md:w-72 lg:w-80 shrink-0' : 'flex-1')}>
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-muted-foreground" />
            <h1 className="font-semibold text-sm">Order Sheet Templates</h1>
          </div>
          {isAdmin && (
            <button onClick={() => setSelectedId('__new__')}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium touch-manipulation min-h-[40px]">
              <Plus className="w-3.5 h-3.5" />New
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : templates.length === 0 && !selectedId ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <ClipboardList className="w-8 h-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No templates yet</p>
              {isAdmin && <p className="text-xs text-muted-foreground mt-1">Create a template to get started</p>}
            </div>
          ) : (
            <>
              {selectedId === '__new__' && (
                <div className="px-4 py-3 border-b bg-primary/5 text-xs font-medium text-primary">New template (unsaved)</div>
              )}
              {templates.map(t => (
                <TemplateCard key={t.id} template={t} isSelected={t.id === selectedId} onClick={() => setSelectedId(t.id)} />
              ))}
            </>
          )}
        </div>
      </div>

      {selectedId && (
        <>
          <div onMouseDown={handleResizeStart} className="hidden md:block w-1 cursor-col-resize bg-border hover:bg-primary/30 transition-colors shrink-0" />
          <div className="flex-1 md:flex-none flex flex-col bg-background overflow-hidden"
            style={{ width: typeof window !== 'undefined' && window.innerWidth >= 768 ? panelWidth : undefined }}>
            <TemplateEditor
              key={selectedId}
              templateId={selectedId}
              isAdmin={isAdmin}
              onClose={() => setSelectedId(null)}
              onSaved={handleSaved}
              onDeleted={handleDeleted}
            />
          </div>
        </>
      )}
    </div>
  )
}
