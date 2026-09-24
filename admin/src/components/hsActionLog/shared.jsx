// src/components/hsActionLog/shared.jsx
//
// H&S Action Log — general facilities/compliance to-do list per venue
// (repairs, records, training, cleaning), migrated from the legacy
// spreadsheet's "ActionLog" tab. HSActionLogPanel is the one implementation
// reused by both the standalone page (HSActionLog.jsx) and the H&S
// Dashboard's action_log widget — same convention as the other
// food-safety/checklist shared panels.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, isPast, parseISO } from 'date-fns'
import {
  Plus, X, Check, Loader2, Pencil, Trash2, Settings, Paperclip, GripVertical,
} from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { MediaLibraryModal } from '@/components/media/MediaLibrary'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
const PRIORITY_COLOURS = {
  low:      'bg-gray-100 text-gray-600',
  medium:   'bg-blue-100 text-blue-700',
  high:     'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// ── Entry add/edit modal ─────────────────────────────────────────

function EntryModal({ initial, venueId, categories, onClose, onSave, onDelete, isSaving }) {
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '')
  const [loggedDate, setLoggedDate] = useState(initial?.logged_date ?? todayStr())
  const [task, setTask] = useState(initial?.task ?? '')
  const [details, setDetails] = useState(initial?.details ?? '')
  const [assignedTo, setAssignedTo] = useState(initial?.assigned_to ?? '')
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')
  const [priority, setPriority] = useState(initial?.priority ?? 'medium')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [attachmentMediaId, setAttachmentMediaId] = useState(initial?.attachment_media_id ?? null)
  const [attachmentUrl, setAttachmentUrl] = useState(initial?.attachment_url ?? null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function submit(e) {
    e.preventDefault()
    if (!task.trim()) return
    onSave({
      venue_id:            venueId,
      category_id:         categoryId || null,
      logged_date:         loggedDate,
      task:                task.trim(),
      details:             details.trim() || null,
      assigned_to:         assignedTo.trim() || null,
      due_date:            dueDate || null,
      priority,
      notes:               notes.trim() || null,
      attachment_media_id: attachmentMediaId,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-background">
          <h2 className="text-lg font-semibold">{initial ? 'Edit action' : 'New action'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Task *</label>
            <input value={task} onChange={e => setTask(e.target.value)} required autoFocus
              placeholder="e.g. Replace hinge on the kitchen door"
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px] touch-manipulation" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Details</label>
            <textarea value={details} onChange={e => setDetails(e.target.value)} rows={2}
              className="w-full border rounded px-3 py-2 text-sm bg-background resize-none touch-manipulation" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px] touch-manipulation">
                <option value="">None</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px] touch-manipulation">
                {Object.entries(PRIORITY_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Date raised</label>
              <input type="date" value={loggedDate} onChange={e => setLoggedDate(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px] touch-manipulation" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Due date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px] touch-manipulation" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Assigned to</label>
            <input value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
              placeholder="e.g. Mike"
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[44px] touch-manipulation" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Progress notes, what was ordered, who to chase, etc."
              className="w-full border rounded px-3 py-2 text-sm bg-background resize-none touch-manipulation" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Attachment</label>
            {attachmentUrl ? (
              <div className="flex items-center gap-2">
                <a href={attachmentUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline truncate">
                  View attachment
                </a>
                <button type="button" onClick={() => { setAttachmentMediaId(null); setAttachmentUrl(null) }}
                  className="p-1.5 rounded hover:bg-accent text-muted-foreground touch-manipulation" title="Remove attachment">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setPickerOpen(true)}
                className="inline-flex items-center gap-1.5 border rounded-md px-3 py-2 text-sm hover:bg-accent min-h-[40px] touch-manipulation">
                <Paperclip className="w-3.5 h-3.5" /> Attach photo
              </button>
            )}
            <MediaLibraryModal open={pickerOpen} onClose={() => setPickerOpen(false)}
              mode="picker" scope="hs_action_log"
              onPick={(url, item) => { setAttachmentMediaId(item.id); setAttachmentUrl(url); setPickerOpen(false) }} />
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            {initial && onDelete && (
              !confirmDelete ? (
                <button type="button" onClick={() => setConfirmDelete(true)}
                  className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded touch-manipulation" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              ) : (
                <span className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onDelete(initial.id)}
                    className="text-xs font-medium text-destructive px-2 py-1.5 rounded hover:bg-destructive/10 touch-manipulation">Confirm delete</button>
                  <button type="button" onClick={() => setConfirmDelete(false)}
                    className="text-xs text-muted-foreground px-2 py-1.5 touch-manipulation">Cancel</button>
                </span>
              )
            )}
            <div className="flex gap-2 ml-auto">
              <button type="button" onClick={onClose} className="px-4 py-2 border rounded text-sm min-h-[44px] touch-manipulation">Cancel</button>
              <button type="submit" disabled={isSaving || !task.trim()}
                className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50 touch-manipulation">
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Category management modal ────────────────────────────────────

function SortableCategoryRow({ category, onRename, onDeactivate }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(category.name)

  function save() {
    const v = name.trim()
    if (!v) return
    onRename(category.id, v)
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
          <input value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
            autoFocus className="flex-1 border rounded px-2 py-1.5 text-sm min-h-[36px] touch-manipulation" />
          <button type="button" onClick={save} className="p-2 text-primary touch-manipulation"><Check className="w-4 h-4" /></button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm">{category.name}</span>
          <button type="button" onClick={() => setEditing(true)} className="p-2 text-muted-foreground hover:text-foreground touch-manipulation">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => onDeactivate(category.id)} className="p-2 text-muted-foreground hover:text-destructive touch-manipulation">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

function CategoriesModal({ categories, onClose, mutations }) {
  const [newName, setNewName] = useState('')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor),
  )

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const reordered = arrayMove(
      categories,
      categories.findIndex(c => c.id === active.id),
      categories.findIndex(c => c.id === over.id),
    )
    mutations.reorder.mutate(reordered.map(c => c.id))
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-sm max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Categories</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No categories yet.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={categories.map(c => c.id)} strategy={verticalListSortingStrategy}>
              <div className="mb-3">
                {categories.map(c => (
                  <SortableCategoryRow key={c.id} category={c}
                    onRename={(id, name) => mutations.rename.mutate({ id, name })}
                    onDeactivate={id => mutations.deactivate.mutate(id)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
        <form onSubmit={e => { e.preventDefault(); if (!newName.trim()) return; mutations.create.mutate(newName.trim()); setNewName('') }}
          className="flex gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New category"
            className="flex-1 border rounded px-3 py-2 text-sm min-h-[40px] touch-manipulation" />
          <button type="submit" disabled={!newName.trim()}
            className="bg-primary text-primary-foreground rounded px-3 py-2 text-sm font-medium min-h-[40px] disabled:opacity-50 touch-manipulation">
            <Plus className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────

export function HSActionLogPanel({ venueId }) {
  const api = useApi()
  const qc = useQueryClient()
  const [status, setStatus] = useState('open')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [entryModal, setEntryModal] = useState(null) // 'new' | entry row | null
  const [categoriesOpen, setCategoriesOpen] = useState(false)

  const enabled = !!venueId

  const { data: categories = [] } = useQuery({
    queryKey: ['hs-action-categories'],
    queryFn: () => api.get('/hs-action-log/categories'),
    enabled,
  })

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['hs-action-log', venueId, status, categoryFilter],
    queryFn: () => api.get(`/hs-action-log/entries?venue_id=${venueId}&status=${status}${categoryFilter ? `&category_id=${categoryFilter}` : ''}`),
    enabled,
  })

  const invalidateEntries = () => qc.invalidateQueries({ queryKey: ['hs-action-log'] })

  const createEntry = useMutation({
    mutationFn: body => api.post('/hs-action-log/entries', body),
    onSuccess: () => { invalidateEntries(); setEntryModal(null) },
  })
  const patchEntry = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/hs-action-log/entries/${id}`, body),
    onSuccess: () => { invalidateEntries(); setEntryModal(null) },
  })
  const deleteEntry = useMutation({
    mutationFn: id => api.delete(`/hs-action-log/entries/${id}`),
    onSuccess: () => { invalidateEntries(); setEntryModal(null) },
  })
  const toggleComplete = useMutation({
    mutationFn: ({ id, is_completed }) => api.patch(`/hs-action-log/entries/${id}/complete`, { is_completed }),
    onSuccess: invalidateEntries,
  })

  const invalidateCategories = () => qc.invalidateQueries({ queryKey: ['hs-action-categories'] })
  const categoryMutations = {
    create:     useMutation({ mutationFn: name => api.post('/hs-action-log/categories', { name }), onSuccess: invalidateCategories }),
    rename:     useMutation({ mutationFn: ({ id, name }) => api.patch(`/hs-action-log/categories/${id}`, { name }), onSuccess: invalidateCategories }),
    deactivate: useMutation({ mutationFn: id => api.delete(`/hs-action-log/categories/${id}`), onSuccess: invalidateCategories }),
    reorder:    useMutation({ mutationFn: ids => api.patch('/hs-action-log/categories/reorder', { ids }), onSuccess: invalidateCategories }),
  }

  function handleSave(body) {
    if (entryModal === 'new') createEntry.mutate(body)
    else patchEntry.mutate({ id: entryModal.id, ...body })
  }

  if (!enabled) return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {[['open', 'Open'], ['completed', 'Completed'], ['all', 'All']].map(([v, label]) => (
            <button key={v} type="button" onClick={() => setStatus(v)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap touch-manipulation',
                status === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}>
              {label}
            </button>
          ))}
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm bg-background min-h-[36px] touch-manipulation ml-1">
            <option value="">All categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setCategoriesOpen(true)}
            className="p-2 rounded hover:bg-accent text-muted-foreground touch-manipulation" title="Manage categories">
            <Settings className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setEntryModal('new')}
            className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium min-h-[40px] touch-manipulation">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8 border rounded-xl">Nothing here.</p>
      ) : (
        <div className="border rounded-xl divide-y overflow-hidden">
          {entries.map(entry => {
            const overdue = entry.due_date && !entry.is_completed && isPast(parseISO(entry.due_date))
            return (
              <div key={entry.id} className="flex items-start gap-3 px-4 py-3 hover:bg-accent/30">
                <button type="button"
                  onClick={() => toggleComplete.mutate({ id: entry.id, is_completed: !entry.is_completed })}
                  className={cn(
                    'w-6 h-6 mt-0.5 shrink-0 rounded-md border flex items-center justify-center touch-manipulation',
                    entry.is_completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'hover:bg-accent',
                  )}>
                  {entry.is_completed && <Check className="w-3.5 h-3.5" />}
                </button>
                <button type="button" onClick={() => setEntryModal(entry)} className="flex-1 min-w-0 text-left touch-manipulation">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('text-sm font-medium', entry.is_completed && 'line-through text-muted-foreground')}>
                      {entry.task}
                    </span>
                    {entry.category_name && (
                      <span className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{entry.category_name}</span>
                    )}
                    <span className={cn('text-[10px] rounded-full px-2 py-0.5 font-medium', PRIORITY_COLOURS[entry.priority])}>
                      {PRIORITY_LABELS[entry.priority]}
                    </span>
                    {entry.attachment_url && <Paperclip className="w-3 h-3 text-muted-foreground" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {entry.assigned_to && <>Assigned to {entry.assigned_to} · </>}
                    Raised {format(parseISO(entry.logged_date), 'd MMM yyyy')}
                    {entry.due_date && (
                      <span className={overdue ? 'text-destructive font-medium' : ''}>
                        {' '}· Due {format(parseISO(entry.due_date), 'd MMM yyyy')}{overdue ? ' (overdue)' : ''}
                      </span>
                    )}
                  </p>
                </button>
              </div>
            )
          })}
        </div>
      )}

      {entryModal && (
        <EntryModal
          initial={entryModal === 'new' ? null : entryModal}
          venueId={venueId}
          categories={categories}
          onClose={() => setEntryModal(null)}
          onSave={handleSave}
          onDelete={id => deleteEntry.mutate(id)}
          isSaving={createEntry.isPending || patchEntry.isPending}
        />
      )}

      {categoriesOpen && (
        <CategoriesModal categories={categories} onClose={() => setCategoriesOpen(false)} mutations={categoryMutations} />
      )}
    </div>
  )
}
