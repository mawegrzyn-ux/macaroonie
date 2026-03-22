// src/contexts/SettingsContext.jsx
// Manages global app settings persisted in localStorage.
// On mount, applies saved theme colour and status colours to CSS variables.

import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const Ctx = createContext(null)

const STORAGE_KEY = 'maca_settings'
export const DEFAULT_THEME_HEX        = '#630812'
export const DEFAULT_TIMELINE_BG     = '#ffffff'
export const DEFAULT_GREY_COLOUR     = '#8c8c8c'
export const DEFAULT_START_LINE_COLOUR = '#630812'

export const DEFAULT_STATUS_COLOURS = {
  unconfirmed:     '#fed7aa',
  confirmed:       '#bfdbfe',
  reconfirmed:     '#c7d2fe',
  pending_payment: '#fde68a',
  arrived:         '#a5f3fc',
  seated:          '#86efac',
  checked_out:     '#e5e7eb',
  cancelled:       '#fca5a5',
  no_show:         '#d1d5db',
}

// Convert a hex colour + alpha to a CSS rgba() string.
// Used so stored hex colours can be applied with a specific opacity.
export function hexToRgba(hex, alpha = 1) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return `rgba(140,140,140,${alpha})`
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ── Colour helpers ──────────────────────────────────────────────

// Convert a #rrggbb hex string to the "H S% L%" format used by CSS custom properties.
export function hexToHsl(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const delta = max - min
  const l = (max + min) / 2
  let h = 0, s = 0
  if (delta > 0) {
    s = delta / (1 - Math.abs(2 * l - 1))
    if (max === r)      h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else                h = (r - g) / delta + 4
    h = Math.round(h * 60)
    if (h < 0) h += 360
  }
  return `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

// Pick white or near-black foreground based on luminance of the background hex.
function fgForHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '224 14% 10%' : '0 0% 100%'
}

// Derive a darker border colour from a background hex by reducing HSL lightness ~30pp.
// Preserves hue and saturation so e.g. light blue → saturated blue.
export function deriveBorderFromBg(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const delta = max - min
  let h = 0, s = 0
  if (delta > 0) {
    s = delta / (1 - Math.abs(2 * l - 1))
    if (max === r)      h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else                h = (r - g) / delta + 4
    h *= 60; if (h < 0) h += 360
  }
  const newL = Math.max(0.05, l - 0.30)
  const c  = (1 - Math.abs(2 * newL - 1)) * s
  const x  = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m  = newL - c / 2
  let rp = 0, gp = 0, bp = 0
  if      (h < 60)  { rp = c; gp = x; bp = 0 }
  else if (h < 120) { rp = x; gp = c; bp = 0 }
  else if (h < 180) { rp = 0; gp = c; bp = x }
  else if (h < 240) { rp = 0; gp = x; bp = c }
  else if (h < 300) { rp = x; gp = 0; bp = c }
  else              { rp = c; gp = 0; bp = x }
  return '#' + [rp + m, gp + m, bp + m]
    .map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0'))
    .join('')
}

// ── CSS variable application ────────────────────────────────────

export function applyTheme(hex) {
  const hsl = hexToHsl(hex)
  if (!hsl) return
  document.documentElement.style.setProperty('--primary', hsl)
  document.documentElement.style.setProperty('--primary-foreground', fgForHex(hex))
}

// Write --status-{name}-bg and --status-{name}-bd CSS variables for each status.
// The CSS vars are consumed by .timeline-slot.{status} rules in index.css.
export function applyStatusColours(colours) {
  const root = document.documentElement.style
  for (const [status, bg] of Object.entries(colours)) {
    const key = status.replace(/_/g, '-')          // pending_payment → pending-payment
    root.setProperty(`--status-${key}-bg`, bg)
    root.setProperty(`--status-${key}-bd`, deriveBorderFromBg(bg))
  }
}

// ── Persistence ─────────────────────────────────────────────────

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
    return {
      themeHex:         s.themeHex         ?? DEFAULT_THEME_HEX,
      statusColours:    { ...DEFAULT_STATUS_COLOURS, ...(s.statusColours ?? {}) },
      timelineBg:       s.timelineBg       ?? DEFAULT_TIMELINE_BG,
      greyColour:       s.greyColour       ?? DEFAULT_GREY_COLOUR,
      startLineColour:  s.startLineColour  ?? DEFAULT_START_LINE_COLOUR,
      showStartLine:    s.showStartLine    ?? true,
      headerBgStrips:   s.headerBgStrips   ?? false,
    }
  } catch {
    return {
      themeHex: DEFAULT_THEME_HEX, statusColours: DEFAULT_STATUS_COLOURS,
      timelineBg: DEFAULT_TIMELINE_BG, greyColour: DEFAULT_GREY_COLOUR,
      startLineColour: DEFAULT_START_LINE_COLOUR, showStartLine: true, headerBgStrips: false,
    }
  }
}

// ── Provider ────────────────────────────────────────────────────

export function SettingsProvider({ children }) {
  // Single state object avoids stale-closure issues in setters
  const [settings, setSettings] = useState(load)

  // Apply all customisations on first render (before any page visit)
  useEffect(() => {
    applyTheme(settings.themeHex)
    applyStatusColours(settings.statusColours)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist to localStorage and update state atomically
  function update(patch) {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  const setThemeHex = useCallback((hex) => {
    applyTheme(hex)
    update({ themeHex: hex })
  }, [])

  const setStatusColour = useCallback((status, hex) => {
    setSettings(prev => {
      const next = { ...prev, statusColours: { ...prev.statusColours, [status]: hex } }
      applyStatusColours(next.statusColours)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const resetStatusColours = useCallback(() => {
    applyStatusColours(DEFAULT_STATUS_COLOURS)
    update({ statusColours: DEFAULT_STATUS_COLOURS })
  }, [])

  const setTimelineBg = useCallback((hex) => {
    update({ timelineBg: hex })
  }, [])

  const setGreyColour = useCallback((hex) => {
    update({ greyColour: hex })
  }, [])

  const setStartLineColour = useCallback((hex) => {
    update({ startLineColour: hex })
  }, [])

  const setShowStartLine = useCallback((val) => {
    update({ showStartLine: val })
  }, [])

  const setHeaderBgStrips = useCallback((val) => {
    update({ headerBgStrips: val })
  }, [])

  return (
    <Ctx.Provider value={{
      themeHex:           settings.themeHex,
      statusColours:      settings.statusColours,
      timelineBg:         settings.timelineBg,
      greyColour:         settings.greyColour,
      startLineColour:    settings.startLineColour,
      showStartLine:      settings.showStartLine,
      headerBgStrips:     settings.headerBgStrips,
      setThemeHex,
      setStatusColour,
      resetStatusColours,
      setTimelineBg,
      setGreyColour,
      setStartLineColour,
      setShowStartLine,
      setHeaderBgStrips,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSettings() {
  return useContext(Ctx)
}
