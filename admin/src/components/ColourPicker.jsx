// The colour picker for builders that store a colour code (menu screen
// boards, kiosk designs, tag colours): the tenant's website theme colours
// as swatches first, then a custom colour (the device's own colour picker,
// or a typed #rrggbb code).
//
// The website builder stores theme role names instead and uses
// ThemeColourPicker (website-builder/ThemeColourPicker.jsx), which has the
// same swatches plus its own custom colour.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

export const THEME_COLOUR_ROLES = [
  ['primary', 'Primary'], ['accent', 'Accent'], ['background', 'Background'], ['surface', 'Surface'],
  ['text', 'Text'], ['muted', 'Muted'], ['border', 'Border'],
]

const HEX = /^#[0-9a-f]{6}$/i

/** The website theme's colours (GET /api/me's site_theme), one swatch per distinct colour. */
export function useThemeColours() {
  const api = useApi()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const theme = me?.site_theme
  return useMemo(() => {
    const seen = new Set()
    const out = []
    for (const [key, label] of THEME_COLOUR_ROLES) {
      const hex = HEX.test(theme?.[key] || '') ? theme[key].toLowerCase() : null
      if (!hex || seen.has(hex)) continue
      seen.add(hex)
      out.push({ key, label, hex })
    }
    return out
  }, [theme])
}

/** Black or white, whichever reads better on the colour. */
export function inkOn(hex) {
  if (!HEX.test(hex || '')) return '#000000'
  const n = parseInt(hex.slice(1), 16)
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#000000' : '#ffffff'
}

/** One theme colour; ticked when it is the colour in use. */
export function Swatch({ hex, label, active, onClick, disabled, size = 'sm' }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={!!active}
      aria-label={label + ' ' + hex} title={label + ' (' + hex + ')'}
      className={cn('relative shrink-0 rounded-md border touch-manipulation flex items-center justify-center disabled:opacity-60',
        size === 'lg' ? 'w-10 h-10' : 'w-9 h-9',
        active ? 'ring-2 ring-primary ring-offset-1' : 'hover:ring-1 hover:ring-primary/40')}
      style={{ background: hex }}>
      {active && <Check className="w-4 h-4" style={{ color: inkOn(hex) }} />}
    </button>
  )
}

/**
 * @param value     '#rrggbb', or null / '' when optional and not set
 * @param optional  allow no colour (shows `placeholder` and a Reset button)
 */
export function ColourPicker({ label, value, onChange, optional = false, placeholder = 'Not set', disabled = false, testId }) {
  const theme = useThemeColours()
  const [text, setText] = useState(value || '')
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(value || '') }, [value, focused])
  const current = HEX.test(value || '') ? value.toLowerCase() : ''
  const custom = !!current && !theme.some(s => s.hex === current)
  return (
    <div data-testid={testId}>
      {label && <p className="text-[11px] text-muted-foreground mb-1">{label}</p>}
      {theme.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5" role="group" aria-label={(label ? label + ': ' : '') + 'theme colours'}>
          {theme.map(s => (
            <Swatch key={s.key} hex={s.hex} label={s.label} active={current === s.hex} disabled={disabled}
              onClick={() => onChange(s.hex)} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className={cn('relative shrink-0 rounded-md', custom && 'ring-2 ring-primary ring-offset-1')}>
          <input type="color" value={current || '#000000'} disabled={disabled}
            onChange={e => onChange(e.target.value.toLowerCase())}
            aria-label={(label ? label + ': ' : '') + 'custom colour'} title="Custom colour"
            className="block w-11 h-10 rounded-md border bg-background p-1 cursor-pointer touch-manipulation disabled:cursor-default" />
        </span>
        <input value={text} disabled={disabled} maxLength={7} spellCheck={false}
          placeholder={optional ? placeholder : '#000000'} aria-label={(label || 'Colour') + ' code'}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onChange={e => {
            const t = e.target.value.trim()
            setText(t)
            if (HEX.test(t)) onChange(t.toLowerCase())
            else if (!t && optional) onChange(null)
          }}
          className="flex-1 min-w-0 h-10 rounded-md border bg-background px-2 text-sm font-mono touch-manipulation" />
        {optional && value && !disabled && (
          <button type="button" onClick={() => onChange(null)}
            className="h-10 px-2 text-xs rounded-md border hover:bg-muted touch-manipulation shrink-0">Reset</button>
        )}
      </div>
    </div>
  )
}

/**
 * A toolbar button that opens the same choice in a small panel (a rich
 * text editor's text colour): theme swatches, a custom colour, and
 * optionally back to the default.
 */
export function ColourMenuButton({ title = 'Text colour', onPick, onClear, clearLabel = 'Default colour', align = 'left', className, children }) {
  const theme = useThemeColours()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const down = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const key = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key) }
  }, [open])
  const pick = hex => { onPick(hex); setOpen(false) }
  return (
    <span ref={ref} className="relative inline-flex">
      <button type="button" title={title} aria-label={title} aria-expanded={open} onClick={() => setOpen(o => !o)}
        className={cn('touch-manipulation', className)}>
        {children}
      </button>
      {open && (
        <div role="dialog" aria-label={title}
          className={cn('absolute z-30 top-full mt-1 w-[224px] rounded-lg border bg-background shadow-lg p-2.5 space-y-2', align === 'right' ? 'right-0' : 'left-0')}>
          {theme.length > 0 && (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">Website colours</p>
              <div className="flex flex-wrap gap-1">
                {theme.map(s => <Swatch key={s.key} hex={s.hex} label={s.label} onClick={() => pick(s.hex)} />)}
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs cursor-pointer min-h-[40px]">
            <input type="color" defaultValue="#000000" onChange={e => onPick(e.target.value.toLowerCase())}
              className="w-11 h-10 rounded-md border bg-background p-1 cursor-pointer touch-manipulation" />
            Custom colour
          </label>
          {onClear && (
            <button type="button" onClick={() => { onClear(); setOpen(false) }}
              className="w-full h-10 rounded-md border text-xs hover:bg-muted touch-manipulation">{clearLabel}</button>
          )}
        </div>
      )}
    </span>
  )
}
