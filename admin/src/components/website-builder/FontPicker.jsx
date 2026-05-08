// components/website-builder/FontPicker.jsx
//
// Drop-in replacement for the plain <select> font dropdown — renders each
// option in its own typeface so operators can see what they're picking
// before committing. Native <option> elements don't honour custom
// font-family in Chrome/Safari so we build a custom popover.
//
// Loads every font in `fonts` via one Google Fonts <link>, injected once
// into <head>. Subsequent FontPicker instances reuse the same link.

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

let _fontsLinkInjected = false

function ensureFontsLoaded(fonts) {
  // Only inject once per page — even if multiple FontPickers mount.
  if (_fontsLinkInjected) return
  _fontsLinkInjected = true
  const families = fonts
    .map(f => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700`)
    .join('&')
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`
  link.id = 'pcf-font-picker-fonts'
  document.head.appendChild(link)
}

export function FontPicker({ value, onChange, fonts, placeholder = 'Pick a font' }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => { ensureFontsLoaded(fonts) }, [fonts])

  useEffect(() => {
    if (!open) return
    function onDoc(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full border rounded-md px-3 py-2 text-sm bg-background text-left flex items-center justify-between min-h-[44px] hover:border-primary/40"
      >
        <span style={{ fontFamily: value ? `"${value}", sans-serif` : 'inherit', fontSize: 16 }}>
          {value || <span className="text-muted-foreground" style={{ fontFamily: 'inherit' }}>{placeholder}</span>}
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0, right: 0,
            zIndex: 50,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            maxHeight: 360,
            overflowY: 'auto',
          }}
        >
          {fonts.map(font => (
            <button
              key={font}
              type="button"
              onClick={() => { onChange(font); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%',
                padding: '10px 14px',
                background: value === font ? '#f3f4f6' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { if (value !== font) e.currentTarget.style.background = '#f9fafb' }}
              onMouseLeave={(e) => { if (value !== font) e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontFamily: `"${font}", sans-serif`, fontSize: 18, color: '#111827' }}>
                {font}
              </span>
              {value === font && <Check size={14} style={{ color: '#630812' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
