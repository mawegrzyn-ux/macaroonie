// src/pages/Backlog.jsx
//
// Global Kanban backlog — platform admin only.
// 5-column drag-and-drop board using @dnd-kit.

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, X, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { useQuery as useQueryMe } from '@tanstack/react-query'
import { cn } from '@/lib/utils'

// ── Constants ─────────────────────────────────────────────────

const COLUMNS = [
  { status: 'backlog',     label: 'Backlog' },
  { status: 'todo',        label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review',   label: 'In Review' },
  { status: 'done',        label: 'Done' },
]

const TYPE_COLOURS = {
  epic:  'bg-purple-100 text-purple-800',
  story: 'bg-blue-100 text-blue-800',
  task:  'bg-slate-100 text-slate-800',
  bug:   'bg-red-100 text-red-800',
  spike: 'bg-cyan-100 text-cyan-800',
}

const PRIORITY_COLOURS = {
  critical: 'bg-red-100 text-red-800',
  high:     'bg-orange-100 text-orange-800',
  medium:   'bg-amber-100 text-amber-800',
  low:      'bg-green-100 text-green-800',
}

const TYPES     = ['epic', 'story', 'task', 'bug', 'spike']
const PRIORITIES = ['critical', 'high', 'medium', 'low']

// ── Small reusable components ─────────────────────────────────

function Badge({ className, children }) {
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium capitalize', className)}>
      {children}
    </span>
  )
}

function ItemCard({ item, onEdit, isDragging = false }) {
  return (
    <div
      className={cn(
        'bg-background border rounded-lg p-3 space-y-2 cursor-pointer touch-manipulation select-none',
        isDragging ? 'opacity-50 shadow-lg' : 'hover:border-primary/40',
      )}
      onClick={() => onEdit(item)}
    >
      <div className="flex items-start gap-1.5 flex-wrap">
        <Badge className={TYPE_COLOURS[item.type]}>{item.type}</Badge>
        <Badge className={PRIORITY_COLOURS[item.priority]}>{item.priority}</Badge>
        {item.story_points != null && (
          <span className="ml-auto text-xs text-muted-foreground font-mono bg-muted rounded px-1.5 py-0.5">
            {item.story_points} pts
          </span>
        )}
      </div>
      <p className="text-sm font-medium leading-snug line-clamp-3">{item.title}</p>
      {item.labels?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.labels.map(label => (
            <span key={label} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function SortableCard({ item, onEdit }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, data: { item, status: item.status } })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} className="relative group">
      <div
        {...attributes}
        {...listeners}
        className="absolute left-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground touch-manipulation z-10"
        title="Drag to reorder"
        onClick={e => e.stopPropagation()}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>
      <div className="pl-5">
        <ItemCard item={item} onEdit={onEdit} isDragging={isDragging} />
      </div>
    </div>
  )
}

// ── Item form (create / edit) ─────────────────────────────────

function ItemForm({ initial = {}, onSave, onCancel, onDelete, isSaving }) {
  const [title,       setTitle]       = useState(initial.title ?? '')
  const [description, setDescription] = useState(initial.description ?? '')
  const [type,        setType]        = useState(initial.type ?? 'task')
  const [priority,    setPriority]    = useState(initial.priority ?? 'medium')
  const [labels,      setLabels]      = useState((initial.labels ?? []).join(', '))
  const [points,      setPoints]      = useState(initial.story_points ?? '')
  const [confirmDel,  setConfirmDel]  = useState(false)

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    onSave({
      title:        title.trim(),
      description:  description.trim() || null,
      type,
      priority,
      labels:       labels.split(',').map(l => l.trim()).filter(Boolean),
      story_points: points ? parseInt(points, 10) : null,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Title *</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          required
          className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation min-h-[44px]"
          placeholder="Item title"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation resize-none"
          placeholder="Optional description"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Type</label>
          <select
            value={type}
            onChange={e => setType(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation min-h-[44px]"
          >
            {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Priority</label>
          <select
            value={priority}
            onChange={e => setPriority(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation min-h-[44px]"
          >
            {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Labels (comma-separated)</label>
          <input
            value={labels}
            onChange={e => setLabels(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation min-h-[44px]"
            placeholder="frontend, api, ux"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Story points</label>
          <input
            type="number"
            min="1"
            max="100"
            value={points}
            onChange={e => setPoints(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm bg-background touch-manipulation min-h-[44px]"
            placeholder="e.g. 3"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={isSaving || !title.trim()}
          className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px] disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border rounded text-sm touch-manipulation min-h-[44px]"
        >
          Cancel
        </button>
        {onDelete && (
          confirmDel ? (
            <button
              type="button"
              onClick={onDelete}
              className="px-4 py-2 bg-red-600 text-white rounded text-sm touch-manipulation min-h-[44px]"
            >
              Confirm delete
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDel(true)}
              className="p-2 text-red-500 hover:bg-red-50 rounded touch-manipulation min-h-[44px]"
              title="Delete item"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )
        )}
      </div>
    </form>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function Backlog() {
  const api          = useApi()
  const queryClient  = useQueryClient()

  /* gate: platform admin only */
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn:  () => api.get('/me'),
    staleTime: 120_000,
  })

  const [activeId,    setActiveId]    = useState(null)
  const [activeItem,  setActiveItem]  = useState(null)
  const [showCreate,  setShowCreate]  = useState(false)
  const [editItem,    setEditItem]    = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const { data: grouped = {}, isLoading } = useQuery({
    queryKey: ['backlog'],
    queryFn:  () => api.get('/backlog'),
    enabled:  !!me?.is_platform_admin,
  })

  /* flatten all items for DnD context */
  const allItems = COLUMNS.flatMap(col => grouped[col.status] ?? [])

  const createMut = useMutation({
    mutationFn: body => api.post('/backlog', body),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ['backlog'] }); setShowCreate(false) },
  })

  const patchMut = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/backlog/${id}`, body),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ['backlog'] }); setEditItem(null) },
  })

  const deleteMut = useMutation({
    mutationFn: id => api.delete(`/backlog/${id}`),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ['backlog'] }); setEditItem(null) },
  })

  const moveMut = useMutation({
    mutationFn: ({ id, status, sort_order }) =>
      api.patch(`/backlog/${id}/move`, { status, sort_order }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['backlog'] }),
  })

  /* ── DnD handlers ─────────────────────────────────────────── */
  function handleDragStart(event) {
    const item = allItems.find(i => i.id === event.active.id)
    setActiveId(event.active.id)
    setActiveItem(item ?? null)
  }

  function handleDragEnd(event) {
    setActiveId(null)
    setActiveItem(null)

    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeData = active.data.current
    const overData   = over.data.current

    const activeStatus = activeData?.status ?? activeData?.item?.status
    const overStatus   = overData?.status   ?? overData?.item?.status ?? activeStatus

    const targetColumn = grouped[overStatus] ?? []
    const overIndex    = targetColumn.findIndex(i => i.id === over.id)
    const newIndex     = overIndex >= 0 ? overIndex : targetColumn.length

    moveMut.mutate({ id: active.id, status: overStatus, sort_order: newIndex })
  }

  function handleDragOver(event) {
    /* allow dropping onto column droppable areas */
  }

  if (!me) return null
  if (!me.is_platform_admin) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="text-center py-20 text-muted-foreground">
          Platform admin access required.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Backlog</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          New item
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">New backlog item</h2>
              <button onClick={() => setShowCreate(false)} className="p-1.5 rounded hover:bg-accent touch-manipulation">
                <X className="w-4 h-4" />
              </button>
            </div>
            <ItemForm
              onSave={body => createMut.mutate(body)}
              onCancel={() => setShowCreate(false)}
              isSaving={createMut.isPending}
            />
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editItem && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Edit item</h2>
              <button onClick={() => setEditItem(null)} className="p-1.5 rounded hover:bg-accent touch-manipulation">
                <X className="w-4 h-4" />
              </button>
            </div>
            <ItemForm
              initial={editItem}
              onSave={body => patchMut.mutate({ id: editItem.id, ...body })}
              onCancel={() => setEditItem(null)}
              onDelete={() => deleteMut.mutate(editItem.id)}
              isSaving={patchMut.isPending || deleteMut.isPending}
            />
          </div>
        </div>
      )}

      {/* Kanban board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 160px)' }}>
          {COLUMNS.map(col => {
            const items = grouped[col.status] ?? []
            return (
              <div key={col.status} className="flex flex-col w-72 shrink-0">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-sm font-semibold">{col.label}</span>
                  <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                    {items.length}
                  </span>
                </div>
                <div
                  className="flex-1 overflow-y-auto space-y-2 rounded-lg bg-muted/40 p-2"
                  style={{ minHeight: 60 }}
                >
                  <SortableContext
                    items={items.map(i => i.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {isLoading ? (
                      <div className="text-xs text-muted-foreground text-center py-4">Loading…</div>
                    ) : items.length === 0 ? (
                      <div className="text-xs text-muted-foreground text-center py-6">Empty</div>
                    ) : (
                      items.map(item => (
                        <SortableCard
                          key={item.id}
                          item={item}
                          onEdit={setEditItem}
                        />
                      ))
                    )}
                  </SortableContext>
                </div>
              </div>
            )
          })}
        </div>

        <DragOverlay>
          {activeItem && (
            <div className="w-72 rotate-1 shadow-xl">
              <ItemCard item={activeItem} onEdit={() => {}} isDragging />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
