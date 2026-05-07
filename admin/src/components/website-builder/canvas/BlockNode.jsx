// canvas/BlockNode.jsx
//
// Recursive primitive that renders a single block with its full editor
// chrome (BlockShell). Container blocks (currently just `columns`)
// receive a `renderChild` prop so they can call back into BlockNode for
// their nested children — this keeps the shell-rendering logic in one
// place and lets the page builder treat top-level and nested blocks
// uniformly.

import { BlockShell }   from './BlockShell'
import { getCanvasComponent } from './canvasRegistry'
import { BLOCK_BY_KEY } from '../blockRegistry'

export function BlockNode({
  block, parent, index, siblingCount,
  selectedId,
  onSelect, onPatch, onRemove, onDuplicate, onMove, onOpenInspector,
  onAddInColumn,
  config,
}) {
  const Canvas = getCanvasComponent(block.type)
  const def    = BLOCK_BY_KEY[block.type]

  return (
    <BlockShell
      blockId={block.id}
      selected={selectedId === block.id}
      onSelect={() => onSelect(block.id)}
      onRemove={() => onRemove(block.id)}
      onDuplicate={() => onDuplicate(block.id)}
      onMoveUp={() => onMove(block.id, -1)}
      onMoveDown={() => onMove(block.id, 1)}
      canMoveUp={index > 0}
      canMoveDown={index < siblingCount - 1}
      onOpenInspector={() => onOpenInspector(block.id)}
      label={def?.label || block.type}
    >
      {Canvas ? (
        <Canvas
          data={block.data}
          onChange={(data) => onPatch(block.id, data)}
          selected={selectedId === block.id}
          blockType={block.type}
          config={config}
          // Container-block-specific:
          parentBlockId={block.id}
          onAddInColumn={onAddInColumn}
          renderChild={(child, parentRef, childIdx, total) => (
            <BlockNode
              key={child.id}
              block={child}
              parent={parentRef}
              index={childIdx}
              siblingCount={total}
              selectedId={selectedId}
              onSelect={onSelect}
              onPatch={onPatch}
              onRemove={onRemove}
              onDuplicate={onDuplicate}
              onMove={onMove}
              onOpenInspector={onOpenInspector}
              onAddInColumn={onAddInColumn}
              config={config}
            />
          )}
        />
      ) : (
        <UnknownBlock type={block.type} />
      )}
    </BlockShell>
  )
}

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
