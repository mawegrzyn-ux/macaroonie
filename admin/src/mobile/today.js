// src/mobile/today.js
//
// The Today feed on the phone (GET /api/ops/today, api/src/services/opsToday.js):
// the Today page and the hub's tile badges share one query (same key as the
// office Today page), and links in tasks go to the phone's own pages.

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
}

/** Where a task's page opens on the phone: { to } in this app, or { href } on the office site. */
export function opsLink(path) {
  const [base, query] = String(path || '/').split('?')
  if (PHONE_PAGES[base]) return { to: PHONE_PAGES[base] + (query ? '?' + query : '') }
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
