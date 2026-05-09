// components/website-builder/FontPicker.jsx
//
// Font picker — drop-in replacement for the plain <select>. Renders each
// option in its own typeface. The popover is portalled to document.body
// and positioned with viewport coordinates so it can never get clipped by
// an ancestor's overflow:hidden (e.g. SectionCard's rounded-rectangle wrap).
//
// All fonts in `fonts` are loaded once via a single Google Fonts <link>;
// subsequent FontPicker instances share it.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

let _fontsLinkInjected = false

// Google Fonts v2 returns HTTP 400 for the entire CSS file if any one
// requested font is missing a requested weight. So we ask each font
// only for weights it actually has.
const FONT_WEIGHTS = {
  'Inter':              '300;400;500;600;700;800',
  'Fraunces':           '300;400;500;600;700;800',
  'Caveat':             '400;500;600;700',
  'Playfair Display':   '400;500;600;700;800',
  'Poppins':            '300;400;500;600;700;800',
  'Lora':               '400;500;600;700',
  'Montserrat':         '300;400;500;600;700;800',
  'Roboto':             '300;400;500;700',
  'Open Sans':          '300;400;500;600;700;800',
  'Source Sans Pro':    '300;400;600;700',
  'Raleway':            '300;400;500;600;700;800',
  'Merriweather':       '300;400;700;900',
  'Work Sans':          '300;400;500;600;700;800',
  'Karla':              '300;400;500;600;700;800',
  'DM Sans':            '400;500;700',
  'DM Serif Display':   '400',
  'Space Grotesk':      '300;400;500;600;700',
  'Manrope':            '300;400;500;600;700;800',
  'Cormorant Garamond': '300;400;500;600;700',
  'Libre Baskerville':  '400;700',
  'Nunito':             '300;400;500;600;700;800',
  'Rubik':              '300;400;500;600;700;800',
}

function ensureFontsLoaded(fonts) {
  if (_fontsLinkInjected) return
  _fontsLinkInjected = true
  const families = fonts
    .map(f => `family=${encodeURIComponent(f)}:wght@${FONT_WEIGHTS[f] || '400;500;700'}`)
    .join('&')
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`
  link.id = 'pcf-font-picker-fonts'
  document.head.appendChild(link)
}

export function FontPicker({ value, onChange, fonts, placeholder = 'Pick a font' }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const popRef     = useRef(null)
  const [coords, setCoords] = useState({ left: 0, top: 0, width: 0 })

  useEffect(() => { ensureFontsLoaded(fonts) }, [fonts])

  // Position the popover under the trigger using viewport-fixed coords.
  // Recompute on open and on scroll / resize while open.
  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const r = triggerRef.current?.getBoundingClientRect()
      if (!r) return
      setCoords({ left: r.left, top: r.bottom + 4, width: r.width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true) // capture: catch any scrolling ancestor
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      if (triggerRef.current?.contains(e.target)) return
      if (popRef.current?.contains(e.target))     return
      setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full border rounded-md px-3 py-2 text-sm bg-background text-left flex items-center justify-between min-h-[44px] hover:border-primary/40"
      >
        <span style={{ fontFamily: value ? `"${value}", sans-serif` : 'inherit', fontSize: 16 }}>
          {value || <span className="text-muted-foreground" style={{ fontFamily: 'inherit' }}>{placeholder}</span>}
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            left:  coords.left,
            top:   coords.top,
            width: coords.width,
            zIndex: 9999,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
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
        </div>,
        document.body
      )}
    </>
  )
}
