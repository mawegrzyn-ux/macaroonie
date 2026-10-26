// The kiosk on a small screen (kioskScale() in shared/kiosk.js): a phone, or
// a screen that tells the browser it is under KIOSK_MIN_SHORT CSS px on its
// short side, gets the page zoomed out, as a browser's desktop mode does,
// without the browser setting (which would change every other site too).
//
// The zoom goes through the viewport tag (initial, minimum and maximum scale
// all the same), never a CSS transform or zoom, so vh / vw / vmin, fixed
// positions and touches keep matching the zoomed-out page. The browser then
// lays the page out at the visible size divided by the scale. The scale comes
// from the screen's short side, the same both ways round, so turning the
// screen needs no change. Only the top window: a browser ignores the tag in a
// frame (the design editor's preview, a shared page's kiosk). Every way out
// of the kiosk today (Disconnect, a removed device, a move) reloads or leaves
// the page, which brings back pos/index.html's tag; the cleanup puts it back
// too, should the kiosk app ever close within the page.

import { useLayoutEffect } from 'react'
import { kioskScale } from '@shared/kiosk.js'

/** The scale this screen is shown at (1 = as it is). */
export function screenScale() {
  const s = window.screen || {}
  return kioskScale(s.width, s.height)
}

const zoomedOut = k => `width=device-width, initial-scale=${k}, minimum-scale=${k}, maximum-scale=${k}, user-scalable=no, viewport-fit=cover`

export function useKioskViewport() {
  useLayoutEffect(() => {
    if (window.parent !== window) return undefined
    const meta = document.querySelector('meta[name="viewport"]')
    if (!meta) return undefined
    const before = meta.getAttribute('content')
    const apply = () => {
      const k = screenScale()
      const want = k < 1 ? zoomedOut(k) : before
      if (meta.getAttribute('content') !== want) meta.setAttribute('content', want)
    }
    apply()
    // The screen itself changed (a folding phone opened, another display).
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      meta.setAttribute('content', before)
    }
  }, [])
}
