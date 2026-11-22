// src/lib/usage.js — the usage record (migration 270, Pepper-first step 0a).
//
// Which pages a person opens and what they type in the menu search (the ask
// bar), whether they then handed it to Pepper and what they opened. Kept in a
// queue here and sent in small batches to POST /api/usage/events: every
// FLUSH_MS, when the queue is full, and when the tab is hidden or closed
// (fetch with keepalive, so the last batch still goes). Nothing here ever
// waits on the server or shows an error: a batch that fails is dropped.
//
// The server keeps the page's path only (it strips query strings and turns
// ids in the address into :id, services/usageRecord.js); this side sends
// location.pathname and nothing else of the address. A person's record is
// their own: the group sees counts by page and by day, never by person.
//
//   usePageUse()     in each shell (AppShell, MobileShell): records the page
//                    on every change of path, and lends the queue the
//                    person's sign-in to send with
//   useSearchUse()   the menu search's record (AppShell): typed(q, n) as
//                    the box changes, askedPepper(), picked(kind, route)

import { useEffect, useRef, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { getSelectedTenant } from '@/lib/api'

const FLUSH_MS = 15_000
const MAX_BATCH = 50
const MAX_QUEUE = 200
const QUERY_MAX = 200

let queue = []
let getToken = null
let timer = null

function schedule() {
  if (timer || typeof window === 'undefined') return
  timer = window.setTimeout(() => { timer = null; flush() }, FLUSH_MS)
}

async function flush() {
  if (!queue.length || !getToken) return
  const events = queue.slice(0, MAX_BATCH)
  queue = queue.slice(MAX_BATCH)
  try {
    const token = await getToken()
    const tenantId = getSelectedTenant()
    await fetch('/api/usage/events', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
      },
      body: JSON.stringify({ events }),
    })
  } catch { /* the record never gets in the way: a failed batch is dropped */ }
  if (queue.length) schedule()
}

/** Add one event to the queue (at = now). */
export function recordUse(event) {
  try {
    queue.push({ ...event, at: new Date().toISOString() })
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)
    if (queue.length >= MAX_BATCH) flush()
    else schedule()
  } catch { /* never */ }
}

function onHide() {
  if (document.visibilityState === 'hidden') { finishSearch(); flush() }
}
let listening = false
function listen() {
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', () => { finishSearch(); flush() })
}

/** Records the page on every change of path; call once in each shell. */
export function usePageUse() {
  const { pathname } = useLocation()
  const { getAccessTokenSilently, isAuthenticated } = useAuth0()
  const last = useRef(null)
  useEffect(() => {
    if (!isAuthenticated) return
    getToken = () => getAccessTokenSilently()
    listen()
  }, [isAuthenticated, getAccessTokenSilently])
  useEffect(() => {
    if (!isAuthenticated || pathname === last.current) return
    last.current = pathname
    recordUse({ kind: 'page', path: pathname })
  }, [pathname, isAuthenticated])
}

// ── The menu search ──────────────────────────────────────────
// One search is one row: started by the first words typed, ended when
// something is opened, the box is emptied, new words are typed after Pepper
// answered, or the tab is hidden. It keeps the last words and how many of the
// menu's own matches they had.

let search = null

function finishSearch() {
  if (!search) return
  const s = search
  search = null
  // Two letters or more, or anything that was handed to Pepper or opened.
  if (s.query.length < 2 && !s.pepper && !s.picked) return
  recordUse({ kind: 'search', query: s.query, results: s.results, pepper: s.pepper, picked: s.picked, path: s.path })
}

export function useSearchUse() {
  const typed = useCallback((q, results) => {
    const query = String(q || '').trim().slice(0, QUERY_MAX)
    if (!query) { finishSearch(); return }
    // New words after Pepper answered the old ones: that search is over.
    if (search?.pepper && search.query !== query) finishSearch()
    if (!search) search = { query, results: 0, pepper: false, picked: null, path: null }
    search.query = query
    search.results = Number.isInteger(results) ? results : 0
  }, [])
  const askedPepper = useCallback(() => { if (search) search.pepper = true }, [])
  const picked = useCallback((kind, route) => {
    if (!search) return
    search.picked = kind
    search.path = typeof route === 'string' ? route.split(/[?#]/)[0] : null
    finishSearch()
  }, [])
  return useMemo(() => ({ typed, askedPepper, picked }), [typed, askedPepper, picked])
}
