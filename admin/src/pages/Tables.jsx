// src/pages/Tables.jsx
// Manage tables grouped by section per venue.
// Tables are always drag-sortable via the grip handle on the left of each row.
// The sort order drives: (1) Timeline row sequence, (2) smart-allocation adjacency.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  DndContext, DragOverlay,
  useDraggable, useDroppable,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  Plus, Pencil, Trash2, Check, X, Layers, Link2,
  GripVertical, Save, Ban, AlertTriangle,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Schemas ──────────────────────────────────────────────────

const TableSchema = z.object({
  label:      z.string().min(1, 'Required').max(50),
  section_id: z.string().uuid().nullable().optional(),
  min_covers: z.coerce.number().int().min(1),
  max_covers: z.coerce.number().int().min(1),
  is_active:  z.boolean().default(true),
})

const SectionSchema = z.object({
  name:       z.string().min(1, 'Required').max(100),
  sort_order: z.coerce.number().int().default(0),
})

const inp = 'w-full border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary'

// ── Table form ────────────────────────────────────────────────

function TableForm({ venueId, table, sections, onSave, onCancel }) {
  const api = useApi()
  const qc  = useQueryClient()

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(TableSchema),
    defaultValues: table ?? { min_covers: 2, max_covers: 4, is_active: true },
  })

  const mutation = useMutation({
    mutationFn: (data) => table
      ? api.patch(`/venues/${venueId}/tables/${table.id}`, data)
      : api.post(`/venues/${venueId}/tables`, data),
    onSuccess: () => { qc.invalidateQueries(['tables', venueId]); onSave() },
  })

  return (
    <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-3 p-3 bg-muted/20 rounded-lg border">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Label</label>
          <input {...register('label')} className={inp} placeholder="T1, Bar-3, Window…" />
          {errors.label && <p className="text-xs text-destructive mt-0.5">{errors.label.message}</p>}
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Section</label>
          <select {...register('section_id')} className={inp}>
            <option value="">No section</option>
            {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Min covers</label>
          <input {...register('min_covers')} type="number" min={1} className={inp} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Max covers</label>
          <input {...register('max_covers')} type="number" min={1} className={inp} />
          {errors.max_covers && <p className="text-xs text-destructive mt-0.5">{errors.max_covers.message}</p>}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" {...register('is_active')} className="w-4 h-4" />
        Active
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50">
          <Check className="w-3.5 h-3.5" />
          {mutation.isPending ? 'Saving…' : table ? 'Save changes' : 'Add table'}
        </button>
        <button type="button" onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-sm hover:bg-accent">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    </form>
  )
}

// ── Section form ──────────────────────────────────────────────

function SectionForm({ venueId, onSave, onCancel }) {
  const api = useApi()
  const qc  = useQueryClient()
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(SectionSchema),
    defaultValues: { sort_order: 0 },
  })
  const mutation = useMutation({
    mutationFn: (data) => api.post(`/venues/${venueId}/sections`, data),
    onSuccess: () => { qc.invalidateQueries(['sections', venueId]); onSave() },
  })
  return (
    <form onSubmit={handleSubmit(d => mutation.mutate(d))}
      className="flex items-center gap-2 p-2 bg-muted/20 rounded-lg">
      <input {...register('name')} className={cn(inp, 'flex-1')} placeholder="Section name (Main Floor, Terrace…)" />
      <input {...register('sort_order')} type="number" className="border rounded px-2 py-1.5 text-sm w-20" placeholder="Order" />
      <button type="submit" disabled={mutation.isPending}
        className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50 shrink-0">
        {mutation.isPending ? '…' : 'Add'}
      </button>
      <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-md text-sm hover:bg-accent shrink-0">
        <X className="w-4 h-4" />
      </button>
    </form>
  )
}

// ── Combination form ──────────────────────────────────────────

function CombinationForm({ venueId, tables, combo, rules, disallowedPairs = [], onSave, onCancel }) {
  const api  = useApi()
  const qc   = useQueryClient()
  const isEdit = !!combo
  const [selectedTableIds, setSelectedTableIds] = useState(() => combo?.members?.map(m => m.table_id) ?? [])

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(z.object({
      name:       z.string().min(1, 'Required'),
      min_covers: z.coerce.number().int().min(1),
      max_covers: z.coerce.number().int().min(1),
    })),
    defaultValues: isEdit
      ? { name: combo.name, min_covers: combo.min_covers, max_covers: combo.max_covers }
      : { min_covers: 1, max_covers: 4 },
  })

  const mutation = useMutation({
    mutationFn: (data) => isEdit
      ? api.patch(`/venues/${venueId}/combinations/${combo.id}`, data)
      : api.post(`/venues/${venueId}/combinations`, { ...data, table_ids: selectedTableIds }),
    onSuccess: () => { qc.invalidateQueries(['combinations', venueId]); onSave() },
  })

  // ── Validate selection against allocation rules ────────────
  // Violations are informational — the combination is still saved, but the
  // engine will skip it unless the relevant rule is enabled.
  const violations = useMemo(() => {
    if (selectedTableIds.length < 2) return []
    const selected = tables.filter(t => selectedTableIds.includes(t.id))
    const result = []

    // Disallowed pairs — hard conflict: engine will always skip this combo
    const hasBlockedPair = disallowedPairs.some(p =>
      selectedTableIds.includes(p.table_id_a) && selectedTableIds.includes(p.table_id_b)
    )
    if (hasBlockedPair) {
      result.push({
        level: 'error',
        msg:   'Contains a disallowed table pair — the smart-allocation engine will never use this combination.',
      })
    }

    // Cross-section — only flagged when rule is currently OFF
    if (rules && !rules.allow_cross_section_combo) {
      const sectionIds = [...new Set(selected.map(t => t.section_id).filter(Boolean))]
      if (sectionIds.length > 1) {
        result.push({
          level: 'warn',
          msg:   'Tables span multiple sections. Enable "Allow cross-section combining" in Rules for the engine to auto-use this.',
        })
      }
    }

    // Non-adjacent — check consecutive position in the current sort order
    if (rules && !rules.allow_non_adjacent_combo) {
      // `tables` is orderedTables (sorted by sort_order) — use position index
      const indices = selectedTableIds
        .map(id => tables.findIndex(t => t.id === id))
        .filter(i => i !== -1)
        .sort((a, b) => a - b)
      const isAdjacent = indices.length > 0 &&
        indices.every((idx, i) => i === 0 || idx === indices[i - 1] + 1)
      if (!isAdjacent) {
        result.push({
          level: 'warn',
          msg:   'Tables are not adjacent in sort order. Enable "Allow non-adjacent combining" in Rules for the engine to auto-use this.',
        })
      }
    }

    return result
  }, [selectedTableIds, tables, rules, disallowedPairs])

  return (
    <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-3 p-3 bg-muted/20 rounded-lg border-2 border-dashed">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-1">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
          <input {...register('name')} className={inp} placeholder="T1+T2" />
          {errors.name && <p className="text-xs text-destructive mt-0.5">{errors.name.message}</p>}
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Min covers</label>
          <input {...register('min_covers')} type="number" min={1} className={inp} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Max covers</label>
          <input {...register('max_covers')} type="number" min={1} className={inp} />
        </div>
      </div>
      {!isEdit && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Tables in combination <span className="text-muted-foreground/60">(select 2+)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {tables.filter(t => t.is_active && !t.is_unallocated).map(t => (
              <button key={t.id} type="button"
                onClick={() => setSelectedTableIds(prev =>
                  prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id]
                )}
                className={cn(
                  'px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors',
                  selectedTableIds.includes(t.id)
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'hover:bg-accent'
                )}
              >{t.label}</button>
            ))}
          </div>
          {selectedTableIds.length < 2 && (
            <p className="text-xs text-muted-foreground mt-1">Select at least 2 tables</p>
          )}
        </div>
      )}

      {/* Rule violation warnings */}
      {violations.length > 0 && (
        <div className="space-y-1.5">
          {violations.map((v, i) => (
            <div key={i} className={cn(
              'flex items-start gap-2 text-xs px-3 py-2 rounded-md',
              v.level === 'error'
                ? 'bg-destructive/10 text-destructive border border-destructive/20'
                : 'bg-amber-50 text-amber-700 border border-amber-200',
            )}>
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{v.msg}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending || (!isEdit && selectedTableIds.length < 2)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50">
          <Check className="w-3.5 h-3.5" />
          {mutation.isPending ? 'Saving…' : isEdit ? 'Save' : 'Add combination'}
        </button>
        <button type="button" onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-sm hover:bg-accent">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    </form>
  )
}

// ── Add disallowed pair form ──────────────────────────────────

function AddPairForm({ venueId, tables, onSave, onCancel }) {
  const api = useApi()
  const qc  = useQueryClient()
  const [tableAId, setTableAId] = useState('')
  const [tableBId, setTableBId] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.post(`/venues/${venueId}/disallowed-pairs`, {
      table_id_a: tableAId,
      table_id_b: tableBId,
    }),
    onSuccess: () => { qc.invalidateQueries(['disallowed-pairs', venueId]); onSave() },
  })

  const activeTables = tables.filter(t => t.is_active && !t.is_unallocated)

  return (
    <div className="flex items-center gap-2 p-3 bg-muted/20 rounded-lg border flex-wrap">
      <select
        value={tableAId}
        onChange={e => setTableAId(e.target.value)}
        className={inp}
      >
        <option value="">Table A…</option>
        {activeTables.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <span className="text-xs text-muted-foreground shrink-0">never with</span>
      <select
        value={tableBId}
        onChange={e => setTableBId(e.target.value)}
        className={inp}
      >
        <option value="">Table B…</option>
        {activeTables.filter(t => t.id !== tableAId).map(t => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={!tableAId || !tableBId || mutation.isPending}
        onClick={() => mutation.mutate()}
        className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50 shrink-0"
      >
        {mutation.isPending ? '…' : 'Add'}
      </button>
      <button type="button" onClick={onCancel}
        className="px-2 py-1.5 border rounded-md text-sm hover:bg-accent shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

// ── Sortable table row ────────────────────────────────────────
// The grip handle is always visible. Drag to reorder in-place.

function SortableRow({ table, sections, venueId, editingTable, setEditingTable, onDelete, isDragActive }) {
  const {
    attributes, listeners, setNodeRef: setDragRef,
    transform, isDragging,
  } = useDraggable({ id: table.id, data: { tableId: table.id } })

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id:   `drop-${table.id}`,
    data: { tableId: table.id },
  })

  const setRef = useCallback(node => {
    setDragRef(node)
    setDropRef(node)
  }, [setDragRef, setDropRef])

  if (editingTable === table.id) {
    return (
      <TableForm
        venueId={venueId}
        table={table}
        sections={sections}
        onSave={() => setEditingTable(null)}
        onCancel={() => setEditingTable(null)}
      />
    )
  }

  return (
    <div
      ref={setRef}
      style={isDragging && transform
        ? { transform: `translate3d(0, ${transform.y}px, 0)`, zIndex: 50, position: 'relative' }
        : undefined
      }
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 border rounded-lg bg-background transition-colors',
        isDragging && 'opacity-40 shadow-lg',
        isOver && !isDragging && !isDragActive && 'border-primary ring-1 ring-primary bg-primary/5',
        !table.is_active && 'opacity-60',
      )}
    >
      {/* Drag handle — always visible */}
      <button
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing touch-none shrink-0 p-1 -ml-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
        title="Drag to reorder"
        onClick={e => e.preventDefault()}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Table avatar */}
      <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <span className="text-xs font-bold leading-none">{table.label.slice(0, 4)}</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-medium">{table.label}</p>
          {!table.is_active && <span className="text-xs text-muted-foreground">(inactive)</span>}
          {table.section_name && (
            <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground">
              {table.section_name}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{table.min_covers}–{table.max_covers} covers</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => setEditingTable(table.id)}
          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDelete(table.id)}
          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function Tables() {
  const api = useApi()
  const qc  = useQueryClient()

  const [selectedVenueId, setSelectedVenueId] = useState(null)
  const [editingTable,    setEditingTable]     = useState(null)
  const [addingSection,   setAddingSection]    = useState(false)
  const [addingCombo,     setAddingCombo]      = useState(false)
  const [editingCombo,    setEditingCombo]     = useState(null)
  const [addingPair,      setAddingPair]       = useState(false)

  // Local ordered list for drag-to-reorder (flat, excludes unallocated)
  const [orderedTables, setOrderedTables] = useState([])
  const [pendingSave,   setPendingSave]   = useState(false) // "Saving…" indicator
  const [activeId,      setActiveId]      = useState(null)  // currently dragging

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  const venueId = selectedVenueId ?? venues[0]?.id ?? null

  const { data: sections = [] } = useQuery({
    queryKey: ['sections', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/sections`),
    enabled:  !!venueId,
  })

  const { data: tables = [], isLoading } = useQuery({
    queryKey: ['tables', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/tables`),
    enabled:  !!venueId,
  })

  const { data: combinations = [] } = useQuery({
    queryKey: ['combinations', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/combinations`),
    enabled:  !!venueId,
  })

  const { data: disallowedPairs = [] } = useQuery({
    queryKey: ['disallowed-pairs', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/disallowed-pairs`),
    enabled:  !!venueId,
  })

  // Allocation rules — used for combination violation warnings
  const { data: allocationRules } = useQuery({
    queryKey: ['booking-rules', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/rules`),
    enabled:  !!venueId,
  })

  // Keep local orderedTables in sync when tables load / venue changes
  useEffect(() => {
    setOrderedTables(
      [...tables]
        .filter(t => !t.is_unallocated)
        .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
    )
  }, [tables])

  const reorderMutation = useMutation({
    mutationFn: (ids) => api.patch(`/venues/${venueId}/tables/reorder`, { ids }),
    onSettled: () => {
      qc.invalidateQueries(['tables', venueId])
      setPendingSave(false)
    },
  })

  const deleteComboMutation = useMutation({
    mutationFn: (id) => api.delete(`/venues/${venueId}/combinations/${id}`),
    onSuccess:  () => qc.invalidateQueries(['combinations', venueId]),
  })

  const deletePairMutation = useMutation({
    mutationFn: (id) => api.delete(`/venues/${venueId}/disallowed-pairs/${id}`),
    onSuccess:  () => qc.invalidateQueries(['disallowed-pairs', venueId]),
  })

  const softDeleteMutation = useMutation({
    mutationFn: (tableId) => api.delete(`/venues/${venueId}/tables/${tableId}`),
    onSuccess: () => qc.invalidateQueries(['tables', venueId]),
  })

  // ── Drag handlers ──────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  function handleDragStart({ active }) {
    setActiveId(active.id)
  }

  function handleDragEnd({ active, over }) {
    setActiveId(null)
    if (!over) return
    const overTableId = over.data.current?.tableId
    if (!overTableId || active.id === overTableId) return

    setOrderedTables(prev => {
      const oldIdx = prev.findIndex(t => t.id === active.id)
      const newIdx = prev.findIndex(t => t.id === overTableId)
      if (oldIdx === -1 || newIdx === -1) return prev
      const next = [...prev]
      const [item] = next.splice(oldIdx, 1)
      next.splice(newIdx, 0, item)

      // Auto-save immediately
      setPendingSave(true)
      reorderMutation.mutate(next.map(t => t.id))
      return next
    })
  }

  const activeTable = orderedTables.find(t => t.id === activeId) ?? null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <h1 className="font-semibold">Tables</h1>
          {/* Saving indicator */}
          {pendingSave && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Save className="w-3 h-3 animate-pulse" /> Saving order…
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={venueId ?? ''}
            onChange={e => setSelectedVenueId(e.target.value)}
            className="text-sm border rounded px-2 py-1.5"
          >
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <button onClick={() => setEditingTable('new')}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded-lg">
            <Plus className="w-4 h-4" /> Add table
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">

          {/* Sections management */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sections</p>
              {!addingSection && (
                <button onClick={() => setAddingSection(true)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <Plus className="w-3 h-3" /> Add section
                </button>
              )}
            </div>
            {addingSection && (
              <SectionForm venueId={venueId} onSave={() => setAddingSection(false)} onCancel={() => setAddingSection(false)} />
            )}
            {sections.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {sections.map(s => (
                  <span key={s.id} className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-muted rounded-full">
                    <Layers className="w-3 h-3" /> {s.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* New table form */}
          {editingTable === 'new' && (
            <TableForm
              venueId={venueId}
              sections={sections}
              onSave={() => setEditingTable(null)}
              onCancel={() => setEditingTable(null)}
            />
          )}

          {/* ── Sortable table list ──────────────────────── */}
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : orderedTables.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tables yet. Add one above.</p>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Tables
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <GripVertical className="w-3 h-3" /> Drag rows to reorder
                </p>
              </div>

              <DndContext
                sensors={sensors}
                modifiers={[restrictToVerticalAxis]}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <div className="grid gap-1.5">
                  {orderedTables.reduce((acc, table, idx) => {
                    // Insert a section sub-header whenever the section changes
                    const prev = orderedTables[idx - 1]
                    const sectionChanged = prev?.section_id !== table.section_id
                    if (sectionChanged && table.section_name) {
                      acc.push(
                        <div
                          key={`sec-hdr-${table.section_id}-${idx}`}
                          className={cn(
                            'flex items-center gap-1.5 text-xs font-semibold text-muted-foreground',
                            idx > 0 ? 'mt-3' : 'mt-0',
                          )}
                        >
                          <Layers className="w-3 h-3" />
                          {table.section_name}
                        </div>
                      )
                    }
                    acc.push(
                      <SortableRow
                        key={table.id}
                        table={table}
                        sections={sections}
                        venueId={venueId}
                        editingTable={editingTable}
                        setEditingTable={setEditingTable}
                        onDelete={softDeleteMutation.mutate}
                        isDragActive={!!activeId}
                      />
                    )
                    return acc
                  }, [])}
                </div>

                {/* Ghost card while dragging */}
                <DragOverlay modifiers={[restrictToVerticalAxis]}>
                  {activeTable && (
                    <div className="flex items-center gap-3 px-3 py-2.5 border-2 border-primary rounded-lg bg-background shadow-xl">
                      <GripVertical className="w-4 h-4 text-muted-foreground" />
                      <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                        <span className="text-xs font-bold">{activeTable.label.slice(0, 4)}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium">{activeTable.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {activeTable.min_covers}–{activeTable.max_covers} covers
                        </p>
                      </div>
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            </div>
          )}

          {/* ── Combinations ────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Table combinations
              </p>
              {!addingCombo && (
                <button onClick={() => setAddingCombo(true)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <Plus className="w-3 h-3" /> Add combination
                </button>
              )}
            </div>
            {addingCombo && (
              <CombinationForm
                venueId={venueId}
                tables={orderedTables}
                rules={allocationRules}
                disallowedPairs={disallowedPairs}
                onSave={() => setAddingCombo(false)}
                onCancel={() => setAddingCombo(false)}
              />
            )}
            {combinations.length === 0 && !addingCombo ? (
              <p className="text-xs text-muted-foreground">
                No combinations yet. Push tables together for larger parties.
              </p>
            ) : (
              <div className="grid gap-2 mt-2">
                {combinations.map(c => (
                  <div key={c.id}>
                    {editingCombo?.id === c.id ? (
                      <CombinationForm
                        venueId={venueId}
                        tables={orderedTables}
                        combo={c}
                        rules={allocationRules}
                        disallowedPairs={disallowedPairs}
                        onSave={() => setEditingCombo(null)}
                        onCancel={() => setEditingCombo(null)}
                      />
                    ) : (
                      <div className={cn(
                        'flex items-center gap-4 px-4 py-3 border rounded-lg',
                        !c.is_active && 'opacity-50'
                      )}>
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Link2 className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {c.min_covers}–{c.max_covers} covers ·{' '}
                            {Array.isArray(c.members) ? c.members.map(m => m.label).join(' + ') : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditingCombo(c)}
                            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deleteComboMutation.mutate(c.id)}
                            className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Disallowed table pairs ───────────────────── */}
          <div>
            <div className="flex items-start justify-between mb-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Disallowed pairs
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The smart-allocation engine will never combine these table pairs.
                </p>
              </div>
              {!addingPair && (
                <button onClick={() => setAddingPair(true)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0">
                  <Plus className="w-3 h-3" /> Add pair
                </button>
              )}
            </div>
            {addingPair && (
              <AddPairForm
                venueId={venueId}
                tables={orderedTables}
                onSave={() => setAddingPair(false)}
                onCancel={() => setAddingPair(false)}
              />
            )}
            {disallowedPairs.length === 0 && !addingPair ? (
              <p className="text-xs text-muted-foreground">No restrictions set.</p>
            ) : (
              <div className="grid gap-1.5 mt-2">
                {disallowedPairs.map(p => (
                  <div key={p.id}
                    className="flex items-center gap-3 px-3 py-2.5 border rounded-lg bg-background">
                    <Ban className="w-4 h-4 text-destructive/50 shrink-0" />
                    <span className="flex-1 text-sm">
                      <span className="font-medium">{p.label_a}</span>
                      <span className="text-muted-foreground mx-2">never with</span>
                      <span className="font-medium">{p.label_b}</span>
                    </span>
                    <button
                      onClick={() => deletePairMutation.mutate(p.id)}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
