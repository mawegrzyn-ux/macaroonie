// src/contexts/SettingsContext.jsx
// Manages global app settings persisted in localStorage.
// On mount, applies the saved theme colour to CSS variables so the correct
// primary colour is present immediately (before any settings page is visited).

import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const Ctx = createContext(null)

const STORAGE_KEY = 'maca_settings'
export const DEFAULT_THEME_HEX = '#630812'

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

export function applyTheme(hex) {
  const hsl = hexToHsl(hex)
  if (!hsl) return
  document.documentElement.style.setProperty('--primary', hsl)
  document.documentElement.style.setProperty('--primary-foreground', fgForHex(hex))
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return { themeHex: s?.themeHex ?? DEFAULT_THEME_HEX }
  } catch {
    return { themeHex: DEFAULT_THEME_HEX }
  }
}

function save(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch {}
}

export function SettingsProvider({ children }) {
  const [themeHex, _setThemeHex] = useState(() => load().themeHex)

  // Apply theme on first render
  useEffect(() => { applyTheme(themeHex) }, [])

  const setThemeHex = useCallback((hex) => {
    _setThemeHex(hex)
    applyTheme(hex)
    save({ themeHex: hex })
  }, [])

  return (
    <Ctx.Provider value={{ themeHex, setThemeHex }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSettings() {
  return useContext(Ctx)
}
