// canvas/BlockShell.jsx
//
// Wraps every block on the canvas with the editor chrome:
//   - Click anywhere in the block to select it
//   - Hover/selected outline
//   - Drag handle on the left edge (always visible)
//   - Floating toolbar above the block (only when selected): duplicate,
//     delete, settings, move up/down
//
// The actual block content is rendered as `children`.

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical, Copy, Trash2, ChevronUp, ChevronDown, Settings,
} from 'lucide-react'

export function BlockShell({
  blockId,
  selected,
  onSelect,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onOpenInspector,
  canMoveUp = true,
  canMoveDown = true,
  children,
  label,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: blockId })

  const wrapperStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: 'relative',
    outline: isDragging
      ? '2px dashed rgba(99, 8, 18, 0.6)'
      : selected
      ? '2px solid var(--c-primary)'
      : '2px solid transparent',
    outlineOffset: -2,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={wrapperStyle}
      data-selected={selected ? 'true' : 'false'}
      className="pcf-block group"
      onClick={(e) => { e.stopPropagation(); onSelect?.() }}
    >
      {/* Drag handle — always visible at the left edge */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder"
        aria-label="Drag to reorder"
        style={{
          position: 'absolute',
          left: -36, top: 16,
          width: 28, height: 28,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: '#fff',
          color: '#6b7280',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          cursor: 'grab',
          zIndex: 20,
          opacity: 0,
          transition: 'opacity .12s',
        }}
        className="pcf-drag-handle"
      >
        <GripVertical size={16} />
      </button>

      {/* Selection toolbar — floats above the block when selected */}
      {selected && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: -40, right: 0,
            display: 'flex', alignItems: 'center', gap: 2,
            background: '#1f2937', color: '#fff',
            padding: '4px 6px',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
            zIndex: 25,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: 13,
          }}
        >
          {label && (
            <span style={{
              padding: '0 8px',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#9ca3af',
              fontWeight: 600,
            }}>{label}</span>
          )}
          <ToolbarBtn title="Move up"   disabled={!canMoveUp}   onClick={onMoveUp}><ChevronUp size={14}/></ToolbarBtn>
          <ToolbarBtn title="Move down" disabled={!canMoveDown} onClick={onMoveDown}><ChevronDown size={14}/></ToolbarBtn>
          <ToolbarSep />
          <ToolbarBtn title="Settings"  onClick={onOpenInspector}><Settings size={14}/></ToolbarBtn>
          <ToolbarBtn title="Duplicate" onClick={onDuplicate}><Copy size={14}/></ToolbarBtn>
          <ToolbarBtn title="Delete"    onClick={onRemove} danger><Trash2 size={14}/></ToolbarBtn>
        </div>
      )}

      {/* The block content itself */}
      {children}
    </div>
  )
}

function ToolbarBtn({ title, onClick, disabled, danger, children }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        padding: '5px 6px',
        background: 'transparent',
        color: danger ? '#fca5a5' : '#fff',
        border: 'none',
        borderRadius: 4,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        display: 'inline-flex', alignItems: 'center',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = danger ? '#7f1d1d' : '#374151' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >{children}</button>
  )
}

function ToolbarSep() {
  return <span style={{ width: 1, alignSelf: 'stretch', background: '#374151', margin: '0 2px' }} />
}
