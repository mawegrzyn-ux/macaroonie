// src/components/layout/AskBar.jsx — the ask bar (Pepper-first step 2c,
// reports/AI first back office strategy.md "The ask bar: search first, Pepper
// on Enter", docs/PEPPER_FIRST.md 4.1). It replaced the sidebar's menu search
// (NavSearch.jsx, 8 Nov 2026) and its Pepper picks (POST /api/ai/nav-search).
//
// One box, at the top of Home and over any other page (AppShell's overlay:
// the sidebar's Search or ask button, the rail's search button, Ctrl or Cmd+K,
// or / when no box has the cursor). As the person types, the results come from
// the browser with no model call: the pages of their own menu (the nav_tree
// /api/me sends, already pruned to what their role can open, plus the
// platform pages for platform admins), matched by the menu search's one
// matcher (shared/navSearch.js searchNavTree(): a page's name, search words
// and description), then their saved reports (searchReports(), from two
// letters, for people with Reports). The last row is always Ask Pepper with
// the words. Arrow keys move through the rows; Enter opens the row lit, and
// with none lit hands the words to Pepper (or, without Pepper, opens the
// first result). Handing over opens Pepper's drawer and sends the words into
// the remembered chat (askPepper() from AppShell, AssistantDrawer's ask);
// Pepper answers a page with a nav card (ChatView's NavCard).
//
// The usage record (migration 270): each search goes through useSearchUse()
// (lib/usage.js): the words and how many pages matched, whether they were
// handed to Pepper, and what was opened (a menu page or a saved report).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import * as LucideIcons from 'lucide-react'
import { Search, X, Sparkles, BarChart3, Star, CornerDownLeft } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useSearchUse } from '@/lib/usage'
import { searchNavTree, searchReports } from '@shared/navSearch.js'
import { ASSISTANT_NAME } from '@shared/assistant.js'

const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
export const PAGES_SHOWN = 8

const iconOf = name => LucideIcons[name] || LucideIcons.Circle

/**
 * What AppShell lends the bar: openBar() (the overlay, or the bar on Home
 * when it is on screen), askPepper(words) (the words into Pepper's remembered chat),
 * canAskAi, and registerInline(focus) for the bar on Home. null outside the
 * office shell.
 */
export const AskContext = createContext(null)
export const useAsk = () => useContext(AskContext)

// The platform's own pages, searched for platform admins (they aren't in any
// group's menu).
const PLATFORM_SECTION = {
  kind: 'section', id: '_platform', label: 'Platform',
  children: [
    { kind: 'link', id: '_platform_home', label: 'Platform', route: '/platform', icon: 'Shield', children: [] },
    { kind: 'link', id: '_platform_backlog', label: 'Backlog', route: '/backlog', icon: 'KanbanSquare', children: [] },
  ],
}

/** The menu the bar searches: the person's own, plus the platform pages for platform admins. */
export function searchTreeOf(me) {
  const tree = me?.nav_tree ?? []
  return me?.is_platform_admin ? [...tree, PLATFORM_SECTION] : tree
}

// Saved reports matching the words (phase 5, docs/REPORTS.md 15): the
// person's own and their team's, and starters they starred. Read from
// GET /api/reports only when the person has Reports and is typing.
function useReportMatches(query, enabled) {
  const api = useApi()
  const searching = enabled && query.trim().length >= 2
  const q = useQuery({ queryKey: ['reports'], queryFn: () => api.get('/reports'), enabled: searching, staleTime: 30_000, retry: false })
  return useMemo(() => {
    const d = q.data
    if (!searching || !d) return []
    const list = [...(d.reports || []).filter(r => r.runs), ...(d.starters || []).filter(r => r.runs && r.starred)]
    return searchReports(list, query)
  }, [q.data, query, searching])
}

/**
 * The bar. `autoFocus` (the overlay), `onDone` (called after anything is
 * opened or handed over, and on Escape with an empty box: the overlay
 * closes), `inline` (Home: registers itself so Ctrl+K focuses it, and shows
 * `suggestions`, asks to tap, while the box is empty).
 */
export default function AskBar({ autoFocus = false, onDone, inline = false, suggestions = [] }) {
  const api = useApi()
  const navigate = useNavigate()
  const ask = useAsk()
  const canAskAi = !!ask?.canAskAi
  const [query, setQuery] = useState('')
  const [cur, setCur] = useState(-1)
  const inputRef = useRef(null)
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const tree = useMemo(() => searchTreeOf(me), [me])
  const found = useMemo(() => searchNavTree(tree, query), [tree, query])
  const reports = useReportMatches(query, (me?.permissions?.reports ?? 'none') !== 'none')
  const text = query.trim()

  const rows = useMemo(() => {
    if (!text) return []
    const pages = (found || []).slice(0, PAGES_SHOWN).map(r => ({ kind: 'menu', key: r.key, route: r.route, label: r.label, icon: r.icon, description: r.description, place: r.path }))
    const reps = reports.map(r => ({ kind: 'report', key: 'report:' + r.id, route: '/reports/' + encodeURIComponent(r.id), label: r.name, description: r.description, starred: r.starred, id: r.id }))
    return [...pages, ...reps, ...(canAskAi ? [{ kind: 'pepper', key: 'pepper' }] : [])]
  }, [text, found, reports, canAskAi])

  // The usage record: one search per run of words.
  const searchUse = useSearchUse()
  useEffect(() => { searchUse.typed(query, found?.length ?? 0) }, [query, found, searchUse])
  useEffect(() => { setCur(-1) }, [query])

  const focus = useCallback(() => inputRef.current?.focus(), [])
  useEffect(() => {
    if (!inline || !ask?.registerInline) return undefined
    return ask.registerInline(focus)
  }, [inline, ask, focus])
  useEffect(() => { if (autoFocus) focus() }, [autoFocus, focus])

  function finish() {
    setQuery('')
    onDone?.()
  }
  function handToPepper(words = text) {
    if (!canAskAi || !words) return
    searchUse.askedPepper()
    ask.askPepper(words)
    finish()
  }
  function openRow(row) {
    if (!row) return
    if (row.kind === 'pepper') { handToPepper(); return }
    searchUse.picked(row.kind, row.route)
    navigate(row.route)
    finish()
  }
  function onKeyDown(e) {
    if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault()
      setCur(c => (c + 1 >= rows.length ? 0 : c + 1))
    } else if (e.key === 'ArrowUp' && rows.length) {
      e.preventDefault()
      setCur(c => (c <= 0 ? rows.length - 1 : c - 1))
    } else if (e.key === 'Enter') {
      if (!text) return
      e.preventDefault()
      if (cur >= 0) openRow(rows[cur])
      else if (canAskAi) handToPepper()
      else openRow(rows[0])
    } else if (e.key === 'Escape' && (query || onDone)) {
      // Only when the bar uses it: otherwise Escape still closes Pepper's drawer.
      e.stopPropagation()
      if (query) setQuery('')
      else onDone()
    }
  }

  const pageRows = rows.filter(r => r.kind === 'menu')
  const reportRows = rows.filter(r => r.kind === 'report')
  const rowProps = row => {
    const i = rows.indexOf(row)
    return {
      id: 'ask-row-' + i,
      role: 'option',
      'aria-selected': i === cur,
      onMouseEnter: () => setCur(i),
      onClick: () => openRow(row),
      className: cn('w-full flex items-start gap-3 px-3 py-2 min-h-[48px] rounded-md text-left text-sm touch-manipulation',
        i === cur ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent'),
    }
  }

  return (
    <div className="space-y-2" data-testid={inline ? 'ask-bar-home' : 'ask-bar'}>
      <div className="relative">
        <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          enterKeyHint={canAskAi ? 'send' : 'go'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={canAskAi ? 'Search or ask ' + ASSISTANT_NAME : 'Search for a page'}
          aria-label={canAskAi ? 'Search or ask ' + ASSISTANT_NAME : 'Search for a page'}
          role="combobox"
          aria-expanded={!!text}
          aria-controls="ask-results"
          aria-activedescendant={cur >= 0 ? 'ask-row-' + cur : undefined}
          data-testid="ask-input"
          className={cn('w-full h-12 pl-11 rounded-lg border bg-background text-base sm:text-sm touch-manipulation placeholder:text-muted-foreground/80',
            canAskAi ? 'pr-[6.5rem]' : 'pr-14')}
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {!!query && (
            <button type="button" onClick={() => { setQuery(''); focus() }} aria-label="Clear" data-testid="ask-clear"
              className="w-11 h-11 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent touch-manipulation">
              <X className="w-4 h-4" />
            </button>
          )}
          {canAskAi && (
            <button type="button" onClick={() => (text ? handToPepper() : focus())} data-testid="ask-pepper-button"
              aria-label={'Ask ' + ASSISTANT_NAME} title={'Ask ' + ASSISTANT_NAME + ' (Enter)'}
              className="h-11 px-3 flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium touch-manipulation">
              <Sparkles className="w-4 h-4" /><span className="hidden sm:inline">Ask</span>
            </button>
          )}
        </div>
      </div>

      {!text && inline && canAskAi && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="ask-suggestions">
          {suggestions.map(s => (
            <button key={s} type="button" onClick={() => handToPepper(s)} data-testid="ask-suggestion"
              className="inline-flex items-center gap-1.5 min-h-[48px] rounded-full border bg-background px-4 text-sm hover:bg-accent touch-manipulation">
              <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" /> {s}
            </button>
          ))}
        </div>
      )}

      {!!text && (
        <div id="ask-results" role="listbox" aria-label="Results" className="rounded-lg border bg-background p-1 space-y-0.5" data-testid="ask-results">
          {pageRows.map(r => {
            const Icon = iconOf(r.icon)
            return (
              <button key={r.key} type="button" {...rowProps(r)} data-testid="ask-result" data-route={r.route}>
                <Icon className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-tight break-words" data-testid="ask-result-label">{r.label}</span>
                  {!!r.description && <span className="text-xs text-muted-foreground leading-snug mt-0.5 line-clamp-2" title={r.description}>{r.description}</span>}
                  {!!r.place && <span className="block truncate text-[11px] text-muted-foreground/80 leading-tight mt-0.5" data-testid="ask-result-place">{r.place}</span>}
                </span>
              </button>
            )
          })}
          {!pageRows.length && (
            <p className="px-3 py-2 text-sm text-muted-foreground" data-testid="ask-none">No page in your menu matches &ldquo;{text}&rdquo;.</p>
          )}
          {reportRows.length > 0 && (
            <div className="pt-1" data-testid="ask-reports">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saved reports</p>
              {reportRows.map(r => (
                <button key={r.key} type="button" {...rowProps(r)} data-testid="ask-report" data-id={r.id}>
                  {r.starred ? <Star className="w-4 h-4 shrink-0 mt-0.5 text-primary" /> : <BarChart3 className="w-4 h-4 shrink-0 mt-0.5 text-primary" />}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium leading-tight break-words">{r.label}</span>
                    {!!r.description && <span className="text-xs text-muted-foreground leading-snug mt-0.5 line-clamp-2" title={r.description}>{r.description}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
          {canAskAi && (() => {
            const row = rows[rows.length - 1]
            return (
              <button type="button" {...rowProps(row)} data-testid="ask-pepper"
                className={cn(rowProps(row).className, 'border-t rounded-t-none mt-1 items-center')}>
                <Sparkles className="w-4 h-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-tight">Ask {ASSISTANT_NAME}</span>
                  <span className="block text-xs text-muted-foreground break-words">{text}</span>
                </span>
                {!IS_TOUCH && <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0"><CornerDownLeft className="w-3 h-3" /> Enter</span>}
              </button>
            )
          })()}
        </div>
      )}
    </div>
  )
}

/** The bar over any page (AppShell): a window at the top, closed by a pick, Escape or a tap outside. */
export function AskOverlay({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-3 sm:pt-[10vh]" onMouseDown={onClose} data-testid="ask-overlay">
      <div role="dialog" aria-modal="true" aria-label={'Search or ask ' + ASSISTANT_NAME}
        className="w-full max-w-2xl bg-page rounded-xl shadow-xl p-3 max-h-[85vh] overflow-y-auto" onMouseDown={e => e.stopPropagation()}>
        <AskBar autoFocus onDone={onClose} />
      </div>
    </div>
  )
}

/** A key press that should open the bar: Ctrl or Cmd+K, or / when no box has the cursor. */
export function isAskShortcut(e) {
  const t = e.target
  const inBox = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
  if (t?.isContentEditable || t?.closest?.('[role="dialog"]')) return false
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'k') return true
  return e.key === '/' && !inBox && !e.ctrlKey && !e.metaKey && !e.altKey
}
