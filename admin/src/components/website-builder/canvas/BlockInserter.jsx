// canvas/BlockInserter.jsx
//
// The thin "+" zone that appears between blocks (and at the top/bottom
// of the page). Hovering reveals a button; clicking opens a popover
// listing all available block types grouped by category.
//
// The popover is anchored to the inserter and closes on outside click.

import { useEffect, useRef, useState } from 'react'
import { Plus, X, Search } from 'lucide-react'
import { BLOCKS, BLOCK_CATEGORIES } from '../blockRegistry'

export function BlockInserter({ onPick, mode = 'between', label }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = query.trim()
    ? BLOCKS.filter(b =>
        b.label.toLowerCase().includes(query.toLowerCase()) ||
        b.description.toLowerCase().includes(query.toLowerCase()))
    : BLOCKS

  // The "always-visible" mode (used when canvas is empty) renders a bigger, dashed CTA.
  if (mode === 'empty') {
    return (
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            width: '100%',
            border: '2px dashed #cbd5e1',
            borderRadius: 12,
            padding: '32px 24px',
            background: 'rgba(255,255,255,0.6)',
            color: '#475569',
            fontSize: 14, fontWeight: 500,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            cursor: 'pointer',
          }}
        >
          <Plus size={16} /> {label || 'Add your first block'}
        </button>
        {open && <Popover onClose={() => setOpen(false)} onPick={(k) => { onPick(k); setOpen(false) }}
          query={query} setQuery={setQuery} filtered={filtered} placement="below" />}
      </div>
    )
  }

  return (
    <div
      ref={wrapRef}
      className="pcf-inserter"
      style={{ position: 'relative', height: 24, margin: '0 0' }}
    >
      <div className="pcf-inserter-line" />
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Add block"
        aria-label="Add block"
        className="pcf-inserter-btn"
        style={{
          position: 'absolute',
          left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 28, height: 28,
          borderRadius: '50%',
          background: '#630812', color: '#fff',
          border: 'none', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          opacity: open ? 1 : 0,
          transition: 'opacity .12s',
          zIndex: 22,
        }}
      >
        <Plus size={16} />
      </button>
      {open && <Popover onClose={() => setOpen(false)} onPick={(k) => { onPick(k); setOpen(false) }}
        query={query} setQuery={setQuery} filtered={filtered} placement="below" />}
      <style>{`
        .pcf-inserter:hover .pcf-inserter-btn { opacity: 1; }
        .pcf-inserter:hover .pcf-inserter-line { opacity: 1; }
        .pcf-inserter-line {
          position: absolute; left: 0; right: 0; top: 50%;
          height: 2px;
          background: #630812;
          opacity: 0;
          transition: opacity .12s;
          pointer-events: none;
        }
      `}</style>
    </div>
  )
}

function Popover({ onClose, onPick, query, setQuery, filtered, placement }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: '50%', top: placement === 'below' ? 'calc(100% + 8px)' : 'auto',
        bottom: placement === 'above' ? 'calc(100% + 8px)' : 'auto',
        transform: 'translateX(-50%)',
        width: 'min(540px, 90vw)',
        maxHeight: 480,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(0,0,0,0.14)',
        zIndex: 100,
        display: 'flex', flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#111827',
      }}
    >
      <div style={{
        padding: '8px 10px', borderBottom: '1px solid #e5e7eb',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Search size={14} style={{ color: '#9ca3af' }} />
        <input
          type="text" placeholder="Search blocks…" autoFocus
          value={query} onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1, border: 'none', outline: 'none',
            fontSize: 13, padding: '4px 0',
          }}
        />
        <button type="button" onClick={onClose}
          style={{ border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer' }}>
          <X size={14} />
        </button>
      </div>
      <div style={{ overflowY: 'auto', padding: 10 }}>
        {BLOCK_CATEGORIES.map(cat => {
          const blocks = filtered.filter(b => b.category === cat.key)
          if (!blocks.length) return null
          return (
            <div key={cat.key} style={{ marginBottom: 12 }}>
              <p style={{
                fontSize: 10, textTransform: 'uppercase', fontWeight: 700,
                letterSpacing: '0.06em', color: '#6b7280', margin: '4px 6px 6px',
              }}>{cat.label}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {blocks.map(b => {
                  const Icon = b.icon
                  return (
                    <button
                      key={b.key} type="button" onClick={() => onPick(b.key)}
                      style={{
                        textAlign: 'left',
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        padding: '8px 10px',
                        background: 'transparent',
                        border: '1px solid transparent',
                        borderRadius: 6,
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#f3f4f6'; e.currentTarget.style.borderColor = '#e5e7eb' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}
                    >
                      {Icon && <Icon size={16} style={{ color: '#630812', marginTop: 2, flexShrink: 0 }} />}
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: '#111827' }}>{b.label}</p>
                        <p style={{ fontSize: 11, margin: '2px 0 0', color: '#6b7280', lineHeight: 1.35 }}>{b.description}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p style={{ textAlign: 'center', color: '#6b7280', fontSize: 13, padding: 24 }}>
            No blocks match “{query}”.
          </p>
        )}
      </div>
    </div>
  )
}
