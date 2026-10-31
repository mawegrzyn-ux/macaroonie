// Which till layout this till draws (Store tech > Till layouts, migration
// 228; the rules in shared/pos/tillLayout.js): the till's own choice
// (settings.till_layout: a layout id, 'standard', or 'venue' / not set = the
// location's), else the location's (settings.till_layout_id), else none:
// the standard screen. A layout the config doesn't carry (deleted since) or
// one without the Order zone falls back the same way.

import { normaliseTillLayout } from '@shared/pos/tillLayout.js'
import { getState, currentChecks } from './store.js'

const usable = raw => {
  if (!raw) return null
  const layout = normaliseTillLayout(raw)
  return layout.zones.some(z => z.type === 'check') ? { ...layout, id: raw.id || null, name: raw.name || '' } : null
}

/** The layout this till draws, or null for the standard screen. */
export function tillLayoutOf(config) {
  const layouts = config?.till_layouts || {}
  const own = config?.device?.settings?.till_layout
  if (own === 'standard') return null
  if (own && own !== 'venue') {
    const mine = usable(layouts[own])
    if (mine) return mine
  }
  const venue = config?.settings?.till_layout_id
  return venue ? usable(layouts[venue]) : null
}

/**
 * The check whose receipt Last receipt prints: the last one this till
 * closed (remembered as it closes, PayModal), else the latest closed check
 * opened on this till today.
 */
export function lastReceiptCheck() {
  const s = getState()
  const checks = currentChecks()
  const remembered = s.prefs?.last_closed ? checks[s.prefs.last_closed] : null
  if (remembered && remembered.status === 'closed') return remembered
  const mine = Object.values(checks)
    .filter(c => c.status === 'closed' && c.opened_device_id && c.opened_device_id === s.device?.id)
    .sort((a, b) => String(b.closed_at || '').localeCompare(String(a.closed_at || '')))
  return mine[0] || null
}
