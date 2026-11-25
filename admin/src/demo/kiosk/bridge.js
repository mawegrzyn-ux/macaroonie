// src/demo/kiosk/bridge.js
//
// The kiosk designer demo's menu for its preview. The kiosk app in demo mode
// (pos/src/kiosk/demoSource.js) asks the page that frames it for its config
// ('kiosk.demo.want'); this answers with the demo's ('kiosk.demo.config'),
// and sends it again when the visitor changes a dish's picture. The design
// itself goes the office's way: the designer's preview posts it on the
// kiosk's 'kiosk.ready'.
//
// Both ways are checked: only this page's own origin, and only a frame in
// this page (the kiosk checks the message came from its parent).

import { demoConfig, getDemo, subscribeDemo } from './demoStore.js'

export function startKioskBridge() {
  const frames = new Set()
  const send = win => win.postMessage({ type: 'kiosk.demo.config', config: demoConfig() }, location.origin)
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || e.data?.type !== 'kiosk.demo.want') return
    const ours = Array.from(document.querySelectorAll('iframe')).some(f => f.contentWindow === e.source)
    if (!ours) return
    frames.add(e.source)
    send(e.source)
  })
  let pics = getDemo().dishPics
  subscribeDemo(() => {
    if (getDemo().dishPics === pics) return
    pics = getDemo().dishPics
    for (const win of frames) {
      if (win.closed) frames.delete(win)
      else send(win)
    }
  })
}
