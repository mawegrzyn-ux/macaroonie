// The kiosk on a screen unlike its design's (kioskBox(), kioskZoom() in
// shared/kiosk.js).
//
// Size: the page is zoomed so the kiosk is laid out at the design's size,
// as a browser's desktop mode does, without the browser setting (which would
// change every other site too). The zoom goes through the viewport tag
// (initial, minimum and maximum scale all the same), never a CSS transform or
// zoom, so container and viewport units, fixed positions and touches keep
// matching the zoomed page. The browser lays the page out at the visible size
// divided by the scale; zoomed in, the layout width is given in pixels too,
// as width=device-width would leave a page wider than the screen. The scale
// comes from window.screen, the same both ways round, so turning the screen
// needs no change. Only the top window, and only phones' and tablets'
// browsers: a browser ignores the tag in a frame (the design editor's
// preview, a shared page's kiosk, a replay) and on a computer. Every way out
// of the kiosk today (Disconnect, a removed device, a move) reloads or leaves
// the page, which brings back pos/index.html's tag; the cleanup puts it back
// too, should the kiosk app ever close within the page.
//
// Shape: useKioskBox() places the kiosk (.k-root) in the window at the
// design's shape, centred, with bars around it; in every window, frames
// included, so a replay drawn at the recorded window size boxes the same way.

import { useLayoutEffect, useState } from 'react'
import { kioskZoom, kioskBox } from '@shared/kiosk.js'

/** The scale this screen is shown at for a design's screen (1 = as it is). */
export function screenZoom(screen) {
  const s = window.screen || {}
  return kioskZoom(s.width, s.height, screen)
}

const zoomedOut = k => `width=device-width, initial-scale=${k}, minimum-scale=${k}, maximum-scale=${k}, user-scalable=no, viewport-fit=cover`
const zoomedIn = (k, w) => `width=${w}, initial-scale=${k}, minimum-scale=${k}, maximum-scale=${k}, user-scalable=no, viewport-fit=cover`

const screenKey = s => (s ? [s.short, s.long, s.shape].join(':') : '')

export function useKioskViewport(screen) {
  const key = screenKey(screen)
  useLayoutEffect(() => {
    if (window.parent !== window) return undefined
    const meta = document.querySelector('meta[name="viewport"]')
    if (!meta) return undefined
    const before = meta.getAttribute('content')
    const apply = () => {
      const k = screenZoom(screen)
      const want = k < 1 ? zoomedOut(k) : k > 1 ? zoomedIn(k, Math.round((window.screen?.width || window.innerWidth) / k)) : before
      if (meta.getAttribute('content') !== want) meta.setAttribute('content', want)
    }
    apply()
    // The screen itself changed (turned, a folding phone opened, another display).
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      meta.setAttribute('content', before)
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

// The box the kiosk is in now, for code that sizes things from it (hexagons).
let current = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight, portrait: true, bars: false }

/** The kiosk's box now: { x, y, w, h, portrait, bars } in the window's CSS px. */
export const kioskBoxNow = () => current

/** The box's short side (what kiosk.css's cqmin is a hundredth of). */
export const boxShort = () => Math.min(current.w, current.h) || Math.min(window.innerWidth, window.innerHeight)

/**
 * Where the kiosk sits in this window for the design's screen, kept up to
 * date as the window changes. `fixed` (a replay's recorded [x, y, w, h])
 * wins, so a visit plays back exactly as the guest saw it.
 */
export function useKioskBox(screen, fixed = null) {
  const key = screenKey(screen)
  const measure = () => {
    if (Array.isArray(fixed) && fixed.length === 4) {
      const [x, y, w, h] = fixed
      return { x, y, w, h, portrait: h >= w, bars: w < window.innerWidth || h < window.innerHeight }
    }
    return kioskBox(window.innerWidth, window.innerHeight, screen)
  }
  const [box, setBox] = useState(measure)
  const fixedKey = Array.isArray(fixed) ? fixed.join(',') : ''
  useLayoutEffect(() => {
    const on = () => setBox(prev => {
      const next = measure()
      return prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h && prev.bars === next.bars ? prev : next
    })
    on()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [key, fixedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  current = box
  return box
}
