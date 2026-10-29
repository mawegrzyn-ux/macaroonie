// What the device can be, and where each opens (pos/src/lib/appHost.js for
// the till, kitchen screen and kiosk; screen/ for menu screens). Kept apart
// from App.js so the tests can check it without React Native.

export const ROLES = [
  { kind: 'terminal', sub: 'pos', title: 'Till', text: 'Orders and payments at the counter or at the tables.' },
  { kind: 'kds', sub: 'kitchen', title: 'Kitchen screen', text: 'Orders for the kitchen, the pass and the order ready boards.' },
  { kind: 'kiosk', sub: 'kiosk', title: 'Self-order kiosk', text: 'Guests order and pay by themselves.' },
  { kind: 'screen', sub: 'screens', title: 'Menu screen', text: 'Menu boards and order ready boards on a TV or a wall of screens.' },
]

// The device address a page is on, to its kind (kds. forwards to kitchen.).
export const KIND_OF_SUB = { pos: 'terminal', kitchen: 'kds', kds: 'kds', kiosk: 'kiosk', screens: 'screen' }

export const roleOf = kind => ROLES.find(r => r.kind === kind) || null
export const urlFor = (kind, root) => `https://${roleOf(kind).sub}.${root}/`

/** The host of an http(s) address, lower case, or null. */
export function hostOf(url) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || ''))
  return m ? m[1].toLowerCase() : null
}
export const ours = (host, root) => host === root || (!!host && host.endsWith('.' + root))

/** The kind an address of ours belongs to, or null (another page of ours). */
export function kindOfUrl(url, root) {
  const host = hostOf(url)
  if (!ours(host, root) || host === root) return null
  return KIND_OF_SUB[host.slice(0, -(root.length + 1))] || null
}

// A kiosk and a menu screen face guests: a link off our domain does nothing.
// A till or kitchen screen opens it in the browser (a supplier's site, help).
export const staysPut = kind => kind === 'kiosk' || kind === 'screen'
