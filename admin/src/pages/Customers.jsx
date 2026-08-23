// src/pages/Customers.jsx
// Customer list with editing, manual add, CSV import, and GDPR functions.
// Layout: left list | right detail panel (desktop) / overlay drawer (mobile)

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  Search, User, Download, Plus, Upload, ChevronRight,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CustomerDetail } from '@/components/customers/CustomerDetail'
import { AddCustomerModal } from '@/components/customers/AddCustomerModal'
import { ImportModal } from '@/components/customers/ImportModal'
import { SortableHeader } from '@/components/customers/SortableHeader'

function useIsDesktop(minWidth = 1024) {
  const [ok, setOk] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(`(min-width: ${minWidth}px)`).matches)
  useEffect(() => {
    const m = window.matchMedia(`(min-width: ${minWidth}px)`)
    const fn = () => setOk(m.matches)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [minWidth])
  return ok
}

export default function Customers() {
  const api = useApi()
  const qc  = useQueryClient()

  const [search,     setSearch]     = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [panelWidth, setPanelWidth] = useState(460)
  const [showAdd,    setShowAdd]    = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [sort,       setSort]       = useState({ col: 'updated_at', dir: 'desc' })
  const isDesktop = useIsDesktop()

  const isResizing    = useRef(false)
  const debounceTimer = useRef(null)
  const sentinelRef   = useRef(null)

  function onSort(col) {
    setSort(s => s.col === col
      ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'asc' }
    )
  }

  useEffect(() => {
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setDebouncedQ(search), 300)
    return () => clearTimeout(debounceTimer.current)
  }, [search])

  const onResizeStart = useCallback((e) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'
    function onMove(ev) {
      if (!isResizing.current) return
      const x = ev.touches ? ev.touches[0].clientX : ev.clientX
      setPanelWidth(Math.min(700, Math.max(320, window.innerWidth - x)))
    }
    function onUp() {
      isResizing.current = false
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend',  onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend',  onUp)
  }, [])

  const PAGE_SIZE = 50
  const {
    data:              infiniteData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey:         ['customers', debouncedQ, sort],
    queryFn:          ({ pageParam }) =>
      api.get(`/customers?q=${encodeURIComponent(debouncedQ)}&limit=${PAGE_SIZE}&offset=${pageParam}&sort=${sort.col}&dir=${sort.dir}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.rows.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    staleTime: 30_000,
  })

  const customers  = useMemo(() => infiniteData?.pages.flatMap(p => p.rows) ?? [], [infiniteData])
  const totalCount = infiniteData?.pages[0]?.total ?? null

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const { data: detail } = useQuery({
    queryKey: ['customers', selectedId],
    queryFn:  () => api.get(`/customers/${selectedId}`),
    enabled:  !!selectedId,
  })

  function onCustomerSaved(id) {
    qc.invalidateQueries({ queryKey: ['customers'] })
    if (id) setSelectedId(id)
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex items-center gap-2 px-4 h-14 border-b shrink-0">
          <h1 className="font-semibold text-sm">Customers</h1>
          {totalCount !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {totalCount.toLocaleString()}
            </span>
          )}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email or phone…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-lg bg-background focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-accent touch-manipulation"
            >
              <Upload className="w-3.5 h-3.5" />
              Import CSV
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg touch-manipulation"
            >
              <Plus className="w-3.5 h-3.5" />
              Add customer
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-6">Loading…</p>
          ) : customers.length === 0 && !isFetchingNextPage ? (
            <p className="text-sm text-muted-foreground p-6">
              {debouncedQ
                ? 'No customers match your search.'
                : 'No customers yet — they appear automatically when bookings are confirmed, or add one manually.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b bg-muted">
                  <SortableHeader col="name"        label="Name"   align="left"  sort={sort} onSort={onSort} />
                  <SortableHeader col="email"       label="Email"  align="left"  sort={sort} onSort={onSort} />
                  <SortableHeader col="phone"       label="Phone"  align="left"  sort={sort} onSort={onSort} />
                  <SortableHeader col="visit_count" label="Visits" align="right" sort={sort} onSort={onSort} />
                  <SortableHeader col="created_at"  label="Since"  align="left"  sort={sort} onSort={onSort} />
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {customers.map(c => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      'border-b cursor-pointer hover:bg-accent/50 transition-colors touch-manipulation',
                      selectedId === c.id && 'bg-accent',
                      c.is_anonymised && 'opacity-50 italic',
                    )}
                  >
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.email ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-semibold tabular-nums">{c.visit_count ?? 0}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {format(parseISO(c.created_at), 'dd MMM yyyy')}
                    </td>
                    <td className="pr-3">
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </td>
                  </tr>
                ))}
                <tr ref={sentinelRef}>
                  <td colSpan={6} className="py-4 text-center text-xs text-muted-foreground">
                    {isFetchingNextPage
                      ? 'Loading more…'
                      : !hasNextPage && totalCount !== null
                        ? `${customers.length.toLocaleString()} of ${totalCount.toLocaleString()} customers`
                        : null}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      {isDesktop && (
        <>
          <div
            onMouseDown={onResizeStart}
            onTouchStart={onResizeStart}
            className="relative w-3 shrink-0 cursor-col-resize group touch-manipulation select-none"
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:bg-primary/30 transition-colors" />
            <div className="absolute bottom-[20%] left-1/2 -translate-x-1/2 flex flex-col gap-[3px]">
              {[0,1,2,3,4].map(i => (
                <div key={i} className="w-1 h-1 rounded-full bg-muted-foreground/40 group-hover:bg-primary/60 transition-colors" />
              ))}
            </div>
          </div>
          <div className="shrink-0 flex flex-col overflow-hidden border-l" style={{ width: panelWidth }}>
            {selectedId && detail ? (
              <CustomerDetail
                key={selectedId}
                customer={detail}
                api={api}
                onUpdated={() => qc.invalidateQueries({ queryKey: ['customers'] })}
                onAnonymised={() => { qc.invalidateQueries({ queryKey: ['customers'] }); setSelectedId(null) }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <User className="w-8 h-8 opacity-30" />
                <p className="text-sm">Select a customer to view details</p>
              </div>
            )}
          </div>
        </>
      )}

      {!isDesktop && selectedId && detail && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setSelectedId(null)} />
          <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] z-50 bg-background border-l shadow-xl flex flex-col overflow-hidden">
            <CustomerDetail
              key={selectedId}
              customer={detail}
              api={api}
              onClose={() => setSelectedId(null)}
              onUpdated={() => qc.invalidateQueries({ queryKey: ['customers'] })}
              onAnonymised={() => { qc.invalidateQueries({ queryKey: ['customers'] }); setSelectedId(null) }}
            />
          </div>
        </>
      )}

      {showAdd && (
        <AddCustomerModal
          api={api}
          onClose={() => setShowAdd(false)}
          onCreated={(id) => { setShowAdd(false); onCustomerSaved(id) }}
        />
      )}

      {showImport && (
        <ImportModal
          api={api}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); qc.invalidateQueries({ queryKey: ['customers'] }) }}
        />
      )}
    </div>
  )
}
