// src/components/website-builder/PageBuilder.jsx
//
// Block-based page composition for tenant websites — Gutenberg / Editor.js
// style canvas. The user adds blocks via "+" inserters between blocks,
// drags to reorder via the always-visible grip, edits content inline on
// the canvas (TipTap-backed), and tunes block-specific options in a
// right-side inspector that opens when a block is selected.
//
// State flow:
//   - Draft `blocks` lives in component state.
//   - "Save" PATCHes website_config.home_blocks with the array.
//   - "Reset" reverts to the last saved version.
//   - "Apply template" replaces the current blocks (with confirm).
//   - Public-site CSS variables are loaded into the canvas via ThemeFrame.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  Save, RefreshCw, Layers, Loader2, Sparkles, X,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { newBlock, PAGE_TEMPLATES } from './blockRegistry'
import { ThemeFrame }     from './canvas/ThemeFrame'
import { BlockShell }     from './canvas/BlockShell'
import { BlockInserter }  from './canvas/BlockInserter'
import { BlockInspector } from './canvas/BlockInspector'
import { getCanvasComponent } from './canvas/canvasRegistry'

export function PageBuilder({ config }) {
  const api = useApi()
  const qc  = useQueryClient()

  const initial = useMemo(() => Array.isArray(config?.home_blocks) ? config.home_blocks : [], [config])
  const [blocks, setBlocks] = useState(initial)
  const [selectedId, setSelectedId] = useState(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)

  useEffect(() => {
    setBlocks(initial)
    setSelectedId(null)
    setInspectorOpen(false)
  }, [initial])

  const dirty = JSON.stringify(blocks) !== JSON.stringify(initial)
  const selectedBlock = blocks.find(b => b.id === selectedId) || null

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

  function addBlock(key, atIndex) {
    const block = newBlock(key)
    setBlocks(arr => {
      const idx = atIndex == null ? arr.length : atIndex
      return [...arr.slice(0, idx), block, ...arr.slice(idx)]
    })
    setSelectedId(block.id)
    setInspectorOpen(true)
  }

  function patchBlock(id, data) {
    setBlocks(arr => arr.map(b => b.id === id ? { ...b, data } : b))
  }
  function replaceBlock(id, next) {
    setBlocks(arr => arr.map(b => b.id === id ? next : b))
  }
  function removeBlock(id) {
    setBlocks(arr => arr.filter(b => b.id !== id))
    if (selectedId === id) { setSelectedId(null); setInspectorOpen(false) }
  }
  function duplicateBlock(id) {
    const idx = blocks.findIndex(b => b.id === id)
    if (idx < 0) return
    const dup = { ...blocks[idx], id: crypto.randomUUID(), data: structuredClone(blocks[idx].data) }
    setBlocks(arr => [...arr.slice(0, idx + 1), dup, ...arr.slice(idx + 1)])
    setSelectedId(dup.id)
  }
  function moveBlock(id, dir) {
    const idx = blocks.findIndex(b => b.id === id)
    if (idx < 0) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= blocks.length) return
    setBlocks(arr => arrayMove(arr, idx, newIdx))
  }

  function applyTemplate(tpl) {
    if (blocks.length > 0 && !window.confirm(`Replace all ${blocks.length} blocks with the "${tpl.label}" template?`)) return
    setBlocks(tpl.blocks.map(b => ({ id: crypto.randomUUID(), type: b.type, data: structuredClone(b.data) })))
    setTemplatesOpen(false)
    setSelectedId(null)
    setInspectorOpen(false)
  }

  return (
    <div className="space-y-3">
      {/* Top toolbar */}
      <div className="flex items-center justify-between border rounded-lg bg-background px-4 py-3 sticky top-0 z-10">
        <div>
          <p className="text-sm font-semibold inline-flex items-center gap-1.5">
            <Layers className="w-4 h-4" /> Page builder
          </p>
          <p className="text-xs text-muted-foreground">
            {blocks.length === 0
              ? 'Empty — start from a template or add a block.'
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

      {/* Canvas + Inspector */}
      <div className="flex gap-3 items-start">
        <div className="flex-1 min-w-0 border rounded-lg overflow-hidden bg-muted/30">
          {/* Click-on-empty-space deselects */}
          <div
            onClick={() => { setSelectedId(null); setInspectorOpen(false) }}
            className="px-12 py-6"
          >
            <ThemeFrame config={config}>
              {blocks.length === 0 ? (
                <div className="py-12">
                  <BlockInserter mode="empty" onPick={(k) => addBlock(k, 0)} />
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                    <BlockInserter onPick={(k) => addBlock(k, 0)} />
                    {blocks.map((block, i) => {
                      const Canvas = getCanvasComponent(block.type)
                      return (
                        <div key={block.id}>
                          <BlockShell
                            blockId={block.id}
                            selected={selectedId === block.id}
                            onSelect={() => setSelectedId(block.id)}
                            onRemove={() => removeBlock(block.id)}
                            onDuplicate={() => duplicateBlock(block.id)}
                            onMoveUp={() => moveBlock(block.id, -1)}
                            onMoveDown={() => moveBlock(block.id, 1)}
                            canMoveUp={i > 0}
                            canMoveDown={i < blocks.length - 1}
                            onOpenInspector={() => setInspectorOpen(true)}
                            label={block.type}
                          >
                            {Canvas ? (
                              <Canvas
                                data={block.data}
                                onChange={(data) => patchBlock(block.id, data)}
                                selected={selectedId === block.id}
                                blockType={block.type}
                                config={config}
                              />
                            ) : (
                              <UnknownBlock type={block.type} />
                            )}
                          </BlockShell>
                          <BlockInserter onPick={(k) => addBlock(k, i + 1)} />
                        </div>
                      )
                    })}
                  </SortableContext>
                </DndContext>
              )}
            </ThemeFrame>
          </div>
        </div>

        {/* Inspector */}
        {inspectorOpen && selectedBlock && (
          <BlockInspector
            block={selectedBlock}
            onChange={(next) => replaceBlock(selectedBlock.id, next)}
            onClose={() => setInspectorOpen(false)}
          />
        )}
      </div>

      {/* Floating "open inspector" hint when a block is selected but inspector closed */}
      {selectedBlock && !inspectorOpen && (
        <div className="fixed bottom-6 right-6 z-40">
          <button type="button" onClick={() => setInspectorOpen(true)}
            className="inline-flex items-center gap-2 bg-foreground text-background rounded-full px-4 py-2 text-sm shadow-lg hover:opacity-90">
            <Layers className="w-4 h-4" /> Open settings
          </button>
        </div>
      )}

      {templatesOpen && (
        <TemplatePickerModal onClose={() => setTemplatesOpen(false)} onApply={applyTemplate} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────

function UnknownBlock({ type }) {
  return (
    <div style={{
      padding: '24px',
      background: '#fee2e2',
      color: '#991b1b',
      border: '1px solid #fecaca',
      borderRadius: 8,
      fontSize: 14,
    }}>
      Unknown block type: <code>{type}</code>
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
