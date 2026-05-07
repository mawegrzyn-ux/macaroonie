// src/components/website-builder/PageBuilder.jsx
//
// Block-based page composition for tenant websites — Gutenberg / Editor.js
// style canvas. Top-level blocks AND nested blocks (inside Columns) share
// one selection model, one set of mutators (see ./blockTree.js), and one
// recursive node renderer (./canvas/BlockNode).

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCorners, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  Save, RefreshCw, Layers, Loader2, Sparkles, X,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { newBlock, PAGE_TEMPLATES } from './blockRegistry'
import { ThemeFrame }     from './canvas/ThemeFrame'
import { BlockInserter }  from './canvas/BlockInserter'
import { BlockInspector } from './canvas/BlockInspector'
import { BlockNode }      from './canvas/BlockNode'
import {
  flattenBlocks, findBlock,
  patchBlockData, replaceBlock as treeReplace,
  removeBlock as treeRemove,
  duplicateBlock as treeDuplicate,
  moveWithinParent, reorderWithinParent, insertAt, listForParent,
  moveAcrossParents, parentKey, parseParentKey,
} from './blockTree'

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
  const selectedBlock = selectedId ? findBlock(blocks, selectedId)?.block || null : null
  const blockCount    = flattenBlocks(blocks).length

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const save = useMutation({
    mutationFn: () => api.patch('/website/config', { home_blocks: blocks }),
    onSuccess:  (cfg) => qc.setQueryData(['website-config'], cfg),
  })

  // ── Drag-end: handles every move (top-level, within-column,
  //              cross-column, top↔column) under one DndContext.

  function isContainerId(id) {
    return id === 'top' || (typeof id === 'string' && id.startsWith('col:'))
  }
  function sameParent(a, b) {
    if (!a || !b) return false
    if (a.kind !== b.kind) return false
    if (a.kind === 'top') return true
    return a.blockId === b.blockId && a.columnId === b.columnId
  }

  function handleAnyDragEnd(e) {
    const { active, over } = e
    if (!over || active.id === over.id) return

    const sourceInfo = findBlock(blocks, active.id)
    if (!sourceInfo) return
    const sourceParent = sourceInfo.parent

    // Resolve the destination parent + index. The over target is either
    // another sortable block (drop NEXT TO it) or a container droppable
    // (drop AT END of the container).
    let destParent = null
    let destIndex  = null

    if (isContainerId(over.id)) {
      destParent = parseParentKey(over.id)
      if (!destParent) return
      destIndex  = listForParent(blocks, destParent).length
    } else {
      const overInfo = findBlock(blocks, over.id)
      if (!overInfo) return
      destParent = overInfo.parent
      const destList = listForParent(blocks, destParent)
      destIndex = destList.findIndex(b => b.id === over.id)
    }

    // No nested columns — silently bail.
    if (sourceInfo.block.type === 'columns' && destParent.kind === 'column') return

    if (sameParent(sourceParent, destParent)) {
      // Within the same parent. If the over target was the container
      // itself there's nothing to reorder against.
      if (isContainerId(over.id)) return
      setBlocks(arr => reorderWithinParent(arr, sourceParent, active.id, over.id))
    } else {
      setBlocks(arr => moveAcrossParents(arr, active.id, sourceParent, destParent, destIndex))
    }
  }

  // ── Top-level inserts ───────────────────────────────────────

  function addTop(key, atIndex) {
    const block = newBlock(key)
    setBlocks(arr => insertAt(arr, { kind: 'top' }, atIndex, block))
    setSelectedId(block.id)
    setInspectorOpen(true)
  }

  // ── Tree-aware mutators (work on any block, top-level or nested) ─

  function patch(id, data) { setBlocks(arr => patchBlockData(arr, id, data)) }
  function replace(id, next) { setBlocks(arr => treeReplace(arr, id, next)) }
  function remove(id) {
    setBlocks(arr => treeRemove(arr, id))
    if (selectedId === id) { setSelectedId(null); setInspectorOpen(false) }
  }
  function duplicate(id) {
    setBlocks(arr => treeDuplicate(arr, id))
  }
  function move(id, dir) {
    setBlocks(arr => moveWithinParent(arr, id, dir))
  }

  // Add a block inside a column. Called from ColumnsCanvas.
  function addInColumn(parentRef, atIndex, key) {
    const block = newBlock(key)
    setBlocks(arr => insertAt(arr, parentRef, atIndex, block))
    setSelectedId(block.id)
    setInspectorOpen(true)
  }

  // ── Templates ───────────────────────────────────────────────

  function applyTemplate(tpl) {
    if (blocks.length > 0 && !window.confirm(`Replace all ${blocks.length} blocks with the "${tpl.label}" template?`)) return
    setBlocks(tpl.blocks.map(b => ({ id: crypto.randomUUID(), type: b.type, data: structuredClone(b.data) })))
    setTemplatesOpen(false)
    setSelectedId(null)
    setInspectorOpen(false)
  }

  // ── Render ──────────────────────────────────────────────────

  const nodeHandlers = {
    selectedId,
    onSelect:        (id) => setSelectedId(id),
    onPatch:         patch,
    onRemove:        remove,
    onDuplicate:     duplicate,
    onMove:          move,
    onOpenInspector: (id) => { setSelectedId(id); setInspectorOpen(true) },
    onAddInColumn:   addInColumn,
    config,
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
            {blockCount === 0
              ? 'Empty — start from a template or add a block.'
              : `${blockCount} block${blockCount !== 1 ? 's' : ''}` + (dirty ? ' · unsaved changes' : ' · saved')}
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
        <div className="flex-1 min-w-0 border rounded-lg bg-muted/30">
          <div
            onClick={() => { setSelectedId(null); setInspectorOpen(false) }}
            className="px-12 py-6"
          >
            <ThemeFrame config={config}>
              {blocks.length === 0 ? (
                <div className="py-12">
                  <BlockInserter mode="empty" onPick={(k) => addTop(k, 0)} />
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleAnyDragEnd}>
                  <SortableContext id="top" items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                    <BlockInserter onPick={(k) => addTop(k, 0)} />
                    {blocks.map((block, i) => (
                      <div key={block.id}>
                        <BlockNode
                          block={block}
                          parent={{ kind: 'top' }}
                          index={i}
                          siblingCount={blocks.length}
                          {...nodeHandlers}
                        />
                        <BlockInserter onPick={(k) => addTop(k, i + 1)} />
                      </div>
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </ThemeFrame>
          </div>
        </div>

        {inspectorOpen && selectedBlock && (
          <BlockInspector
            block={selectedBlock}
            onChange={(next) => replace(selectedBlock.id, next)}
            onClose={() => setInspectorOpen(false)}
          />
        )}
      </div>

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
