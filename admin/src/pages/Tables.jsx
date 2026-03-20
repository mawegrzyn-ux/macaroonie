// src/pages/Tables.jsx
// Manage tables grouped by section per venue.
// Includes drag-to-reorder mode — the order set here drives:
//   • Timeline row order (top → bottom)
//   • Smart-allocation adjacency logic (which tables are "next to" each other)

import { useState, useEffect, useCallback } from 'react'
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
  GripVertical, ArrowUpDown,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Schemas ──────────────────────────────────────────────────

const TableSchema = z.object({
  label:      z.string().min(1, 'Required').max(50),
  section_id: z.string().uuid().nullable().optional(),
  min_covers: z.coerce.number().int().min(1),
  max_covers: z.coerce.number().int().min(1),
  sort_order: z.coerce.number().int().default(0),
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
    defaultValues: table ?? { min_covers: 2, max_covers: 4, sort_order: 0, is_active: true },
  })

  const mutation = useMutation({
    mutationFn: (data) => table
      ? api.patch(`/venues/${venueId}/tables/${table.id}`, data)
      : api.post(`/venues/${venueId}/tables`, data),
    onSuccess: () => { qc.invalidateQueries(['tables', venueId]); onSave() },
  })

  return (
    <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-3 p-3 bg-muted/20 rounded-lg">
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

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" {...register('is_active')} className="w-4 h-4" />
          Active
        </label>
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50">
          <Check className="w-3.5 h-3.5" />
          {mutation.isPending ? 'Saving…' : table ? 'Save' : 'Add table'}
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

  const { register, handleSubmit, formState: { errors } } = useForm({
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
      <button type="button" onClick={onCancel}
        className="px-3 py-1.5 border rounded-md text-sm hover:bg-accent shrink-0">
        <X className="w-4 h-4" />
      </button>
    </form>
  )
}

// ── Combination form ──────────────────────────────────────────

function CombinationForm({ venueId, tables, combo, onSave, onCancel }) {
  const api = useApi()
  const qc  = useQueryClient()
  const isEdit = !!combo
  const [selectedTableIds, setSelectedTableIds] = useState(
    () => combo?.members?.map(m => m.table_id) ?? []
  )
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

  function toggleTable(id) {
    setSelectedTableIds(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    )
  }

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
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTable(t.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors',
                  selectedTableIds.includes(t.id)
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'hover:bg-accent'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {selectedTableIds.length < 2 && (
            <p className="text-xs text-muted-foreground mt-1">Select at least 2 tables</p>
          )}
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

// ── Sortable item (drag-to-reorder mode) ─────────────────────

function SortableItem({ table }) {
  const {
    attributes, listeners, setNodeRef: setDragRef,
    transform, isDragging,
  } = useDraggable({ id: table.id, data: { tableId: table.id } })

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id:   `drop-${table.id}`,
    data: { tableId: table.id },
  })

  // Attach both drag and drop refs to the same DOM node
  const setRef = useCallback(node => {
    setDragRef(node)
    setDropRef(node)
  }, [setDragRef, setDropRef])

  return (
    <div
      ref={setRef}
      style={isDragging && transform
        ? { transform: `translate3d(0, ${transform.y}px, 0)`, zIndex: 50 }
        : undefined
      }
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 border rounded-lg bg-background select-none',
        isDragging && 'opacity-40 shadow-lg',
        isOver && !isDragging && 'border-primary ring-1 ring-primary',
      )}
    >
      {/* Drag handle */}
      <button
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing touch-none p-1 rounded hover:bg-accent text-muted-foreground shrink-0"
        title="Drag to reorder"
        onClick={e => e.preventDefault()}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Table icon */}
      <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
        <span className="text-xs font-bold">{table.label.slice(0, 3)}</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{table.label}</p>
        <p className="text-xs text-muted-foreground">
          {table.min_covers}–{table.max_covers} covers
          {table.section_name && (
            <span className="ml-1.5 px-1.5 py-0.5 bg-muted rounded-full text-[10px]">
              {table.section_name}
            </span>
          )}
        </p>
      </div>

      {!table.is_active && (
        <span className="text-xs text-muted-foreground shrink-0">(inactive)</span>
      )}
    </div>
  )
}

// ── Sort mode panel ───────────────────────────────────────────

function SortPanel({ venueId, tables, onDone }) {
  const api = useApi()
  const qc  = useQueryClient()

  // Local ordered list — starts from current sort_order
  const [ordered, setOrdered] = useState(
    () => [...tables].filter(t => !t.is_unallocated).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
  )
  const [hasChanges, setHasChanges] = useState(false)
  const [activeId,   setActiveId]   = useState(null)
  const activeTable = ordered.find(t => t.id === activeId) ?? null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const reorderMutation = useMutation({
    mutationFn: (ids) => api.patch(`/venues/${venueId}/tables/reorder`, { ids }),
    onSuccess: () => {
      qc.invalidateQueries(['tables', venueId])
      onDone()
    },
  })

  function handleDragStart({ active }) {
    setActiveId(active.id)
  }

  function handleDragEnd({ active, over }) {
    setActiveId(null)
    if (!over) return
    const overTableId = over.data.current?.tableId
    if (!overTableId || active.id === overTableId) return

    setOrdered(prev => {
      const oldIdx = prev.findIndex(t => t.id === active.id)
      const newIdx = prev.findIndex(t => t.id === overTableId)
      if (oldIdx === -1 || newIdx === -1) return prev
      const next = [...prev]
      const [item] = next.splice(oldIdx, 1)
      next.splice(newIdx, 0, item)
      return next
    })
    setHasChanges(true)
  }

  return (
    <div className="space-y-4">
      {/* Instruction banner */}
      <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <ArrowUpDown className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-blue-900">Drag tables into order</p>
          <p className="text-xs text-blue-700 mt-0.5">
            This order determines the row sequence in the Timeline and which tables are
            treated as "adjacent" when the smart-allocate engine looks for nearby tables
            to combine for larger bookings.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => reorderMutation.mutate(ordered.map(t => t.id))}
            disabled={!hasChanges || reorderMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-40"
          >
            <Check className="w-3.5 h-3.5" />
            {reorderMutation.isPending ? 'Saving…' : 'Save order'}
          </button>
          <button
            onClick={onDone}
            className="px-3 py-1.5 border rounded-md text-sm hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Sortable list */}
      <DndContext
        sensors={sensors}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid gap-1.5">
          {ordered.map((table, index) => (
            <div key={table.id} className="flex items-center gap-2">
              {/* Position number */}
              <span className="text-xs text-muted-foreground w-5 text-right shrink-0">
                {index + 1}
              </span>
              <div className="flex-1">
                <SortableItem table={table} />
              </div>
            </div>
          ))}
        </div>

        {/* Ghost card while dragging */}
        <DragOverlay>
          {activeTable && (
            <div className="flex items-center gap-3 px-3 py-2.5 border-2 border-primary rounded-lg bg-background shadow-xl opacity-90">
              <GripVertical className="w-4 h-4 text-muted-foreground" />
              <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                <span className="text-xs font-bold">{activeTable.label.slice(0, 3)}</span>
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
  )
}

// ── Table grid (normal view) ──────────────────────────────────

function TableGrid({ tables, sections, venueId, editingTable, setEditingTable, onDelete }) {
  return (
    <div className="grid gap-2">
      {tables.map(table => (
        <div key={table.id}>
          {editingTable === table.id ? (
            <TableForm
              venueId={venueId}
              table={table}
              sections={sections}
              onSave={() => setEditingTable(null)}
              onCancel={() => setEditingTable(null)}
            />
          ) : (
            <div className={cn(
              'flex items-center gap-4 px-4 py-3 border rounded-lg',
              !table.is_active && 'opacity-50'
            )}>
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <span className="text-sm font-bold">{table.label}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{table.label}</p>
                  {!table.is_active && <span className="text-xs text-muted-foreground">(inactive)</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {table.min_covers}–{table.max_covers} covers
                  {table.section_name && ` · ${table.section_name}`}
                  <span className="ml-1.5 text-muted-foreground/60">#{table.sort_order}</span>
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setEditingTable(table.id)}
                  className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDelete(table.id)}
                  className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function Tables() {
  const api = useApi()
  const qc  = useQueryClient()

  const [selectedVenueId,  setSelectedVenueId]  = useState(null)
  const [editingTable,     setEditingTable]      = useState(null)
  const [addingSection,    setAddingSection]     = useState(false)
  const [addingCombo,      setAddingCombo]       = useState(false)
  const [editingCombo,     setEditingCombo]      = useState(null)
  const [sortMode,         setSortMode]          = useState(false)

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

  const deleteComboMutation = useMutation({
    mutationFn: (id) => api.delete(`/venues/${venueId}/combinations/${id}`),
    onSuccess:  () => qc.invalidateQueries(['combinations', venueId]),
  })

  const softDeleteMutation = useMutation({
    mutationFn: (tableId) => api.delete(`/venues/${venueId}/tables/${tableId}`),
    onSuccess: () => qc.invalidateQueries(['tables', venueId]),
  })

  // Exit sort mode when switching venue
  useEffect(() => { setSortMode(false) }, [venueId])

  // Visible (non-unallocated) tables for normal view, grouped by section
  const visibleTables = tables.filter(t => !t.is_unallocated)
  const grouped = sections.reduce((acc, s) => {
    acc[s.id] = { section: s, tables: visibleTables.filter(t => t.section_id === s.id) }
    return acc
  }, {})
  const unsectioned = visibleTables.filter(t => !t.section_id)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0 gap-4">
        <h1 className="font-semibold">Tables</h1>
        <div className="flex items-center gap-2">
          <select
            value={venueId ?? ''}
            onChange={e => { setSelectedVenueId(e.target.value); setSortMode(false) }}
            className="text-sm border rounded px-2 py-1.5"
          >
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>

          {!sortMode && (
            <>
              <button
                onClick={() => setSortMode(true)}
                disabled={visibleTables.length < 2}
                title="Drag to set table order — drives Timeline rows and smart-allocation adjacency"
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 border rounded-lg hover:bg-accent disabled:opacity-40"
              >
                <ArrowUpDown className="w-4 h-4" /> Reorder
              </button>
              <button
                onClick={() => setEditingTable('new')}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded-lg"
              >
                <Plus className="w-4 h-4" /> Add table
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-5">

          {/* ── Sort mode ─────────────────────────────────────── */}
          {sortMode ? (
            <SortPanel
              venueId={venueId}
              tables={visibleTables}
              onDone={() => setSortMode(false)}
            />
          ) : (
            <>
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

              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : visibleTables.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tables yet. Add one above.</p>
              ) : (
                <>
                  {/* Sectioned tables */}
                  {Object.values(grouped).map(({ section, tables: sectionTables }) => (
                    sectionTables.length > 0 && (
                      <div key={section.id}>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                          {section.name}
                        </p>
                        <TableGrid
                          tables={sectionTables}
                          sections={sections}
                          venueId={venueId}
                          editingTable={editingTable}
                          setEditingTable={setEditingTable}
                          onDelete={softDeleteMutation.mutate}
                        />
                      </div>
                    )
                  ))}

                  {/* Unsectioned tables */}
                  {unsectioned.length > 0 && (
                    <div>
                      {sections.length > 0 && (
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                          No section
                        </p>
                      )}
                      <TableGrid
                        tables={unsectioned}
                        sections={sections}
                        venueId={venueId}
                        editingTable={editingTable}
                        setEditingTable={setEditingTable}
                        onDelete={softDeleteMutation.mutate}
                      />
                    </div>
                  )}
                </>
              )}

              {/* ── Combinations ───────────────────────────── */}
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
                    tables={visibleTables}
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
                            tables={visibleTables}
                            combo={c}
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
                                {Array.isArray(c.members)
                                  ? c.members.map(m => m.label).join(' + ')
                                  : ''}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setEditingCombo(c)}
                                className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deleteComboMutation.mutate(c.id)}
                                className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                              >
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
            </>
          )}

        </div>
      </div>
    </div>
  )
}
