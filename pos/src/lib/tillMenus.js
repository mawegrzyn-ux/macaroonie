// Which of the till's menus it shows (Menus > Menu times, migration 230;
// the rules in shared/menuTimes.js). The till shows every menu on now on
// its channel, their sections one after another; with none on (between
// lunch and dinner) every menu, so the till is never empty. Staff can pick
// others in More > Menus (MenusModal.jsx): the pick holds until the menus
// on now change (lunch ends), then the till follows the menu times again.
// The pick is kept in this till's prefs (store.js), per device.

import { useEffect } from 'react'
import { venueNow } from '@shared/promotions.js'
import { tillMenusShown, menusOnNow, timesLabel } from '@shared/menuTimes.js'
import { useTill, setPrefs } from './store.js'
import { useTick } from '../components/ui.jsx'

/** The menus a till offers: its revenue stream's, else (none named, or none of them here) every menu of the till's config. */
export function streamMenus(config, menuIds = null) {
  const all = config?.menus || []
  const only = menuIds?.length ? all.filter(m => menuIds.includes(m.id)) : all
  return only.length ? only : all
}

/** The venue's time now, as the menu times read it: { date, dow, minutes }. */
export const tillNow = config => venueNow(config?.venue?.timezone || 'Europe/London')

/** "Mon–Fri 11:00–15:00" or "Any time": a menu's times on the till. */
export const menuTimesText = m => timesLabel(m?.times || null)

/**
 * The menus to show now, and how staff change them:
 * { menus (the till's), shown (to draw, in order), ids, auto, none, onNow,
 *   pick(ids) (show these until the menus on now change), follow() (the menu times again) }.
 */
export function useShownMenus(config, menuIds = null) {
  const { prefs } = useTill()
  // The clock moves the menus on: look again every 30 seconds.
  useTick(30000)
  const menus = streamMenus(config, menuIds)
  const r = tillMenusShown(menus, tillNow(config), prefs.menu_pick || null)
  // A pick that no longer holds (the menus on now changed) is forgotten, so
  // it can't come back when they change back.
  const lapsed = !!prefs.menu_pick && r.auto
  useEffect(() => { if (lapsed) setPrefs({ menu_pick: null }) }, [lapsed])
  return {
    menus,
    shown: menus.filter(m => r.ids.includes(m.id)),
    ...r,
    pick: ids => setPrefs({ menu_pick: ids.length ? { ids, basis: r.basis } : null }),
    follow: () => setPrefs({ menu_pick: null }),
  }
}

export { menusOnNow }
