// src/lib/pepperPage.js
//
// What the page on screen shows, for Pepper's "ask about this page": a page
// says which venue and day or week it is showing with usePepperPage(), and
// the Ask Pepper drawer (ChatView with pageAware) sends it with each message
// along with the page's address, so "what's wrong here?" or "who is on this
// week?" needs no venue or date. One page at a time: the last one mounted
// wins, and it is cleared when that page goes.

import { useEffect, useSyncExternalStore } from 'react'

let current = null   // { venue_id, date, week }
const subscribers = new Set()
const notify = () => subscribers.forEach(fn => fn())

/** A page tells Pepper what it shows: { venueId, date, week } (YYYY-MM-DD; any can be left out). */
export function usePepperPage({ venueId, date, week } = {}) {
  const key = JSON.stringify({ venue_id: venueId || undefined, date: date || undefined, week: week || undefined })
  useEffect(() => {
    const mine = JSON.parse(key)
    current = mine
    notify()
    return () => {
      if (current === mine) { current = null; notify() }
    }
  }, [key])
}

/** The context the page on screen gave, or null. */
export function usePepperPageContext() {
  return useSyncExternalStore(
    fn => { subscribers.add(fn); return () => subscribers.delete(fn) },
    () => current,
  )
}
