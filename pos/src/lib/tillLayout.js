// Which till layout this till draws (Store tech > Till layouts, migration
// 228; the rules in shared/pos/tillLayout.js): the till's own choice
// (settings.till_layout: a layout id, 'standard', or 'venue' / not set = the
// location's), else the location's (settings.till_layout_id), else none:
// the standard screen. A layout the config doesn't carry (deleted since) or
// one without the Order zone falls back the same way.
//
// A phone-sized screen (PHONE_MAX_WIDTH wide or less) draws phone layouts
// only: the one picked when it is made for a phone (layout.phone), else the
// location's layout for phones (settings.phone_layout_id, migration 246),
// else the phone template for the till's service (counter or tables) stands
// in, since neither the standard screen nor a tablet layout fits a phone. The
// built-in one can't be changed: a location that wants its own prices,
// buttons or dishes on phones picks a phone layout of its own. A phone on
// its side (wider than that, but SIDEWAYS_MAX_HEIGHT high or less) draws the
// layout picked unless that one is made for a phone: a phone layout's rows
// get too small to tap there, so the standard screen shows instead.

import { useEffect, useMemo, useState } from 'react'
import { normaliseTillLayout, templateLayout } from '@shared/pos/tillLayout.js'
import { getState, currentChecks } from './store.js'

export const PHONE_MAX_WIDTH = 639
export const SIDEWAYS_MAX_HEIGHT = 499

const usable = raw => {
  if (!raw) return null
  const layout = normaliseTillLayout(raw)
  return layout.zones.some(z => z.type === 'check') ? { ...layout, id: raw.id || null, name: raw.name || '' } : null
}

// The layout picked for this till in Store tech, or null (the standard screen).
function pickedLayout(config) {
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

/** The phone template standing in on a phone-sized screen: { ...layout, id, name, builtin: true }. */
export function phoneStandIn(counter) {
  const key = counter ? 'phone' : 'phone_table'
  return { ...templateLayout(key), id: 'builtin-' + key, name: 'Phone screen', builtin: true }
}

/**
 * The layout this till draws, or null for the standard screen. narrow: the
 * screen is phone-sized (useNarrow()); sideways: a phone on its side;
 * counter: the till is in counter mode.
 */
export function tillLayoutOf(config, { narrow = false, sideways = false, counter = config?.device?.settings?.mode === 'counter' } = {}) {
  const picked = pickedLayout(config)
  if (narrow) {
    if (picked?.phone) return picked
    const forPhones = usable(config?.till_layouts?.[config?.settings?.phone_layout_id])
    return forPhones?.phone ? forPhones : phoneStandIn(counter)
  }
  if (sideways && picked?.phone) return null
  return picked
}

/** Whether a media query matches now (follows the screen: a turn of the phone, a resized window). */
function useMedia(query) {
  const mq = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null)
  const [on, setOn] = useState(() => !!mq()?.matches)
  useEffect(() => {
    const m = mq()
    if (!m) return undefined
    const change = () => setOn(m.matches)
    change()
    m.addEventListener('change', change)
    return () => m.removeEventListener('change', change)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps
  return on
}

/** Whether the screen is phone-sized now (follows a turn of the phone). */
export function useNarrow() {
  return useMedia('(max-width: ' + PHONE_MAX_WIDTH + 'px)')
}

/** The layout this till draws on this screen (tillLayoutOf() with the screen's size). */
export function useTillLayout(config) {
  const narrow = useNarrow()
  const sideways = useMedia('(min-width: ' + (PHONE_MAX_WIDTH + 1) + 'px) and (max-height: ' + SIDEWAYS_MAX_HEIGHT + 'px)')
  return useMemo(() => tillLayoutOf(config, { narrow, sideways }), [config, narrow, sideways])
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
