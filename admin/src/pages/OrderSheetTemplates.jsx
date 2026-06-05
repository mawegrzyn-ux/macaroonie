// src/pages/OrderSheetTemplates.jsx
// Full-page Excel-like order sheet template editor.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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
  Check, Settings, Tag, ChevronDown, AlertCircle, List, GitMerge,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useApi } from '@/lib/api'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_ORDER  = [1, 2, 3, 4, 5, 6, 0]

// ── Inline cell components ────────────────────────────────────────────────────

function InlineText({ value, onSave, placeholder = '—', className, type = 'text', inputMode, required }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function beginEdit() {
    setDraft(value ?? '')
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const v = type === 'number'
      ? (draft === '' ? null : Number(draft))
      : draft.trim() || null
    const prev = value ?? null
    if (v !== prev) onSave(v)
  }

  if (!editing) return (
    <div
      onClick={beginEdit}
      className={cn(
        'min-h-[36px] flex items-center px-2 cursor-text select-none',
        !value && 'text-muted-foreground text-xs italic',
        className,
      )}
    >
      {value !== null && value !== undefined && value !== '' ? (
        type === 'number' && value != null ? Number(value).toString() : value
      ) : placeholder}
    </div>
  )

  return (
    <input
      type={type}
      inputMode={inputMode}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        if (e.key === 'Escape') { setEditing(false); setDraft(value ?? '') }
      }}
      autoFocus
      className={cn(
        'w-full min-h-[36px] px-2 bg-primary/5 border-b-2 border-primary outline-none text-sm',
        className,
      )}
    />
  )
}

function InlineSelect({ value, onSave, options, className }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onSave(e.target.value || null)}
      className={cn(
        'w-full min-h-[36px] px-2 bg-transparent outline-none text-sm cursor-pointer',
        !value && 'text-muted-foreground',
        className,
      )}
    >
      <option value="">—</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function SugQtyCell({ value, onSave }) {
  const [v, setV] = useState(value ?? '')
  const committedRef = useRef(value)

  useEffect(() => {
    if (!document.activeElement || document.activeElement.tagName !== 'INPUT') {
      setV(value ?? '')
      committedRef.current = value
    }
  }, [value])

  return (
    <input
      type="number"
      inputMode="decimal"
      min="0"
      value={v}
      onChange={e => setV(e.target.value)}
      onFocus={() => { committedRef.current = v }}
      onBlur={() => {
        const n = v === '' ? null : Number(v)
        if (n !== committedRef.current) {
          committedRef.current = n
          onSave(n)
        }
      }}
      className="w-full min-h-[36px] text-right px-2 bg-transparent outline-none border-b border-transparent focus:border-primary focus:bg-primary/5 text-sm"
    />
  )
}

// ── Sortable item row ─────────────────────────────────────────────────────────

function SortableItemRow({
  item, showPrices, assignedVenues, categories, suggestedQtys,
  checked, onCheck, onSaveField, onSaveSugQty, onDelete, colTemplate,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    display: 'grid',
    gridTemplateColumns: colTemplate,
    alignItems: 'stretch',
  }

  return (
    <div ref={setNodeRef} style={style} className={cn('border-b group hover:bg-muted/20', isDragging && 'bg-accent shadow-sm')}>
      {/* Checkbox */}
      <div className="flex items-center justify-center px-1">
        <input type="checkbox" checked={checked} onChange={() => onCheck(item.id)}
          className="w-4 h-4 rounded cursor-pointer" />
      </div>
      {/* Drag */}
      <div className="flex items-center justify-center">
        <button {...attributes} {...listeners}
          className="p-1 text-muted-foreground cursor-grab active:cursor-grabbing touch-manipulation">
          <GripVertical className="w-4 h-4" />
        </button>
      </div>
      {/* Name */}
      <div className="border-r">
        <InlineText
          value={item.name}
          onSave={v => v && onSaveField(item.id, 'name', v)}
          placeholder="Item name"
        />
      </div>
      {/* Unit */}
      <div className="border-r">
        <InlineText
          value={item.unit}
          onSave={v => v && onSaveField(item.id, 'unit', v)}
          placeholder="Unit"
        />
      </div>
      {/* Price */}
      {showPrices && (
        <div className="border-r">
          <InlineText
            type="number"
            inputMode="decimal"
            value={item.price != null ? String(item.price) : ''}
            onSave={v => onSaveField(item.id, 'price', v)}
            placeholder="—"
          />
        </div>
      )}
      {/* Category */}
      <div className="border-r">
        <InlineSelect
          value={item.category_id}
          onSave={v => onSaveField(item.id, 'category_id', v)}
          options={categories.map(c => ({ value: c.id, label: c.name }))}
        />
      </div>
      {/* Sug qty per venue */}
      {assignedVenues.map(v => (
        <div key={v.id} className="border-r last:border-r-0">
          <SugQtyCell
            value={suggestedQtys[item.id]?.[v.id] ?? ''}
            onSave={(qty) => onSaveSugQty(item.id, v.id, qty)}
          />
        </div>
      ))}
      {/* Delete */}
      <div className="flex items-center justify-center">
        <button onClick={() => onDelete(item.id)}
          className="p-1.5 text-muted-foreground hover:text-red-600 touch-manipulation opacity-0 group-hover:opacity-100 transition-opacity">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Draft new item row ────────────────────────────────────────────────────────

function DraftItemRow({ showPrices, assignedVenues, categories, onSave, onCancel, colTemplate }) {
  const [name, setName]           = useState('')
  const [unit, setUnit]           = useState('')
  const [price, setPrice]         = useState('')
  const [categoryId, setCategoryId] = useState('')

  function handleSave() {
    if (!name.trim() || !unit.trim()) return
    onSave({ name: name.trim(), unit: unit.trim(), price: price !== '' ? Number(price) : null, category_id: categoryId || null })
  }

  const cellInput = 'w-full min-h-[36px] px-2 bg-transparent outline-none text-sm border-b border-primary'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: colTemplate, alignItems: 'stretch' }}
      className="border-b bg-primary/5">
      <div className="flex items-center justify-center px-1">
        <div className="w-4 h-4" />
      </div>
      <div className="flex items-center justify-center">
        <div className="w-4 h-4" />
      </div>
      <div className="border-r">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel() }}
          placeholder="Item name *"
          autoFocus
          className={cellInput}
        />
      </div>
      <div className="border-r">
        <input
          type="text"
          value={unit}
          onChange={e => setUnit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel() }}
          placeholder="Unit *"
          className={cellInput}
        />
      </div>
      {showPrices && (
        <div className="border-r">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={price}
            onChange={e => setPrice(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel() }}
            placeholder="Price"
            className={cellInput}
          />
        </div>
      )}
      <div className="border-r">
        <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
          className="w-full min-h-[36px] px-2 bg-transparent outline-none text-sm border-b border-primary">
          <option value="">No category</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {assignedVenues.map(v => <div key={v.id} className="border-r last:border-r-0" />)}
      <div className="flex items-center gap-1 justify-center px-1">
        <button onClick={handleSave} disabled={!name.trim() || !unit.trim()}
          className="p-1.5 text-primary touch-manipulation disabled:opacity-30">
          <Check className="w-4 h-4" />
        </button>
        <button onClick={onCancel} className="p-1.5 text-muted-foreground touch-manipulation">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ── Settings panel ────────────────────────────────────────────────────────────

function SettingsPanel({ template, allVenues, onClose }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [name, setName]                 = useState(template.name ?? '')
  const [showPrices, setShowPrices]     = useState(template.show_prices ?? false)
  const [isActive, setIsActive]         = useState(template.is_active ?? true)
  const [deliveryDays, setDeliveryDays] = useState(template.delivery_days ?? [])
  const [venueIds, setVenueIds]         = useState(template.venue_ids ?? [])
  const [error, setError]               = useState('')
  const [saved, setSaved]               = useState(false)

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.patch(`/order-sheets/templates/${template.id}`, {
        name: name.trim() || template.name,
        show_prices:   showPrices,
        is_active:     isActive,
        delivery_days: deliveryDays,
      })
      await api.put(`/order-sheets/templates/${template.id}/venues`, { venue_ids: venueIds })
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['order-sheets', 'templates'])
      queryClient.invalidateQueries(['order-sheets', 'templates', template.id])
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (err) => setError(err?.message ?? 'Save failed'),
  })

  function Toggle({ checked, onChange }) {
    return (
      <div onClick={() => onChange(!checked)}
        className={cn('relative w-9 h-5 rounded-full cursor-pointer touch-manipulation shrink-0 transition-colors',
          checked ? 'bg-primary' : 'bg-muted')}>
        <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5')} />
      </div>
    )
  }

  return (
    <div className="border-b bg-muted/20 px-4 py-3 space-y-3">
      <div className="flex flex-wrap gap-x-6 gap-y-3 items-end">
        {/* Name */}
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-xs font-medium text-muted-foreground">Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm touch-manipulation min-h-[36px] bg-background min-w-[160px]" />
        </div>
        {/* Toggles */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer touch-manipulation">
            <Toggle checked={isActive} onChange={setIsActive} />
            <span className="text-sm">Active</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer touch-manipulation">
            <Toggle checked={showPrices} onChange={setShowPrices} />
            <span className="text-sm">Show prices</span>
          </label>
        </div>
        {/* Delivery days */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Delivery days</label>
          <div className="flex gap-1.5 flex-wrap">
            {DAY_ORDER.map(day => (
              <button key={day} type="button"
                onClick={() => setDeliveryDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])}
                className={cn('px-2 py-1 rounded text-xs font-medium border touch-manipulation min-h-[32px] transition-colors',
                  deliveryDays.includes(day)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border'
                )}>
                {DAY_LABELS[day]}
              </button>
            ))}
          </div>
        </div>
        {/* Venues */}
        {allVenues.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Assign to stores</label>
            <div className="flex gap-3 flex-wrap">
              {allVenues.map(v => (
                <label key={v.id} className="flex items-center gap-1.5 cursor-pointer touch-manipulation min-h-[32px]">
                  <input type="checkbox" checked={venueIds.includes(v.id)}
                    onChange={e => setVenueIds(prev => e.target.checked ? [...prev, v.id] : prev.filter(id => id !== v.id))}
                    className="w-3.5 h-3.5 rounded" />
                  <span className="text-sm">{v.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {/* Save */}
        <div className="flex items-end gap-2">
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            onClick={() => { setError(''); saveMutation.mutate() }}
            disabled={saveMutation.isPending}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded px-3 py-1.5 text-sm font-medium touch-manipulation min-h-[36px] disabled:opacity-50"
          >
            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : null}
            Save settings
          </button>
          <button onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground touch-manipulation" title="Close settings">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OrderSheetTemplates() {
  const api = useApi()
  const queryClient = useQueryClient()

  // ── Editor state ────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState(null)
  const [showSettings, setShowSettings]   = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')
  const [showNewInput, setShowNewInput]   = useState(false)
  const [items, setItems]             = useState([])
  const [suggestedQtys, setSuggestedQtys] = useState({})
  const [checkedItemIds, setCheckedItemIds] = useState(new Set())
  const [bulkCatDeleteConfirm, setBulkCatDeleteConfirm] = useState(false)
  const [bulkError, setBulkError]     = useState('')
  const [showDraft, setShowDraft]     = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const selectAllRef = useRef(null)

  // ── Manage-templates state ──────────────────────────────────────────────────
  const [showManage, setShowManage]             = useState(false)
  const [checkedTemplateIds, setCheckedTemplateIds] = useState(new Set())
  const [bulkTplDeleteConfirm, setBulkTplDeleteConfirm] = useState(false)
  const [bulkTplError, setBulkTplError]         = useState('')
  const [mergePhase, setMergePhase]             = useState(null) // null | 'naming'
  const [mergeName, setMergeName]               = useState('')
  const manageSelectAllRef = useRef(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor),
  )

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 120_000 })
  const isAdmin = me?.role === 'admin' || me?.role === 'owner'

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['order-sheets', 'templates'],
    queryFn:  () => api.get('/order-sheets/templates'),
  })

  const { data: template, isLoading: tmplLoading } = useQuery({
    queryKey: ['order-sheets', 'templates', selectedId],
    queryFn:  () => api.get(`/order-sheets/templates/${selectedId}`),
    enabled:  !!selectedId,
  })

  const { data: allVenues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  // Initialise local state from template fetch
  useEffect(() => {
    if (!template) return
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
    setCheckedItemIds(new Set())
    setShowDraft(false)
    setBulkCatDeleteConfirm(false)
    setBulkError('')
  }, [template?.id, template?.updated_at]) // eslint-disable-line

  // Sync item select-all indeterminate state
  useEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current.indeterminate = checkedItemIds.size > 0 && checkedItemIds.size < items.length
  }, [checkedItemIds.size, items.length])

  // Sync template select-all indeterminate state
  useEffect(() => {
    if (!manageSelectAllRef.current) return
    manageSelectAllRef.current.indeterminate = checkedTemplateIds.size > 0 && checkedTemplateIds.size < templates.length
  }, [checkedTemplateIds.size, templates.length])

  // Clear manage state when closing manage mode
  useEffect(() => {
    if (!showManage) {
      setCheckedTemplateIds(new Set())
      setBulkTplDeleteConfirm(false)
      setBulkTplError('')
      setMergePhase(null)
      setMergeName('')
    }
  }, [showManage])

  // Select first template on load
  useEffect(() => {
    if (templates.length > 0 && !selectedId) setSelectedId(templates[0].id)
  }, [templates.length]) // eslint-disable-line

  const categories  = template?.categories ?? []
  const assignedVenues = useMemo(() => allVenues.filter(v => (template?.venue_ids ?? []).includes(v.id)), [allVenues, template?.venue_ids])
  const showPrices = template?.show_prices ?? false

  // Grid column template
  const colTemplate = useMemo(() => [
    '40px',             // checkbox
    '40px',             // drag
    '1fr',              // name (flex)
    '80px',             // unit
    showPrices ? '80px' : null,  // price
    '160px',            // category
    ...assignedVenues.map(() => '80px'),  // sug qty
    '44px',             // delete
  ].filter(Boolean).join(' '), [showPrices, assignedVenues])

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createTemplateMutation = useMutation({
    mutationFn: () => api.post('/order-sheets/templates', { name: newTemplateName.trim() || 'New Template' }),
    onSuccess: (tmpl) => {
      queryClient.invalidateQueries(['order-sheets', 'templates'])
      queryClient.setQueryData(['order-sheets', 'templates', tmpl.id], tmpl)
      setSelectedId(tmpl.id)
      setShowNewInput(false)
      setNewTemplateName('')
      setShowManage(false)
      setShowSettings(true)
    },
  })

  const deleteTemplateMutation = useMutation({
    mutationFn: () => api.delete(`/order-sheets/templates/${selectedId}`),
    onSuccess: () => {
      queryClient.invalidateQueries(['order-sheets', 'templates'])
      setSelectedId(templates.find(t => t.id !== selectedId)?.id ?? null)
      setDeleteConfirm(false)
    },
    onError: (err) => setDeleteError(err?.message ?? 'Delete failed'),
  })

  const bulkDeleteTemplatesMutation = useMutation({
    mutationFn: () => api.delete('/order-sheets/templates/bulk', { ids: [...checkedTemplateIds] }),
    onSuccess: () => {
      const deleted = new Set(checkedTemplateIds)
      if (deleted.has(selectedId)) setSelectedId(null)
      queryClient.invalidateQueries(['order-sheets', 'templates'])
      setCheckedTemplateIds(new Set())
      setBulkTplDeleteConfirm(false)
      setBulkTplError('')
    },
    onError: (err) => setBulkTplError(err?.message ?? 'Delete failed'),
  })

  const mergeTemplatesMutation = useMutation({
    mutationFn: () => {
      const ids = [...checkedTemplateIds]
      const [primaryId, ...secondaryIds] = ids
      return api.post('/order-sheets/templates/merge', {
        primary_id:    primaryId,
        secondary_ids: secondaryIds,
        name:          mergeName.trim() || undefined,
      })
    },
    onSuccess: ({ primary_id }) => {
      queryClient.invalidateQueries(['order-sheets', 'templates'])
      setSelectedId(primary_id)
      setCheckedTemplateIds(new Set())
      setMergePhase(null)
      setMergeName('')
      setShowManage(false)
    },
    onError: (err) => setBulkTplError(err?.message ?? 'Merge failed'),
  })

  const addItemMutation = useMutation({
    mutationFn: (body) => api.post(`/order-sheets/templates/${selectedId}/items`, body),
    onSuccess: (item) => {
      setItems(prev => [...prev, item])
      setSuggestedQtys(prev => ({ ...prev, [item.id]: {} }))
      setShowDraft(false)
      queryClient.invalidateQueries(['order-sheets', 'templates'])
    },
  })

  const saveFieldMutation = useMutation({
    mutationFn: ({ itemId, field, value }) =>
      api.patch(`/order-sheets/templates/${selectedId}/items/${itemId}`, { [field]: value }),
    onSuccess: (updated) => {
      setItems(prev => prev.map(i => i.id === updated.id ? updated : i))
    },
  })

  const sugQtyMutation = useMutation({
    mutationFn: ({ itemId, venueQtys }) =>
      api.put(`/order-sheets/templates/${selectedId}/items/${itemId}/suggested`, { venue_qtys: venueQtys }),
  })

  const deleteItemMutation = useMutation({
    mutationFn: (itemId) => api.delete(`/order-sheets/templates/${selectedId}/items/${itemId}`),
    onSuccess: (_, itemId) => {
      setItems(prev => prev.filter(i => i.id !== itemId))
      setSuggestedQtys(prev => { const n = { ...prev }; delete n[itemId]; return n })
      setCheckedItemIds(prev => { const n = new Set(prev); n.delete(itemId); return n })
      queryClient.invalidateQueries(['order-sheets', 'templates'])
    },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: () => api.delete(`/order-sheets/templates/${selectedId}/items/bulk`, { ids: [...checkedItemIds] }),
    onSuccess: () => {
      const deleted = new Set(checkedItemIds)
      setItems(prev => prev.filter(i => !deleted.has(i.id)))
      setSuggestedQtys(prev => { const n = { ...prev }; for (const id of deleted) delete n[id]; return n })
      setCheckedItemIds(new Set())
      setBulkCatDeleteConfirm(false)
      setBulkError('')
      queryClient.invalidateQueries(['order-sheets', 'templates'])
    },
    onError: (err) => setBulkError(err?.message ?? 'Delete failed'),
  })

  const bulkCategoryMutation = useMutation({
    mutationFn: (category_id) => api.patch(`/order-sheets/templates/${selectedId}/items/bulk-category`, {
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
    },
  })

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const reordered = arrayMove(items, items.findIndex(i => i.id === active.id), items.findIndex(i => i.id === over.id))
    setItems(reordered)
    api.patch(`/order-sheets/templates/${selectedId}/item-order`, { ids: reordered.map(i => i.id) })
      .catch(() => queryClient.invalidateQueries(['order-sheets', 'templates', selectedId]))
  }

  function saveItemField(itemId, field, value) {
    if (field !== 'category_id') {
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, [field]: value } : i))
    }
    saveFieldMutation.mutate({ itemId, field, value })
  }

  function saveSugQty(itemId, venueId, qty) {
    setSuggestedQtys(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? {}), [venueId]: qty == null ? '' : String(qty) },
    }))
    const currentQtys = { ...(suggestedQtys[itemId] ?? {}), [venueId]: qty == null ? '' : String(qty) }
    const venueQtys = assignedVenues.map(v => ({
      venue_id: v.id,
      qty: Math.max(0, Number(currentQtys[v.id]) || 0),
    }))
    sugQtyMutation.mutate({ itemId, venueQtys })
  }

  function toggleItemCheck(id) {
    setCheckedItemIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function toggleTemplateCheck(id) {
    setCheckedTemplateIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function openTemplateInEditor(id) {
    setSelectedId(id)
    setShowManage(false)
    setShowSettings(false)
  }

  const selectedTemplate = templates.find(t => t.id === selectedId)

  // Name prefill for merge: first checked template's name
  const firstCheckedTemplate = useMemo(() => {
    const [firstId] = checkedTemplateIds
    return templates.find(t => t.id === firstId)
  }, [checkedTemplateIds, templates])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header bar ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0 bg-background">
        <ClipboardList className="w-4 h-4 text-muted-foreground shrink-0" />

        {/* Template selector (hidden in manage mode) */}
        {!showManage && (
          templatesLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : templates.length === 0 ? (
            <span className="text-sm text-muted-foreground">No templates</span>
          ) : (
            <div className="relative flex-1 max-w-xs">
              <select
                value={selectedId ?? ''}
                onChange={e => { setSelectedId(e.target.value || null); setShowSettings(false); setDeleteConfirm(false) }}
                className="w-full appearance-none border rounded-lg px-3 py-1.5 text-sm font-medium bg-background touch-manipulation min-h-[36px] pr-8"
              >
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}{!t.is_active ? ' (inactive)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            </div>
          )
        )}

        {/* Manage mode label */}
        {showManage && (
          <span className="text-sm font-medium">Manage templates</span>
        )}

        {/* New template */}
        {isAdmin && !showNewInput && !showManage && (
          <button
            onClick={() => setShowNewInput(true)}
            className="flex items-center gap-1 border rounded-lg px-2.5 py-1.5 text-xs font-medium touch-manipulation min-h-[36px] hover:bg-accent whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />New
          </button>
        )}

        {showNewInput && !showManage && (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newTemplateName}
              onChange={e => setNewTemplateName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createTemplateMutation.mutate(); if (e.key === 'Escape') { setShowNewInput(false); setNewTemplateName('') } }}
              placeholder="Template name"
              autoFocus
              className="border rounded px-2 py-1.5 text-sm touch-manipulation min-h-[36px] w-40"
            />
            <button onClick={() => createTemplateMutation.mutate()} disabled={createTemplateMutation.isPending}
              className="p-2 text-primary touch-manipulation disabled:opacity-50">
              {createTemplateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
            <button onClick={() => { setShowNewInput(false); setNewTemplateName('') }}
              className="p-2 text-muted-foreground touch-manipulation">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* Settings toggle (only in editor mode) */}
        {selectedId && !showManage && (
          <button
            onClick={() => { setShowSettings(s => !s); setDeleteConfirm(false) }}
            className={cn('flex items-center gap-1 border rounded-lg px-2.5 py-1.5 text-xs touch-manipulation min-h-[36px] hover:bg-accent',
              showSettings && 'bg-accent')}
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        )}

        {/* Manage toggle */}
        {isAdmin && (
          <button
            onClick={() => { setShowManage(s => !s); setShowSettings(false) }}
            className={cn('flex items-center gap-1 border rounded-lg px-2.5 py-1.5 text-xs touch-manipulation min-h-[36px] hover:bg-accent',
              showManage && 'bg-accent')}
          >
            <List className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{showManage ? 'Close' : 'Manage'}</span>
          </button>
        )}

        {/* Manage categories */}
        <Link
          to="/order-sheets/categories"
          className="flex items-center gap-1 border rounded-lg px-2.5 py-1.5 text-xs touch-manipulation min-h-[36px] hover:bg-accent whitespace-nowrap"
        >
          <Tag className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Categories</span>
        </Link>
      </div>

      {/* ── Settings panel (editor mode only) ── */}
      {!showManage && showSettings && selectedId && template && (
        <SettingsPanel
          key={template.id}
          template={template}
          allVenues={allVenues}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MANAGE MODE — template list with bulk operations
      ═══════════════════════════════════════════════════════════════════════ */}
      {showManage && (
        <div className="flex-1 overflow-auto">

          {/* Toolbar */}
          <div className="sticky top-0 z-20 bg-background border-b flex items-center gap-2 px-3 py-1.5 min-h-[44px] flex-wrap">
            <input
              ref={manageSelectAllRef}
              type="checkbox"
              checked={checkedTemplateIds.size === templates.length && templates.length > 0}
              onChange={e => setCheckedTemplateIds(e.target.checked ? new Set(templates.map(t => t.id)) : new Set())}
              className="w-4 h-4 rounded cursor-pointer"
            />

            {checkedTemplateIds.size > 0 ? (
              mergePhase === 'naming' ? (
                /* Merge: name input */
                <>
                  <span className="text-xs text-muted-foreground">Merge {checkedTemplateIds.size} templates into:</span>
                  <input
                    type="text"
                    value={mergeName}
                    onChange={e => setMergeName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') mergeTemplatesMutation.mutate(); if (e.key === 'Escape') { setMergePhase(null); setMergeName('') } }}
                    placeholder={firstCheckedTemplate?.name ?? 'Merged template'}
                    autoFocus
                    className="border rounded px-2 py-1 text-sm min-h-[32px] w-48 touch-manipulation"
                  />
                  {bulkTplError && <span className="text-xs text-red-600">{bulkTplError}</span>}
                  <button
                    onClick={() => mergeTemplatesMutation.mutate()}
                    disabled={mergeTemplatesMutation.isPending}
                    className="flex items-center gap-1 text-xs bg-primary text-primary-foreground rounded px-2.5 py-1 touch-manipulation min-h-[32px] disabled:opacity-50"
                  >
                    {mergeTemplatesMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Confirm merge
                  </button>
                  <button onClick={() => { setMergePhase(null); setMergeName(''); setBulkTplError('') }}
                    className="text-xs border rounded px-2.5 py-1 touch-manipulation min-h-[32px]">
                    Cancel
                  </button>
                </>
              ) : bulkTplDeleteConfirm ? (
                /* Delete confirm */
                <>
                  <span className="text-xs text-red-600 font-medium">
                    Delete {checkedTemplateIds.size} template{checkedTemplateIds.size !== 1 ? 's' : ''} and all their items?
                  </span>
                  {bulkTplError && <span className="text-xs text-red-600">{bulkTplError}</span>}
                  <button onClick={() => bulkDeleteTemplatesMutation.mutate()} disabled={bulkDeleteTemplatesMutation.isPending}
                    className="text-xs bg-red-600 text-white rounded px-2.5 py-1 touch-manipulation min-h-[32px] disabled:opacity-50">
                    {bulkDeleteTemplatesMutation.isPending ? 'Deleting…' : 'Yes, delete all'}
                  </button>
                  <button onClick={() => { setBulkTplDeleteConfirm(false); setBulkTplError('') }}
                    className="text-xs border rounded px-2.5 py-1 touch-manipulation min-h-[32px]">
                    Cancel
                  </button>
                </>
              ) : (
                /* Normal selected */
                <>
                  <span className="text-xs text-muted-foreground">{checkedTemplateIds.size} selected</span>
                  {checkedTemplateIds.size >= 2 && (
                    <button
                      onClick={() => {
                        setBulkTplError('')
                        setMergeName(firstCheckedTemplate?.name ?? '')
                        setMergePhase('naming')
                      }}
                      className="flex items-center gap-1 text-xs border rounded px-2.5 py-1 touch-manipulation min-h-[32px] hover:bg-accent"
                    >
                      <GitMerge className="w-3.5 h-3.5" />Merge
                    </button>
                  )}
                  <button onClick={() => { setBulkTplError(''); setBulkTplDeleteConfirm(true) }}
                    className="text-xs bg-red-600 text-white rounded px-2.5 py-1 touch-manipulation min-h-[32px]">
                    Delete
                  </button>
                  <button onClick={() => setCheckedTemplateIds(new Set())}
                    className="text-xs border rounded px-2.5 py-1 touch-manipulation min-h-[32px] text-muted-foreground">
                    Clear
                  </button>
                </>
              )
            ) : (
              <span className="text-xs text-muted-foreground">
                {templates.length} template{templates.length !== 1 ? 's' : ''} — select to bulk-delete or merge
              </span>
            )}
          </div>

          {/* Column header */}
          <div className="grid border-b bg-muted/60 text-xs font-medium text-muted-foreground"
            style={{ gridTemplateColumns: '40px 1fr 70px 120px 100px 80px' }}>
            <div />
            <div className="px-3 py-2 border-r">Template name</div>
            <div className="px-2 py-2 border-r text-center">Items</div>
            <div className="px-2 py-2 border-r">Delivery days</div>
            <div className="px-2 py-2 border-r">Stores</div>
            <div className="px-2 py-2">Status</div>
          </div>

          {/* Template rows */}
          {templates.map(t => {
            const vNames = allVenues.filter(v => (t.venue_ids ?? []).includes(v.id)).map(v => v.name)
            const days   = (t.delivery_days ?? []).sort().map(d => DAY_LABELS[d]).join(', ')

            return (
              <div
                key={t.id}
                className={cn(
                  'grid border-b hover:bg-muted/20 group',
                  checkedTemplateIds.has(t.id) && 'bg-primary/5',
                )}
                style={{ gridTemplateColumns: '40px 1fr 70px 120px 100px 80px' }}
              >
                {/* Checkbox */}
                <div className="flex items-center justify-center px-1">
                  <input type="checkbox" checked={checkedTemplateIds.has(t.id)}
                    onChange={() => toggleTemplateCheck(t.id)}
                    className="w-4 h-4 rounded cursor-pointer" />
                </div>
                {/* Name */}
                <div className="border-r flex items-center gap-2 px-3 py-2 min-h-[44px]">
                  <button
                    onClick={() => openTemplateInEditor(t.id)}
                    className="text-sm font-medium hover:underline text-left touch-manipulation"
                  >
                    {t.name}
                  </button>
                  {/* Quick settings inline toggle */}
                </div>
                {/* Item count */}
                <div className="border-r flex items-center justify-center px-2 py-2">
                  <span className="text-sm text-muted-foreground">{t.item_count ?? 0}</span>
                </div>
                {/* Delivery days */}
                <div className="border-r flex items-center px-2 py-2">
                  <span className="text-xs text-muted-foreground">{days || '—'}</span>
                </div>
                {/* Stores */}
                <div className="border-r flex items-center px-2 py-2">
                  <span className="text-xs text-muted-foreground truncate" title={vNames.join(', ')}>
                    {vNames.length === 0 ? '—' : vNames.length === 1 ? vNames[0] : `${vNames.length} stores`}
                  </span>
                </div>
                {/* Status */}
                <div className="flex items-center gap-1.5 px-2 py-2">
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded-full font-medium',
                    t.is_active
                      ? 'bg-green-100 text-green-800'
                      : 'bg-muted text-muted-foreground'
                  )}>
                    {t.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            )
          })}

          {templates.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No templates yet.
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          EDITOR MODE — single-template Excel editor
      ═══════════════════════════════════════════════════════════════════════ */}
      {!showManage && (
        <>
          {/* No template selected */}
          {!selectedId && !templatesLoading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
              <ClipboardList className="w-10 h-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No templates yet.</p>
              {isAdmin && (
                <button
                  onClick={() => setShowNewInput(true)}
                  className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium touch-manipulation"
                >
                  <Plus className="w-4 h-4" />Create first template
                </button>
              )}
            </div>
          )}

          {/* Loading template detail */}
          {selectedId && tmplLoading && (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Items table */}
          {selectedId && template && !tmplLoading && (
            <div className="flex-1 overflow-auto">

              {/* Toolbar */}
              <div className="sticky top-0 z-20 bg-background border-b flex items-center gap-2 px-3 py-1.5 min-h-[44px]">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={checkedItemIds.size === items.length && items.length > 0}
                  onChange={e => setCheckedItemIds(e.target.checked ? new Set(items.map(i => i.id)) : new Set())}
                  className="w-4 h-4 rounded cursor-pointer"
                />

                {checkedItemIds.size > 0 ? (
                  !bulkCatDeleteConfirm ? (
                    <>
                      <span className="text-xs text-muted-foreground">{checkedItemIds.size} selected</span>
                      {categories.length > 0 && (
                        <select
                          disabled={bulkCategoryMutation.isPending}
                          onChange={e => {
                            const v = e.target.value
                            if (v === '__p') return
                            bulkCategoryMutation.mutate(v === '__none' ? null : v)
                            e.target.value = '__p'
                          }}
                          defaultValue="__p"
                          className="text-xs border rounded px-2 py-1 touch-manipulation min-h-[32px] disabled:opacity-50"
                        >
                          <option value="__p" disabled>Category…</option>
                          <option value="__none">— Clear</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      )}
                      <button onClick={() => setBulkCatDeleteConfirm(true)}
                        className="text-xs bg-red-600 text-white rounded px-2.5 py-1 touch-manipulation min-h-[32px]">
                        Delete
                      </button>
                      <button onClick={() => setCheckedItemIds(new Set())}
                        className="text-xs border rounded px-2.5 py-1 touch-manipulation min-h-[32px] text-muted-foreground">
                        Clear
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-red-600 font-medium">
                        Delete {checkedItemIds.size} item{checkedItemIds.size !== 1 ? 's' : ''}?
                      </span>
                      {bulkError && <span className="text-xs text-red-600">{bulkError}</span>}
                      <button onClick={() => bulkDeleteMutation.mutate()} disabled={bulkDeleteMutation.isPending}
                        className="text-xs bg-red-600 text-white rounded px-2.5 py-1 touch-manipulation min-h-[32px] disabled:opacity-50">
                        {bulkDeleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
                      </button>
                      <button onClick={() => { setBulkCatDeleteConfirm(false); setBulkError('') }}
                        className="text-xs border rounded px-2.5 py-1 touch-manipulation min-h-[32px]">
                        Cancel
                      </button>
                    </>
                  )
                ) : (
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {items.length} item{items.length !== 1 ? 's' : ''}
                    {assignedVenues.length > 0 && ` · ${assignedVenues.length} venue${assignedVenues.length !== 1 ? 's' : ''}`}
                  </span>
                )}

                <div className="flex-1" />

                {isAdmin && !showDraft && (
                  <button
                    onClick={() => setShowDraft(true)}
                    className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium touch-manipulation min-h-[36px]"
                  >
                    <Plus className="w-3.5 h-3.5" />Add item
                  </button>
                )}
              </div>

              {/* Column header */}
              <div
                className="sticky top-[45px] z-10 bg-muted/60 border-b text-xs font-medium text-muted-foreground"
                style={{ display: 'grid', gridTemplateColumns: colTemplate }}
              >
                <div />
                <div />
                <div className="px-2 py-2 border-r">Item name</div>
                <div className="px-2 py-2 border-r">Unit</div>
                {showPrices && <div className="px-2 py-2 border-r">Price</div>}
                <div className="px-2 py-2 border-r">Category</div>
                {assignedVenues.map(v => (
                  <div key={v.id} className="px-2 py-2 border-r last:border-r-0 truncate text-right" title={v.name}>
                    {v.name}
                  </div>
                ))}
                <div />
              </div>

              {/* Item rows */}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                  {items.map(item => (
                    <SortableItemRow
                      key={item.id}
                      item={item}
                      showPrices={showPrices}
                      assignedVenues={assignedVenues}
                      categories={categories}
                      suggestedQtys={suggestedQtys}
                      checked={checkedItemIds.has(item.id)}
                      onCheck={toggleItemCheck}
                      onSaveField={saveItemField}
                      onSaveSugQty={saveSugQty}
                      onDelete={(id) => deleteItemMutation.mutate(id)}
                      colTemplate={colTemplate}
                    />
                  ))}
                </SortableContext>
              </DndContext>

              {/* Draft new item row */}
              {showDraft && (
                <DraftItemRow
                  showPrices={showPrices}
                  assignedVenues={assignedVenues}
                  categories={categories}
                  onSave={(body) => addItemMutation.mutate(body)}
                  onCancel={() => setShowDraft(false)}
                  colTemplate={colTemplate}
                />
              )}

              {items.length === 0 && !showDraft && (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  No items yet — click <strong>Add item</strong> to get started.
                </div>
              )}

              {/* Delete template */}
              {isAdmin && (
                <div className="px-4 py-4 border-t mt-4">
                  {!deleteConfirm ? (
                    <button onClick={() => setDeleteConfirm(true)}
                      className="text-xs text-red-600 hover:underline touch-manipulation py-1">
                      Delete template "{selectedTemplate?.name}"
                    </button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                      <span className="text-sm text-red-600 font-medium">Delete this template? Cannot be undone.</span>
                      {deleteError && <span className="text-xs text-red-600">{deleteError}</span>}
                      <button onClick={() => deleteTemplateMutation.mutate()} disabled={deleteTemplateMutation.isPending}
                        className="text-xs bg-red-600 text-white rounded px-3 py-1.5 touch-manipulation min-h-[32px] disabled:opacity-50">
                        {deleteTemplateMutation.isPending ? 'Deleting…' : 'Yes, delete'}
                      </button>
                      <button onClick={() => { setDeleteConfirm(false); setDeleteError('') }}
                        className="text-xs border rounded px-3 py-1.5 touch-manipulation min-h-[32px]">
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
