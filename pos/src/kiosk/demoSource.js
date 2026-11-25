// The kiosk's data in demo mode (macaroonie.com/try/kiosk): the config comes
// from the page that frames the kiosk, the kiosk designer demo
// (admin/src/demo/kiosk/bridge.js), never from the API. store.js's
// bootDemo() starts the kiosk from it as a preview (nothing is ever sent:
// an order ends on the Done screen with a pretend number), and the design
// then comes the office preview's way ('kiosk.design').
//
//   demoConfig()       asks the parent ('kiosk.demo.want') and resolves with
//                      the first 'kiosk.demo.config' it answers
//   onDemoConfig(fn)   every config the parent sends later (a dish's picture
//                      changed)
//
// Messages count only from the parent window and this page's own origin
// (the demo's pages are on one origin); the ask goes to that origin only.

const WAIT_MS = 10000
const listeners = new Set()
let first = null

function listen() {
  window.addEventListener('message', e => {
    if (e.source !== window.parent || e.origin !== location.origin) return
    if (e.data?.type !== 'kiosk.demo.config' || !e.data.config || typeof e.data.config !== 'object') return
    for (const fn of listeners) fn(e.data.config)
  })
}

export function onDemoConfig(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function demoConfig() {
  if (first) return first
  listen()
  first = new Promise((resolve, reject) => {
    if (window.parent === window) {
      reject(new Error('The kiosk demo opens inside the kiosk designer demo.'))
      return
    }
    const t = setTimeout(() => { off(); reject(new Error('The demo menu didn\'t arrive. Reload the page.')) }, WAIT_MS)
    const off = onDemoConfig(config => { clearTimeout(t); off(); resolve(config) })
    window.parent.postMessage({ type: 'kiosk.demo.want' }, location.origin)
  })
  return first
}
