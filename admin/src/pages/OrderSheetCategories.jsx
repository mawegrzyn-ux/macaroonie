// src/pages/OrderSheetCategories.jsx
// Manage tenant-level order sheet categories (shared across all templates).
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2, X, Tag, Loader2, Check, Pencil } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

function SortableCategoryRow({ category, onSave, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(category.name)

  function handleSave() {
    const v = editName.trim()
    if (!v) return
    onSave(category.id, v)
    setEditing(false)
  }

  function handleCancel() {
    setEditName(category.name)
    setEditing(false)
  }

  return (
    <div ref={setNodeRef} style={style}
      className="flex items-center gap-2 py-2.5 border-b last:border-0">
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
            autoFocus
            className="flex-1 border rounded px-2 py-1.5 text-sm touch-manipulation min-h-[36px]"
          />
          <button onClick={handleSave}
            className="p-2 text-primary touch-manipulation" title="Save">
            <Check className="w-4 h-4" />
          </button>
          <button onClick={handleCancel}
            className="p-2 text-muted-foreground touch-manipulation" title="Cancel">
            <X className="w-4 h-4" />
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm">{category.name}</span>
          <button onClick={() => setEditing(true)}
            className="p-2 text-muted-foreground hover:text-foreground touch-manipulation" title="Rename">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(category.id)}
            className="p-2 text-muted-foreground hover:text-red-600 touch-manipulation" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

export default function OrderSheetCategories() {
  const api = useApi()
  const queryClient = useQueryClient()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor),
  )

  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState('')

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['order-sheets', 'categories'],
    queryFn:  () => api.get('/order-sheets/categories'),
  })

  const addMutation = useMutation({
    mutationFn: () => api.post('/order-sheets/categories', { name: newName.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries(['order-sheets', 'categories'])
      setNewName('')
      setAddError('')
    },
    onError: (err) => setAddError(err?.message ?? 'Add failed'),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }) => api.patch(`/order-sheets/categories/${id}`, { name }),
    onSuccess: () => queryClient.invalidateQueries(['order-sheets', 'categories']),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/order-sheets/categories/${id}`),
    onSuccess: () => queryClient.invalidateQueries(['order-sheets', 'categories']),
  })

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const reordered = arrayMove(
      categories,
      categories.findIndex(c => c.id === active.id),
      categories.findIndex(c => c.id === over.id),
    )
    queryClient.setQueryData(['order-sheets', 'categories'], reordered)
    api.patch('/order-sheets/categories/reorder', { ids: reordered.map(c => c.id) })
      .catch(() => queryClient.invalidateQueries(['order-sheets', 'categories']))
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
        <Tag className="w-4 h-4 text-muted-foreground" />
        <h1 className="font-semibold text-sm flex-1">Order Sheet Categories</h1>
        <p className="text-xs text-muted-foreground hidden sm:block">Shared across all templates</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto p-4 space-y-4">

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="border rounded-xl overflow-hidden">
              {categories.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                  No categories yet — add one below.
                </p>
              ) : (
                <div className="p-3">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={categories.map(c => c.id)} strategy={verticalListSortingStrategy}>
                      {categories.map(cat => (
                        <SortableCategoryRow
                          key={cat.id}
                          category={cat}
                          onSave={(id, name) => renameMutation.mutate({ id, name })}
                          onDelete={(id) => deleteMutation.mutate(id)}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              )}
              <div className={cn('flex gap-2 px-3 pb-3', categories.length > 0 && 'pt-2 border-t')}>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && newName.trim() && addMutation.mutate()}
                  placeholder="New category name"
                  className="flex-1 border rounded-lg px-3 py-2 text-sm touch-manipulation min-h-[44px]"
                />
                <button
                  onClick={() => { if (!newName.trim()) return; addMutation.mutate() }}
                  disabled={addMutation.isPending || !newName.trim()}
                  className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium touch-manipulation min-h-[44px] disabled:opacity-50"
                >
                  {addMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Add
                </button>
              </div>
              {addError && <p className="px-3 pb-3 text-sm text-red-600">{addError}</p>}
            </div>
          )}

          <p className="text-xs text-muted-foreground px-1">
            Deleting a category removes it from all items — items become uncategorised.
            Drag to reorder.
          </p>
        </div>
      </div>
    </div>
  )
}
