// blockTree.js
//
// Pure helpers for working with the (potentially nested) home_blocks tree.
// A "tree" is the top-level block list. Some block types are containers
// (currently just `columns`) whose `data.columns` is an array of
// { id, blocks: [...] } — each column is its own ordered list of children.
//
// The page builder uses these to find / update / remove / move blocks
// anywhere in the tree without caring whether a block is at the top
// level or nested inside a column.

// ── Walking ──────────────────────────────────────────────────

// Return a flat array of every block in the tree, in render order.
export function flattenBlocks(tree) {
  const out = []
  const walk = (list) => {
    for (const b of list) {
      out.push(b)
      if (b.type === 'columns' && Array.isArray(b.data?.columns)) {
        for (const col of b.data.columns) walk(col.blocks || [])
      }
    }
  }
  walk(tree || [])
  return out
}

// Return { block, parent } where parent describes where the block lives.
//   parent is one of:
//     { kind: 'top' }                                 — top-level list
//     { kind: 'column', blockId, columnId }            — inside a column
// Returns null if not found.
export function findBlock(tree, id) {
  const search = (list, parent) => {
    for (const b of list) {
      if (b.id === id) return { block: b, parent }
      if (b.type === 'columns' && Array.isArray(b.data?.columns)) {
        for (const col of b.data.columns) {
          const found = search(col.blocks || [], { kind: 'column', blockId: b.id, columnId: col.id })
          if (found) return found
        }
      }
    }
    return null
  }
  return search(tree || [], { kind: 'top' })
}

// ── Mutating (immutably) ─────────────────────────────────────

// Apply a function to one block by id, returning a new tree.
export function patchBlock(tree, id, fn) {
  return mapTree(tree, (b) => b.id === id ? fn(b) : b)
}

export function patchBlockData(tree, id, data) {
  return patchBlock(tree, id, (b) => ({ ...b, data }))
}

export function replaceBlock(tree, id, next) {
  return patchBlock(tree, id, () => next)
}

// Walk the tree, calling fn on every block. The returned block replaces
// the original in the new tree. Children are walked AFTER the parent,
// using whatever object the parent returned (so updates propagate).
function mapTree(tree, fn) {
  return (tree || []).map(b => {
    const next = fn(b) || b
    if (next.type === 'columns' && Array.isArray(next.data?.columns)) {
      const newCols = next.data.columns.map(col => ({
        ...col,
        blocks: mapTree(col.blocks || [], fn),
      }))
      return { ...next, data: { ...next.data, columns: newCols } }
    }
    return next
  })
}

// Remove a block by id, returning a new tree. Container blocks are
// kept even if they end up empty.
export function removeBlock(tree, id) {
  const out = []
  for (const b of (tree || [])) {
    if (b.id === id) continue
    if (b.type === 'columns' && Array.isArray(b.data?.columns)) {
      const newCols = b.data.columns.map(col => ({
        ...col,
        blocks: removeBlock(col.blocks || [], id),
      }))
      out.push({ ...b, data: { ...b.data, columns: newCols } })
    } else {
      out.push(b)
    }
  }
  return out
}

// Duplicate a block by id, inserting the dup right after it.
export function duplicateBlock(tree, id) {
  return (tree || []).flatMap(b => {
    if (b.type === 'columns' && Array.isArray(b.data?.columns)) {
      // Recurse into columns first.
      const newCols = b.data.columns.map(col => ({
        ...col,
        blocks: duplicateBlock(col.blocks || [], id),
      }))
      const next = { ...b, data: { ...b.data, columns: newCols } }
      return b.id === id ? [next, cloneWithFreshIds(next)] : [next]
    }
    return b.id === id ? [b, cloneWithFreshIds(b)] : [b]
  })
}

// Deep-clone a block and assign fresh UUIDs to it and any nested blocks.
export function cloneWithFreshIds(block) {
  const data = structuredClone(block.data)
  if (block.type === 'columns' && Array.isArray(data?.columns)) {
    data.columns = data.columns.map(col => ({
      id: crypto.randomUUID(),
      blocks: (col.blocks || []).map(cloneWithFreshIds),
    }))
  }
  return { ...block, id: crypto.randomUUID(), data }
}

// ── Inserting ────────────────────────────────────────────────

// Insert `block` at index `at` in the parent identified by `parent`.
//   parent === null OR { kind: 'top' } → top level
//   parent === { kind: 'column', blockId, columnId }
export function insertAt(tree, parent, at, block) {
  if (!parent || parent.kind === 'top') {
    const next = (tree || []).slice()
    const idx = at == null ? next.length : Math.max(0, Math.min(next.length, at))
    next.splice(idx, 0, block)
    return next
  }
  if (parent.kind === 'column') {
    return mapTree(tree, (b) => {
      if (b.id !== parent.blockId) return b
      const newCols = (b.data.columns || []).map(col => {
        if (col.id !== parent.columnId) return col
        const blocks = (col.blocks || []).slice()
        const idx = at == null ? blocks.length : Math.max(0, Math.min(blocks.length, at))
        blocks.splice(idx, 0, block)
        return { ...col, blocks }
      })
      return { ...b, data: { ...b.data, columns: newCols } }
    })
  }
  return tree
}

// ── Moving ───────────────────────────────────────────────────

// Move a block by ±1 within its current parent. No-op if at boundary.
export function moveWithinParent(tree, id, dir) {
  // Top level
  const topIdx = (tree || []).findIndex(b => b.id === id)
  if (topIdx >= 0) {
    const newIdx = topIdx + dir
    if (newIdx < 0 || newIdx >= tree.length) return tree
    const next = tree.slice()
    const [moved] = next.splice(topIdx, 1)
    next.splice(newIdx, 0, moved)
    return next
  }
  // Inside a column
  return mapTree(tree, (b) => {
    if (b.type !== 'columns' || !Array.isArray(b.data?.columns)) return b
    let mutated = false
    const newCols = b.data.columns.map(col => {
      const idx = (col.blocks || []).findIndex(c => c.id === id)
      if (idx < 0) return col
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= col.blocks.length) return col
      const blocks = col.blocks.slice()
      const [moved] = blocks.splice(idx, 1)
      blocks.splice(newIdx, 0, moved)
      mutated = true
      return { ...col, blocks }
    })
    return mutated ? { ...b, data: { ...b.data, columns: newCols } } : b
  })
}

// Reorder within a single sortable list (top level OR a specific column).
export function reorderWithinParent(tree, parent, fromId, toId) {
  if (!parent || parent.kind === 'top') {
    const fromIdx = tree.findIndex(b => b.id === fromId)
    const toIdx   = tree.findIndex(b => b.id === toId)
    if (fromIdx < 0 || toIdx < 0) return tree
    const next = tree.slice()
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    return next
  }
  if (parent.kind === 'column') {
    return mapTree(tree, (b) => {
      if (b.id !== parent.blockId) return b
      const newCols = b.data.columns.map(col => {
        if (col.id !== parent.columnId) return col
        const blocks = col.blocks || []
        const fromIdx = blocks.findIndex(c => c.id === fromId)
        const toIdx   = blocks.findIndex(c => c.id === toId)
        if (fromIdx < 0 || toIdx < 0) return col
        const next = blocks.slice()
        const [moved] = next.splice(fromIdx, 1)
        next.splice(toIdx, 0, moved)
        return { ...col, blocks: next }
      })
      return { ...b, data: { ...b.data, columns: newCols } }
    })
  }
  return tree
}

// ── Cross-container move ─────────────────────────────────────

// Move a block from one parent to another. Used by cross-container DnD.
// Returns the new tree.
export function moveAcrossParents(tree, id, fromParent, toParent, toIndex) {
  const found = findBlock(tree, id)
  if (!found) return tree
  const movedBlock = found.block
  const without = removeBlock(tree, id)
  return insertAt(without, toParent, toIndex, movedBlock)
}

// Convenience: read a parent's blocks list from the tree.
export function listForParent(tree, parent) {
  if (!parent || parent.kind === 'top') return tree
  if (parent.kind === 'column') {
    const found = findBlock(tree, parent.blockId)
    if (!found) return []
    const col = (found.block.data?.columns || []).find(c => c.id === parent.columnId)
    return col?.blocks || []
  }
  return []
}

// Stable string key for a parent — used as @dnd-kit container id.
export function parentKey(parent) {
  if (!parent || parent.kind === 'top') return 'top'
  return `col:${parent.blockId}:${parent.columnId}`
}
export function parseParentKey(key) {
  if (key === 'top') return { kind: 'top' }
  const m = /^col:([^:]+):(.+)$/.exec(key)
  if (!m) return null
  return { kind: 'column', blockId: m[1], columnId: m[2] }
}
