// src/mobile/today.js
//
// The Today feed on the phone (GET /api/ops/today, api/src/services/opsToday.js):
// the Today page and the hub's tile badges share one query (same key as the
// office Home), and links in tasks go to the phone's own pages.

import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { standardHref } from '@/lib/hosts'

export function useTodayFeed(venueId) {
  const api = useApi()
  return useQuery({
    queryKey: ['ops-today', venueId || ''],
    queryFn: () => api.get('/ops/today' + (venueId ? '?venue_id=' + venueId : '')),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: (n, err) => err?.status !== 404 && n < 2,
  })
}

// Office pages with a phone page of their own; the query (?po=, ?order=) goes along.
const PHONE_PAGES = {
  '/purchasing': '/mobile/purchasing',
  '/cash-recon': '/mobile/cash-up',
  '/orders': '/mobile/orders',
  '/food-safety': '/mobile/hs-dashboard',
  '/checklists': '/mobile/hs-dashboard',
  '/hs-dashboard': '/mobile/hs-dashboard',
  // Stock counts happen in the walk-in: the phone's count page reads ?venue= and ?count= (Today's stock cards).
  '/stock': '/mobile/stock-count',
}

// A tab of an office page with a phone page of its own, or (null) none: the office opens it.
// Stock's transfers are received on the Stock page (inventory phase 4b); its waste has a phone page.
const PHONE_TABS = { '/stock': { waste: '/mobile/stock-waste', transfers: null } }

/** Where a task's page opens on the phone: { to } in this app, or { href } on the office site. */
export function opsLink(path) {
  const [base, query] = String(path || '/').split('?')
  const tab = new URLSearchParams(query || '').get('tab')
  const tabs = PHONE_TABS[base]
  if (tabs && tab && tab in tabs) {
    if (tabs[tab]) return { to: tabs[tab] + (query ? '?' + query : '') }
    const far = standardHref(path)
    return far ? { href: far } : { to: path }
  }
  if (PHONE_PAGES[base]) return { to: PHONE_PAGES[base] + (query ? '?' + query : '') }
  // A report (a Today alert) opens on the phone's own report page.
  if (/^\/reports\/[^/]+$/.test(base)) return { to: '/mobile' + base }
  const far = standardHref(path)
  return far ? { href: far } : { to: path }
}

/** A tile's badge: its areas' tasks today, and whether any is late. */
export function tileBadge(feed, areas) {
  if (!feed || !areas) return null
  const list = areas === 'all' ? feed.tasks : feed.tasks.filter(t => areas.includes(t.area))
  if (!list.length) return null
  return { count: list.length, late: list.some(t => t.group === 'late') }
}

/** The Today tile's line: what's to do, and where when there's more than one venue. */
export function todayLine(feed) {
  const where = feed.venues?.length > 1 ? feed.venue.name + ': ' : ''
  if (!feed.tasks.length) return where + 'Nothing to do right now'
  const late = feed.counts.late
  return where + (late ? late + ' late, ' : '') + feed.tasks.length + ' to do today'
}
