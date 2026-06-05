// src/pages/OrderSheetTemplates.jsx
import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical, Plus, Trash2, X, ClipboardList, Loader2,
  Check, ChevronRight, Pencil,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApi } from '@/lib/api'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
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

// ── Category row (sortable) ────────────────────────────────────────────────────

function SortableCategoryRow({ category, onSave, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(category.name)

  function handleSave() {
    const trimmed = editName.trim()
    if (!trimmed) return
    onSave(category.id, trimmed)
    setEditing(false)
  }

  function handleCancel() {
    setEditName(category.name)
    setEditing(false)
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 py-2 border-b last:border-0">
      <button {...attributes} {...listeners}
        className="p-1.5 text-muted-foreground cursor-grab active:cursor-grabbing touch-manipulation shrink-0">
        <GripVertical className="w-4 h-4" />
      </button>
      {editing ? (
        <>
          <input
            type="text"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel() }}
            className="flex-1 border rounded px-2 py-1 text-sm touch-manipulation min-h-[36px]"
            autoFocus
          />
          <button onClick={handleSave}
            className="p-1.5 text-primary touch-manipulation" title="Save">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleCancel}
            className="p-1.5 text-muted-foreground touch-manipulation" title="Cancel">
            <X className="w-3.5 h-3.5" />
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm">{category.name}</span>
          <button onClick={() => setEditing(true)}
            className="p-1.5 text-muted-foreground hover:text-foreground touch-manipulation" title="Rename">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(category.id)}
            className="p-1.5 text-muted-foreground hover:text-red-600 touch-manipulation" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

// ── Item row (sortable) ────────────────────────────────────────────────────────

function SortableItemRow({ item, showPrices, suggestedByVenue, assignedVenues, onEdit, onDelete, checked, onCheck }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  const suggestedSummary = assignedVenues
    .filter(v => (suggestedByVenue[v.id] ?? '') !== '' && Number(suggestedByVenue[v.id]) > 0)
    .map(v => `${v.name}: ${suggestedByVenue[v.id]}`)
    .join(' · ')

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 py-2.5 border-b last:border-0">
      <div
        className="flex items-center px-1 cursor-pointer touch-manipulation shrink-0"
        onClick={e => { e.stopPropagation(); onCheck(item.id) }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onCheck(item.id)}
          onClick={e => e.stopPropagation()}
          className="w-4 h-4 rounded cursor-pointer"
        />
      </div>
      <button {...attributes} {...listeners}
        className="p-1.5 text-muted-foreground cursor-grab active:cursor-grabbing touch-manipulation shrink-0">
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{item.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">{item.unit}</span>
          {showPrices && item.price != null && (
            <span className="text-xs text-muted-foreground shrink-0">£{Number(item.price).toFixed(2)}</span>
          )}
          {item.category_name && (
            <span className="text-[10px] bg-primary/10 text-primary rounded-full px-2 py-0.5 shrink-0">
              {item.category_name}
            </span>
          )}
        </div>
        {suggestedSummary && (
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{suggestedSummary}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => onEdit(item)}
          className="p-2 rounded hover:bg-accent text-muted-foreground touch-manipulation" title="Edit">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDelete(item.id)}
          className="p-2 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 touch-manipulation" title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Merge Dialog ───────────────────────────────────────────────────────────────

function MergeDialog({ selectedTemplates, onClose, onMerged }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [primaryId, setPrimaryId] = useState(selectedTemplates[0]?.id ?? '')
  const [mergeName, setMergeName] = useState(selectedTemplates[0]?.name ?? '')
  const [error, setError] = useState('')

  useEffect(() => {
    const t = selectedTemplates.find(t => t.id === primaryId)
    if (t) setMergeName(t.name)
  }, [primaryId]) // eslint-disable-line react-hooks/exhaustive-deps

  const mergeMutation = useMutation({
    mutationFn: () => api.post('/order-sheets/templates/merge', {
      primary_id:    primaryId,
      secondary_ids: selectedTemplates.filter(t => t.id !== primaryId).map(t => t.id),
      name:          mergeName.trim() || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['order-sheets', 'templates'])
      onMerged(primaryId)
    },
    onError: (err) => setError(err?.message ?? 'Merge failed'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-base font-semibold">Merge Templates</h2>
          <button onClick={onClose} className="p-2 rounded hover:bg-accent text-muted-foreground touch-manipulation">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Select the primary template to keep. All items from the other templates will be copied into it, then those templates deleted.
          </p>

          <div className="space-y-2">
            {selectedTemplates.map(t => (
              <label
                key={t.id}
                className={cn(
                  'flex items-center gap-3 cursor-pointer p-3 rounded-lg border transition-colors touch-manipulation min-h-[52px] hover:bg-accent/50',
                  primaryId === t.id && 'border-primary bg-primary/5',
                )}
              >
                <input
                  type="radio" name="primary" value={t.id}
                  checked={primaryId === t.id}
                  onChange={() => setPrimaryId(t.id)}
                  className="w-4 h-4"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.item_count ?? 0} items</p>
                </div>
                {primaryId === t.id && (
                  <span className="text-xs text-primary font-medium shrink-0">Primary</span>
                )}
              </label>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Name for merged template</label>
            <input
              type="text"
              value={mergeName}
              onChange={e => setMergeName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2.5 text-sm touch-manipulation min-h-[44px]"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border rounded-lg py-2.5 text-sm font-medium touch-manipulation min-h-[48px]">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => mergeMutation.mutate()}
              disabled={mergeMutation.isPending}
              className="flex-1 bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-medium touch-manipulation min-h-[48px] disabled:opacity-50"
            >
              {mergeMutation.isPending ? 'Merging…' : `Merge ${selectedTemplates.length} templates`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Template Editor ────────────────────────────────────────────────────────────

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

  // ── Basic info state ─────────────────────────────────────────────────────────
  const [name, setName]                 = useState('')
  const [showPrices, setShowPrices]     = useState(false)
  const [isActive, setIsActive]         = useState(true)
  const [deliveryDays, setDeliveryDays] = useState([])
  const [basicError, setBasicError]     = useState('')
  const [basicSaved, setBasicSaved]     = useState(false)

  const [venueIds, setVenueIds]     = useState([])
  const [venueError, setVenueError] = useState('')
  const [venueSaved, setVenueSaved] = useState(false)

  // ── Categories state ─────────────────────────────────────────────────────────
  const [categories, setCategories]   = useState([])
  const [newCatName, setNewCatName]   = useState('')
  const [catError, setCatError]       = useState('')

  // ── Items state ──────────────────────────────────────────────────────────────
  const [items, setItems]                       = useState([])
  const [editingItem, setEditingItem]           = useState(null)
  const [newItemName, setNewItemName]           = useState('')
  const [newItemUnit, setNewItemUnit]           = useState('')
  const [newItemPrice, setNewItemPrice]         = useState('')
  const [newItemCategoryId, setNewItemCategoryId] = useState('')
  const [itemError, setItemError]               = useState('')
  const [deleteItemId, setDeleteItemId]         = useState(null)

  const [suggestedQtys, setSuggestedQtys] = useState({})

  // ── Bulk item actions state ──────────────────────────────────────────────────
  const [checkedItemIds, setCheckedItemIds]         = useState(new Set())
  const [bulkItemDeleteConfirm, setBulkItemDeleteConfirm] = useState(false)
  const [bulkItemError, setBulkItemError]           = useState('')
  const selectAllRef = useRef(null)

  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteError, setDeleteError]     = useState('')

  // Sync select-all indeterminate state
  useEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current.indeterminate = checkedItemIds.size > 0 && checkedItemIds.size < items.length
  }, [checkedItemIds.size, items.length])

  useEffect(() => {
    if (!template) return
    setName(template.name ?? '')
    setShowPrices(template.show_prices ?? false)
    setIsActive(template.is_active ?? true)
    setDeliveryDays(template.delivery_days ?? [])
    setVenueIds(template.venue_ids ?? [])
    setCategories(template.categories ?? [])
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

  // ── Category drag ────────────────────────────────────────────────────────────
  function handleCategoryDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const reordered = arrayMove(
      categories,
      categories.findIndex(c => c.id === active.id),
      categories.findIndex(c => c.id === over.id),
    )
    setCategories(reordered)
    api.patch(`/order-sheets/templates/${templateId}/category-order`, { ids: reordered.map(c => c.id) })
      .then(() => queryClient.invalidateQueries(['order-sheets', 'templates']))
      .catch(() => {})
  }

  // ── Item drag ────────────────────────────────────────────────────────────────
  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const reordered = arrayMove(items, items.findIndex(i => i.id === active.id), items.findIndex(i => i.id === over.id))
    setItems(reordered)
    api.patch(`/order-sheets/templates/${templateId}/item-order`, { ids: reordered.map(i => i.id) })
      .then(() => queryClient.invalidateQueries(['order-sheets', 'templates']))
      .catch(() => {})
  }

  // ── Category mutations ───────────────────────────────────────────────────────
  const addCategoryMutation = useMutation({
    mutationFn: () => api.post(`/order-sheets/templates/${templateId}/categories`, { name: newCatName.trim() }),
    onSuccess: (cat) => {
      setCategories(prev => [...prev, cat])
      setNewCatName('')
      setCatError('')
      queryClient.invalidateQueries(['order-sheets', 'templates', templateId])
    },
    onError: (err) => setCatError(err?.message ?? 'Add failed'),
  })

  const editCategoryMutation = useMutation({
    mutationFn: ({ id, name }) => api.patch(`/order-sheets/templates/${templateId}/categories/${id}`, { name }),
    onSuccess: (cat) => {
      setCategories(prev => prev.map(c => c.id === cat.id ? cat : c))
      queryClient.invalidateQueries(['order-sheets', 'templates', templateId])
    },
  })

  const deleteCategoryMutation = useMutation({
    mutationFn: (catId) => api.delete(`/order-sheets/templates/${templateId}/categories/${catId}`),
    onSuccess: (_, catId) => {
      setCategories(prev => prev.filter(c => c.id !== catId))
      setItems(prev => prev.map(i => i.category_id === catId ? { ...i, category_id: null, category_name: null } : i))
      queryClient.invalidateQueries(['order-sheets', 'templates', templateId])
    },
  })

  // ── Basic / venue mutations ──────────────────────────────────────────────────
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

  // ── Item mutations ───────────────────────────────────────────────────────────
  const addItemMutation = useMutation({
    mutationFn: () => api.post(`/order-sheets/templates/${templateId}/items`, {
      name:        newItemName.trim(),
      unit:        newItemUnit.trim(),
      price:       newItemPrice !== '' ? Number(newItemPrice) : null,
      category_id: newItemCategoryId || null,
    }),
    onSuccess: (item) => {
      setItems(prev => [...prev, item])
      setSuggestedQtys(prev => ({ ...prev, [item.id]: {} }))
      setNewItemName(''); setNewItemUnit(''); setNewItemPrice(''); setNewItemCategoryId(''); setItemError('')
      queryClient.invalidateQueries(['order-sheets', 'templates'])
    },
    onError: (err) => setItemError(err?.message ?? 'Add failed'),
  })

  const editItemMutation = useMutation({
    mutationFn: async (item) => {
      const updated = await api.patch(`/order-sheets/templates/${templateId}/items/${item.id}`, {
        name:        item.name,
        unit:        item.unit,
        price:       item.price ?? null,
        category_id: item.category_id ?? null,
      })
      if (assignedVenues.length > 0) {
        const venueQtys = assignedVenues.map(v => ({
          venue_id: v.id,
          qty: Number((suggestedQtys[item.id] ?? {})[v.id] ?? 0) || 0,
        }))
        await api.put(`/order-sheets/templates/${templateId}/items/${item.id}/suggested`, { venue_qtys: venueQtys })
      }
      return updated
    },
    onSuccess: (updated) => {
      setItems(prev => prev.map(i => i.id === updated.id ? updated : i))
      setEditingItem(null)
      queryClient.invalidateQueries(['order-sheets', 'templates'])
    },
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

  // ── Bulk item mutations ──────────────────────────────────────────────────────
  const bulkDeleteItemsMutation = useMutation({
    mutationFn: () => api.delete(`/order-sheets/templates/${templateId}/items/bulk`, { ids: [...checkedItemIds] }),
    onSuccess: () => {
      const deleted = new Set(checkedItemIds)
      setItems(prev => prev.filter(i => !deleted.has(i.id)))
      setSuggestedQtys(prev => {
        const next = { ...prev }
        for (const id of deleted) delete next[id]
        return next
      })
      setCheckedItemIds(new Set())
      setBulkItemDeleteConfirm(false)
      setBulkItemError('')
      queryClient.invalidateQueries(['order-sheets', 'templates'])
    },
    onError: (err) => setBulkItemError(err?.message ?? 'Delete failed'),
  })

  const bulkAssignCategoryMutation = useMutation({
    mutationFn: (category_id) => api.patch(`/order-sheets/templates/${templateId}/items/bulk-category`, {
      ids: [...checkedItemIds],
      category_id: category_id || null,
    }),
    onSuccess: (_, category_id) => {
      const cat = categories.find(c => c.id === category_id) ?? null
      setItems(prev => prev.map(i =>
        checkedItemIds.has(i.id)
          ? { ...i, category_id: category_id || null, category_name: cat?.name ?? null }
          : i
      ))
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

  function toggleDeliveryDay(day) {
    setDeliveryDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
  }

  function toggleItemCheck(id) {
    setCheckedItemIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const assignedVenues = allVenues.filter(v => venueIds.includes(v.id))

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

        {/* Categories */}
        {!isNew && (
          <SectionCard title="Categories">
            <div className="space-y-1">
              {categories.length > 0 ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCategoryDragEnd}>
                  <SortableContext items={categories.map(c => c.id)} strategy={verticalListSortingStrategy}>
                    {categories.map(cat => (
                      <SortableCategoryRow
                        key={cat.id}
                        category={cat}
                        onSave={(id, name) => editCategoryMutation.mutate({ id, name })}
                        onDelete={(id) => deleteCategoryMutation.mutate(id)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              ) : (
                <p className="text-sm text-muted-foreground py-1 mb-2">No categories yet — items will be ungrouped.</p>
              )}

              {/* Add category */}
              <div className={cn('flex gap-2', categories.length > 0 && 'pt-3 border-t mt-1')}>
                <input
                  type="text"
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && newCatName.trim() && addCategoryMutation.mutate()}
                  placeholder="Category name"
                  className="flex-1 border rounded-lg px-3 py-2 text-sm touch-manipulation min-h-[40px]"
                />
                <button
                  onClick={() => { if (!newCatName.trim()) return; addCategoryMutation.mutate() }}
                  disabled={addCategoryMutation.isPending || !newCatName.trim()}
                  className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium touch-manipulation min-h-[40px] disabled:opacity-50"
                >
                  {addCategoryMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Add
                </button>
              </div>
              {catError && <p className="text-sm text-red-600 mt-1">{catError}</p>}
            </div>
          </SectionCard>
        )}

        {/* Items */}
        {!isNew && (
          <SectionCard title="Items">
            <div className="space-y-3">

              {/* Bulk action bar */}
              {checkedItemIds.size > 0 && (
                <div className="flex items-center gap-2 flex-wrap px-3 py-2.5 bg-primary/5 rounded-lg">
                  {!bulkItemDeleteConfirm ? (
                    <>
                      <span className="text-xs font-medium text-muted-foreground">{checkedItemIds.size} selected</span>
                      {categories.length > 0 && (
                        <select
                          disabled={bulkAssignCategoryMutation.isPending}
                          onChange={e => {
                            const v = e.target.value
                            if (v === '__placeholder__') return
                            bulkAssignCategoryMutation.mutate(v === '__none__' ? null : v)
                            e.target.value = '__placeholder__'
                          }}
                          defaultValue="__placeholder__"
                          className="text-xs border rounded-lg px-2 py-1.5 touch-manipulation min-h-[32px] disabled:opacity-50"
                        >
                          <option value="__placeholder__" disabled>Category…</option>
                          <option value="__none__">— No category</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      )}
                      <button
                        onClick={() => setBulkItemDeleteConfirm(true)}
                        className="text-xs bg-red-600 text-white rounded-lg px-3 py-1.5 touch-manipulation min-h-[32px]"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setCheckedItemIds(new Set())}
                        className="text-xs border rounded-lg px-3 py-1.5 touch-manipulation min-h-[32px] text-muted-foreground"
                      >
                        Clear
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-red-600 font-medium flex-1">
                        Delete {checkedItemIds.size} item{checkedItemIds.size !== 1 ? 's' : ''}?
                      </span>
                      {bulkItemError && <span className="text-xs text-red-600">{bulkItemError}</span>}
                      <button
                        onClick={() => bulkDeleteItemsMutation.mutate()}
                        disabled={bulkDeleteItemsMutation.isPending}
                        className="text-xs bg-red-600 text-white rounded-lg px-3 py-1.5 touch-manipulation min-h-[32px] disabled:opacity-50"
                      >
                        {bulkDeleteItemsMutation.isPending ? 'Deleting…' : 'Yes, delete'}
                      </button>
                      <button
                        onClick={() => { setBulkItemDeleteConfirm(false); setBulkItemError('') }}
                        className="text-xs border rounded-lg px-3 py-1.5 touch-manipulation min-h-[32px]"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Select all */}
              {items.length > 0 && (
                <div className="flex items-center gap-2 px-1">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={checkedItemIds.size === items.length && items.length > 0}
                    onChange={e => setCheckedItemIds(e.target.checked ? new Set(items.map(i => i.id)) : new Set())}
                    className="w-4 h-4 rounded cursor-pointer"
                  />
                  <span className="text-xs text-muted-foreground">Select all</span>
                </div>
              )}

              {/* Item list */}
              {items.length > 0 && (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                    {items.map(item => (
                      editingItem?.id === item.id ? (
                        <div key={item.id} className="py-2.5 border-b last:border-0 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="p-1.5 shrink-0"><GripVertical className="w-4 h-4 text-muted-foreground opacity-30" /></div>
                            <input type="text" value={editingItem.name} onChange={e => setEditingItem(p => ({ ...p, name: e.target.value }))}
                              className="flex-1 min-w-[100px] border rounded px-2 py-1.5 text-sm touch-manipulation" placeholder="Item name" autoFocus />
                            <input type="text" value={editingItem.unit} onChange={e => setEditingItem(p => ({ ...p, unit: e.target.value }))}
                              className="w-20 border rounded px-2 py-1.5 text-sm touch-manipulation" placeholder="Unit" />
                            {showPrices && (
                              <input type="number" inputMode="decimal" min="0" step="0.01" value={editingItem.price ?? ''}
                                onChange={e => setEditingItem(p => ({ ...p, price: e.target.value !== '' ? Number(e.target.value) : null }))}
                                className="w-20 border rounded px-2 py-1.5 text-sm touch-manipulation" placeholder="Price" />
                            )}
                            {categories.length > 0 && (
                              <select
                                value={editingItem.category_id ?? ''}
                                onChange={e => setEditingItem(p => ({ ...p, category_id: e.target.value || null }))}
                                className="w-32 border rounded px-2 py-1.5 text-sm touch-manipulation"
                              >
                                <option value="">No category</option>
                                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            )}
                            <button onClick={() => editItemMutation.mutate(editingItem)} disabled={editItemMutation.isPending}
                              className="p-2 text-primary touch-manipulation disabled:opacity-50">
                              {editItemMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <button onClick={() => setEditingItem(null)} className="p-2 text-muted-foreground touch-manipulation"><X className="w-4 h-4" /></button>
                          </div>
                          {assignedVenues.length > 0 && (
                            <div className="ml-8 flex flex-wrap gap-x-4 gap-y-1.5 items-center pb-1">
                              <span className="text-xs text-muted-foreground font-medium shrink-0">Suggested qty:</span>
                              {assignedVenues.map(v => (
                                <div key={v.id} className="flex items-center gap-1.5">
                                  <span className="text-xs text-muted-foreground">{v.name}</span>
                                  <input type="number" inputMode="decimal" min="0" step="1"
                                    value={(suggestedQtys[item.id] ?? {})[v.id] ?? ''}
                                    onChange={e => setSuggestedQtys(prev => ({ ...prev, [item.id]: { ...(prev[item.id] ?? {}), [v.id]: e.target.value } }))}
                                    className="w-16 h-8 text-center text-sm border rounded px-1 touch-manipulation" placeholder="0" />
                                </div>
                              ))}
                            </div>
                          )}
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
                        <SortableItemRow key={item.id} item={item} showPrices={showPrices}
                          suggestedByVenue={suggestedQtys[item.id] ?? {}} assignedVenues={assignedVenues}
                          onEdit={setEditingItem} onDelete={setDeleteItemId}
                          checked={checkedItemIds.has(item.id)} onCheck={toggleItemCheck} />
                      )
                    ))}
                  </SortableContext>
                </DndContext>
              )}
              {items.length === 0 && <p className="text-sm text-muted-foreground py-2">No items yet — add one below.</p>}

              {/* Add item */}
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
                  {categories.length > 0 && (
                    <select
                      value={newItemCategoryId}
                      onChange={e => setNewItemCategoryId(e.target.value)}
                      className="w-36 border rounded-lg px-3 py-2 text-sm touch-manipulation min-h-[44px]"
                    >
                      <option value="">No category</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                  <button
                    onClick={() => {
                      if (!newItemName.trim()) return setItemError('Name required')
                      if (!newItemUnit.trim()) return setItemError('Unit required')
                      addItemMutation.mutate()
                    }}
                    disabled={addItemMutation.isPending}
                    className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px] disabled:opacity-50"
                  >
                    {addItemMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Add
                  </button>
                </div>
                {itemError && <p className="text-sm text-red-600 mt-1.5">{itemError}</p>}
              </div>
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

// ── Template Card ──────────────────────────────────────────────────────────────

function TemplateCard({ template, isSelected, onClick, checked, onCheck }) {
  return (
    <div className={cn('border-b last:border-0 transition-colors', isSelected && 'bg-accent')}>
      <div className="flex items-stretch">
        {/* Checkbox */}
        <div
          className="flex items-center px-3 cursor-pointer touch-manipulation"
          onClick={e => { e.stopPropagation(); onCheck(template.id) }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onCheck(template.id)}
            onClick={e => e.stopPropagation()}
            className="w-4 h-4 rounded cursor-pointer"
          />
        </div>
        {/* Card body */}
        <button
          onClick={onClick}
          className="flex-1 text-left py-4 pr-4 hover:bg-accent/50 transition-colors touch-manipulation"
        >
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
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function OrderSheetTemplates() {
  const api = useApi()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState(null)
  const [panelWidth, setPanelWidth] = useState(500)

  const [checkedIds, setCheckedIds]               = useState(new Set())
  const [showMergeDialog, setShowMergeDialog]     = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [bulkError, setBulkError]                 = useState('')

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 120_000 })
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

  function toggleCheck(id) {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const bulkDeleteMutation = useMutation({
    mutationFn: () => api.delete('/order-sheets/templates/bulk', { ids: [...checkedIds] }),
    onSuccess: () => {
      queryClient.invalidateQueries(['order-sheets', 'templates'])
      if (checkedIds.has(selectedId)) setSelectedId(null)
      setCheckedIds(new Set())
      setBulkDeleteConfirm(false)
      setBulkError('')
    },
    onError: (err) => setBulkError(err?.message ?? 'Delete failed'),
  })

  function handleSaved(newTemplate) {
    queryClient.invalidateQueries(['order-sheets', 'templates'])
    if (newTemplate?.id) setSelectedId(newTemplate.id)
  }

  function handleDeleted() {
    queryClient.invalidateQueries(['order-sheets', 'templates'])
    setSelectedId(null)
  }

  function handleMerged(primaryId) {
    setShowMergeDialog(false)
    setCheckedIds(new Set())
    setSelectedId(primaryId)
  }

  const checkedTemplates = templates.filter(t => checkedIds.has(t.id))

  return (
    <div className="flex h-full overflow-hidden">

      {/* Left column */}
      <div className={cn('flex flex-col border-r bg-background overflow-hidden', selectedId ? 'hidden md:flex md:w-72 lg:w-80 shrink-0' : 'flex-1')}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-muted-foreground" />
            <h1 className="font-semibold text-sm">Order Sheet Templates</h1>
          </div>
          {isAdmin && (
            <button
              onClick={() => setSelectedId('__new__')}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium touch-manipulation min-h-[40px]"
            >
              <Plus className="w-3.5 h-3.5" />New
            </button>
          )}
        </div>

        {/* Bulk action bar */}
        {checkedIds.size > 0 && isAdmin && (
          <div className="px-3 py-2.5 border-b bg-primary/5 shrink-0">
            {!bulkDeleteConfirm ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground">
                  {checkedIds.size} selected
                </span>
                <button
                  onClick={() => setShowMergeDialog(true)}
                  disabled={checkedIds.size < 2}
                  className="text-xs bg-primary text-primary-foreground rounded-lg px-3 py-1.5 touch-manipulation min-h-[32px] disabled:opacity-40"
                >
                  Merge
                </button>
                <button
                  onClick={() => { setBulkError(''); setBulkDeleteConfirm(true) }}
                  className="text-xs bg-red-600 text-white rounded-lg px-3 py-1.5 touch-manipulation min-h-[32px]"
                >
                  Delete
                </button>
                <button
                  onClick={() => setCheckedIds(new Set())}
                  className="text-xs border rounded-lg px-3 py-1.5 touch-manipulation min-h-[32px] text-muted-foreground"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-medium text-red-600">
                  Delete {checkedIds.size} template{checkedIds.size !== 1 ? 's' : ''}? This cannot be undone.
                </p>
                {bulkError && <p className="text-xs text-red-600">{bulkError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => bulkDeleteMutation.mutate()}
                    disabled={bulkDeleteMutation.isPending}
                    className="text-xs bg-red-600 text-white rounded-lg px-3 py-1.5 touch-manipulation min-h-[32px] disabled:opacity-50"
                  >
                    {bulkDeleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    onClick={() => { setBulkDeleteConfirm(false); setBulkError('') }}
                    className="text-xs border rounded-lg px-3 py-1.5 touch-manipulation min-h-[32px]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Template list */}
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
                <TemplateCard
                  key={t.id}
                  template={t}
                  isSelected={t.id === selectedId}
                  onClick={() => setSelectedId(t.id)}
                  checked={checkedIds.has(t.id)}
                  onCheck={toggleCheck}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Editor panel */}
      {selectedId && (
        <>
          <div onMouseDown={handleResizeStart} className="hidden md:block w-1 cursor-col-resize bg-border hover:bg-primary/30 transition-colors shrink-0" />
          <div
            className="flex-1 md:flex-none flex flex-col bg-background overflow-hidden"
            style={{ width: typeof window !== 'undefined' && window.innerWidth >= 768 ? panelWidth : undefined }}
          >
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

      {/* Merge dialog */}
      {showMergeDialog && checkedTemplates.length >= 2 && (
        <MergeDialog
          selectedTemplates={checkedTemplates}
          onClose={() => setShowMergeDialog(false)}
          onMerged={handleMerged}
        />
      )}
    </div>
  )
}
