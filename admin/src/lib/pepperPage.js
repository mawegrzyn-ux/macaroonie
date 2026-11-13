// src/lib/pepperPage.js
//
// What the page on screen shows, for Pepper's "ask about this page": a page
// says which venue and day or week it is showing with usePepperPage(), and
// the Ask Pepper drawer (ChatView with pageAware) sends it with each message
// along with the page's address, so "what's wrong here?" or "who is on this
// week?" needs no venue or date. One page at a time: the last one mounted
// wins, and it is cleared when that page goes.
//
// The report pages say which report is open (`report`: { id, from, to,
// venue_ids } on the viewer, { id, subject } in the builder), so "why is
// Tuesday low?" is asked about that report. The server names a report only
// when the person may open it. `label` is for the drawer's chip only (the
// report's name as the page shows it) and is never sent.

import { useEffect, useSyncExternalStore } from 'react'

let current = null   // { venue_id, date, week, report, label }
const subscribers = new Set()
const notify = () => subscribers.forEach(fn => fn())

export function usePepperPage({ venueId, date, week, report, label } = {}) {
  const key = JSON.stringify({
    venue_id: venueId || undefined,
    date: date || undefined,
    week: week || undefined,
    report: report || undefined,
    label: label || undefined,
  })
  useEffect(() => {
    const mine = JSON.parse(key)
    current = mine
    notify()
    return () => { if (current === mine) { current = null; notify() } }
  }, [key])
}

export function usePepperPageContext() {
  return useSyncExternalStore(fn => { subscribers.add(fn); return () => subscribers.delete(fn) }, () => current)
}
