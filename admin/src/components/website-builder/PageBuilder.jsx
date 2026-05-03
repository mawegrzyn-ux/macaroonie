// src/components/website-builder/PageBuilder.jsx
//
// Block-based page composition for tenant websites — the Gutenberg-style
// builder. The user adds blocks from a palette, edits each inline, drags
// to reorder, and optionally starts from a template.
//
// State flow:
//   - Draft `blocks` lives in component state.
//   - "Save" PATCHes website_config.home_blocks with the array.
//   - "Reset" reverts to the last saved version.
//   - "Apply template" replaces the current blocks (with confirm).
//   - The Eta renderer reads home_blocks at render time. When empty/null,
//     templates fall back to the legacy flat layout.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, arrayMove, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical, Plus, Trash2, ChevronDown, ChevronUp, Save, RefreshCw, Layers,
  Loader2, X, Sparkles,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  BLOCKS, BLOCK_BY_KEY, BLOCK_CATEGORIES, PAGE_TEMPLATES, newBlock,
} from './blockRegistry'

export function PageBuilder({ config }) {
  const api = useApi()
  const qc  = useQueryClient()

  const initial = useMemo(() => Array.isArray(config?.home_blocks) ? config.home_blocks : [], [config])
  const [blocks, setBlocks] = useState(initial)
  const [openId, setOpenId] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerInsertAt, setPickerInsertAt] = useState(null)   // index | null (append)
  const [templatesOpen, setTemplatesOpen] = useState(false)

  useEffect(() => { setBlocks(initial); setOpenId(null) }, [initial])

  const dirty = JSON.stringify(blocks) !== JSON.stringify(initial)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const save = useMutation({
    mutationFn: () => api.patch('/website/config', { home_blocks: blocks }),
    onSuccess:  (cfg) => qc.setQueryData(['website-config'], cfg),
  })

  function handleDragEnd(e) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = blocks.findIndex(b => b.id === active.id)
    const newIdx = blocks.findIndex(b => b.id === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    setBlocks(arr => arrayMove(arr, oldIdx, newIdx))
  }

  function addBlock(key, atIndex = null) {
    const block = newBlock(key)
    setBlocks(arr => {
      if (atIndex == null) return [...arr, block]
      return [...arr.slice(0, atIndex), block, ...arr.slice(atIndex)]
    })
    setOpenId(block.id)
    setPickerOpen(false)
    setPickerInsertAt(null)
  }
  function removeBlock(id) { setBlocks(arr => arr.filter(b => b.id !== id)) }
  function patchBlock(id, data) {
    setBlocks(arr => arr.map(b => b.id === id ? { ...b, data } : b))
  }
  function duplicateBlock(id) {
    const idx = blocks.findIndex(b => b.id === id)
    if (idx < 0) return
    const dup = { ...blocks[idx], id: crypto.randomUUID(), data: structuredClone(blocks[idx].data) }
    setBlocks(arr => [...arr.slice(0, idx + 1), dup, ...arr.slice(idx + 1)])
  }

  function applyTemplate(tpl) {
    if (blocks.length > 0 && !window.confirm(`Replace all ${blocks.length} blocks with the "${tpl.label}" template?`)) return
    setBlocks(tpl.blocks.map(b => ({ id: crypto.randomUUID(), type: b.type, data: structuredClone(b.data) })))
    setTemplatesOpen(false)
    setOpenId(null)
  }

  return (
    <div className="space-y-4">
      {/* Header / actions */}
      <div className="flex items-center justify-between border rounded-lg bg-background px-4 py-3">
        <div>
          <p className="text-sm font-semibold inline-flex items-center gap-1.5">
            <Layers className="w-4 h-4" /> Page builder
          </p>
          <p className="text-xs text-muted-foreground">
            {blocks.length === 0
              ? 'Empty — start from a template or add blocks below.'
              : `${blocks.length} block${blocks.length !== 1 ? 's' : ''}` + (dirty ? ' · unsaved changes' : ' · saved')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setTemplatesOpen(true)}
            className="inline-flex items-center gap-1.5 border rounded-md px-3 py-2 text-sm hover:bg-accent min-h-[36px]">
            <Sparkles className="w-3.5 h-3.5" /> Templates
          </button>
          {dirty && (
            <button type="button" onClick={() => setBlocks(initial)}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2 py-2">
              <RefreshCw className="w-3.5 h-3.5" /> Reset
            </button>
          )}
          <button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}
            className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm font-medium min-h-[36px] disabled:opacity-50">
            {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>

      {/* Block list */}
      {blocks.length === 0 ? (
        <EmptyState onAdd={() => { setPickerOpen(true); setPickerInsertAt(null) }}
          onTemplate={() => setTemplatesOpen(true)} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {blocks.map((block, i) => (
                <SortableBlockRow key={block.id} block={block}
                  expanded={openId === block.id}
                  onToggle={() => setOpenId(openId === block.id ? null : block.id)}
                  onPatch={(data) => patchBlock(block.id, data)}
                  onRemove={() => { removeBlock(block.id); if (openId === block.id) setOpenId(null) }}
                  onDuplicate={() => duplicateBlock(block.id)}
                  onAddBelow={() => { setPickerInsertAt(i + 1); setPickerOpen(true) }} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Append block button (always visible at the bottom) */}
      <button type="button" onClick={() => { setPickerInsertAt(null); setPickerOpen(true) }}
        className="w-full border-2 border-dashed rounded-lg py-4 text-sm text-muted-foreground hover:text-foreground hover:border-primary inline-flex items-center justify-center gap-1.5">
        <Plus className="w-4 h-4" /> Add a block
      </button>

      {/* Block picker modal */}
      {pickerOpen && (
        <BlockPickerModal
          onClose={() => { setPickerOpen(false); setPickerInsertAt(null) }}
          onPick={(key) => addBlock(key, pickerInsertAt)} />
      )}

      {/* Template picker modal */}
      {templatesOpen && (
        <TemplatePickerModal onClose={() => setTemplatesOpen(false)} onApply={applyTemplate} />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────

function SortableBlockRow({ block, expanded, onToggle, onPatch, onRemove, onDuplicate, onAddBelow }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const def = BLOCK_BY_KEY[block.type]
  const Icon   = def?.icon
  const Editor = def?.editor

  return (
    <div ref={setNodeRef} style={style}
      className={cn('border rounded-lg bg-background overflow-hidden',
        expanded && 'border-primary shadow-sm')}>
      <div className="flex items-center gap-2 px-3 py-2.5 group">
        <button type="button" {...attributes} {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1"
          aria-label="Drag to reorder">
          <GripVertical className="w-4 h-4" />
        </button>
        <button type="button" onClick={onToggle}
          className="flex-1 flex items-center gap-2 text-left min-w-0">
          {Icon && <Icon className="w-4 h-4 text-muted-foreground shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{def?.label ?? block.type}</p>
            <p className="text-xs text-muted-foreground truncate">{summarise(block)}</p>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button type="button" onClick={onDuplicate} title="Duplicate"
            className="p-1.5 rounded text-muted-foreground hover:bg-accent">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onRemove} title="Remove"
            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {expanded && Editor && (
        <div className="border-t p-4 bg-muted/10">
          <Editor data={block.data} onChange={onPatch} blockType={block.type} />
          <div className="border-t mt-4 pt-3 flex justify-end">
            <button type="button" onClick={onAddBelow}
              className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
              <Plus className="w-3 h-3" /> Add block below
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function summarise(block) {
  const d = block.data || {}
  if (block.type === 'hero')         return d.heading || '—'
  if (block.type === 'text')         return stripHtml(d.html).slice(0, 80) || '—'
  if (block.type === 'image')        return d.caption || d.alt || (d.url ? 'Image' : 'No image')
  if (block.type === 'two_column')   return d.heading || stripHtml(d.body_html).slice(0, 60) || '—'
  if (block.type === 'cta_strip')    return `${d.heading || ''} → ${d.cta_text || ''}`
  if (block.type === 'faq')          return `${(d.items || []).length} question${(d.items || []).length !== 1 ? 's' : ''}`
  if (block.type === 'divider')      return `${d.style || 'line'} · ${d.size || 'medium'}`
  // Data blocks just show their heading
  return d.heading || 'Pulled from config'
}

function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// ──────────────────────────────────────────────────────────

function EmptyState({ onAdd, onTemplate }) {
  return (
    <div className="border-2 border-dashed rounded-lg py-12 text-center">
      <Layers className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
      <p className="text-sm font-medium mb-1">Start composing your page</p>
      <p className="text-xs text-muted-foreground mb-4">
        Pick a starting template, or add blocks one at a time.
      </p>
      <div className="flex justify-center gap-2">
        <button type="button" onClick={onTemplate}
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium">
          <Sparkles className="w-3.5 h-3.5" /> Browse templates
        </button>
        <button type="button" onClick={onAdd}
          className="inline-flex items-center gap-1.5 border rounded-md px-4 py-2 text-sm hover:bg-accent">
          <Plus className="w-3.5 h-3.5" /> Add a block
        </button>
      </div>
    </div>
  )
}

function BlockPickerModal({ onClose, onPick }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-5 h-14 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">Add a block</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {BLOCK_CATEGORIES.map(cat => {
            const blocks = BLOCKS.filter(b => b.category === cat.key)
            if (!blocks.length) return null
            return (
              <div key={cat.key}>
                <p className="text-xs uppercase font-semibold text-muted-foreground tracking-wide mb-2">{cat.label}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {blocks.map(b => {
                    const Icon = b.icon
                    return (
                      <button key={b.key} type="button" onClick={() => onPick(b.key)}
                        className="text-left border rounded-lg p-3 hover:border-primary hover:shadow-sm">
                        <div className="flex items-center gap-2 mb-1">
                          {Icon && <Icon className="w-4 h-4 text-primary" />}
                          <p className="text-sm font-medium">{b.label}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">{b.description}</p>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TemplatePickerModal({ onClose, onApply }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-5 h-14 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">Start from a template</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {PAGE_TEMPLATES.map(t => (
            <button key={t.key} type="button" onClick={() => onApply(t)}
              className="text-left border rounded-lg p-4 hover:border-primary hover:shadow-sm">
              <p className="text-sm font-semibold mb-1">{t.label}</p>
              <p className="text-xs text-muted-foreground mb-3">{t.description}</p>
              <div className="flex flex-wrap gap-1">
                {t.blocks.length === 0
                  ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">empty</span>
                  : t.blocks.map((b, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
                    {b.type}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
