// src/components/layout/NavSearch.jsx — the menu search (8 Nov 2026).
//
// A search box at the top of the sidebar: type a page's name or what you
// want to do ("change staff pay", "fridge temperatures") and the menu
// narrows to the links that fit. The matching is shared/navSearch.js (one
// implementation with its tests and the keyword list the API's nav test
// checks); this file only draws it. It searches the person's own nav_tree
// from /api/me, which the server has already pruned to what their role can
// see — so the results never offer a page they can't open.
//
// Descriptions (12 Nov 2026): each result says in a line or two what its
// page is for (the entry's own description, else its page's standard one),
// and the search matches those words too, below the link's name and its
// search words.
//
// Pepper (9 Nov 2026): the filtering above happens as the person types, with
// no AI. Enter, or the Pepper button inside the box, asks Pepper instead
// (POST /api/ai/nav-search): Pepper reads what they typed in their own words
// and picks from the same links (the server builds them from the person's
// own menu, so a pick is always a page they can open), each with a reason,
// and a note below them. Typing again goes back to the plain filter; Enter
// on Pepper's answer opens its first pick. Without Pepper, Enter opens the
// best match as before.
import { useMemo, useState, useRef, useCallback } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import * as LucideIcons from 'lucide-react'
import { Search, X, Sparkles, Loader2, MessageCircle } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { searchNavTree } from '@shared/navSearch.js'
import { ASSISTANT_NAME } from '@shared/assistant.js'

function iconOf(name) {
  return LucideIcons[name] || LucideIcons.Circle
}

// null = not searching (empty box, or separators only): the sidebar shows
// the normal tree. [] = searching, nothing fits.
export function useNavSearchResults(tree, query) {
  return useMemo(() => searchNavTree(tree || [], query), [tree, query])
}

// Pepper's answer for the box: { query, status: 'loading' | 'done' | 'error',
// picks, note, error }. An answer is for the query it was asked about only
// (`for(q)`), so typing on shows the plain filter again, and a slow answer
// to an earlier query never replaces a newer one.
export function usePepperNavSearch() {
  const api = useApi()
  const [state, setState] = useState(null)
  const asked = useRef('')
  const ask = useCallback(async q => {
    const query = String(q || '').trim()
    if (!query) return
    asked.current = query
    setState({ query, status: 'loading', picks: [], note: '' })
    try {
      const res = await api.post('/ai/nav-search', { query })
      if (asked.current !== query) return
      setState({ query, status: 'done', picks: res?.picks || [], note: res?.note || '' })
    } catch (err) {
      if (asked.current !== query) return
      setState({ query, status: 'error', picks: [], note: '', error: err?.message || 'Pepper couldn\'t search the menu just now.' })
    }
  }, [api])
  const reset = useCallback(() => { asked.current = ''; setState(null) }, [])
  const forQuery = useCallback(q => (state && state.query === String(q || '').trim() ? state : null), [state])
  return { ask, reset, forQuery }
}

export function NavSearchInput({ value, onChange, results, onPick, inputRef, canAskAi, pepper, onAskPepper }) {
  const navigate = useNavigate()
  const busy = pepper?.status === 'loading'
  return (
    <div className="relative shrink-0">
      <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        enterKeyHint="go"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && value.trim()) {
            e.preventDefault()
            if (canAskAi) {
              // Pepper's answer to this query on screen: Enter opens its
              // first pick; otherwise Enter asks Pepper.
              if (pepper?.status === 'done' && pepper.picks.length) {
                navigate(pepper.picks[0].route)
                onPick?.()
              } else if (!busy) {
                onAskPepper?.()
              }
            } else if (results?.length) {
              navigate(results[0].route)
              onPick?.()
            }
          } else if (e.key === 'Escape' && value) {
            e.stopPropagation()
            onChange('')
          }
        }}
        placeholder="Search the menu"
        aria-label="Search the menu"
        data-testid="nav-search"
        className={cn(
          'w-full h-11 pl-8 text-sm border rounded-md bg-background touch-manipulation placeholder:text-muted-foreground/70',
          canAskAi ? 'pr-[4.75rem]' : 'pr-8',
        )}
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
        {!!value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear the search"
            data-testid="nav-search-clear"
            className="w-9 h-9 flex items-center justify-center rounded text-muted-foreground hover:bg-accent touch-manipulation"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {canAskAi && (
          <button
            type="button"
            onClick={() => { if (value.trim() && !busy) onAskPepper?.(); else inputRef?.current?.focus() }}
            aria-label={'Ask ' + ASSISTANT_NAME + ' to search the menu'}
            title={'Ask ' + ASSISTANT_NAME + ' (Enter)'}
            data-testid="nav-search-pepper"
            data-busy={busy ? '1' : undefined}
            className={cn(
              'w-9 h-9 flex items-center justify-center rounded touch-manipulation',
              pepper ? 'bg-primary text-primary-foreground' : 'text-primary hover:bg-primary/10',
            )}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  )
}

// Pepper's picks for the query, each with its reason, and Pepper's note
// below them. No picks: the note says why, with the chat one tap away.
export function PepperNavResults({ pepper, onPick, onAskAgain, onOpenChat, onShowAll, exact }) {
  if (pepper.status === 'loading') {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground flex items-center gap-2" data-testid="nav-pepper-loading" role="status">
        <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
        {ASSISTANT_NAME} is looking through your menu&hellip;
      </div>
    )
  }
  if (pepper.status === 'error') {
    return (
      <div className="px-3 py-3 text-sm space-y-2" data-testid="nav-pepper-error">
        <p className="text-destructive">{pepper.error}</p>
        <button type="button" onClick={onAskAgain}
          className="w-full min-h-[44px] px-3 rounded-md border text-primary hover:bg-primary/10 touch-manipulation text-sm font-medium">
          Try again
        </button>
        <button type="button" onClick={onShowAll} data-testid="nav-pepper-show-all"
          className="w-full min-h-[44px] px-3 rounded-md text-muted-foreground hover:bg-accent touch-manipulation text-sm">
          Show the menu's own matches
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-0.5" data-testid="nav-pepper-results">
      <p className="px-3 pt-1 pb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
        <Sparkles className="w-3.5 h-3.5" /> {ASSISTANT_NAME}&rsquo;s picks
      </p>
      {pepper.picks.map(p => {
        const Icon = iconOf(p.icon)
        return (
          <NavLink
            key={p.route}
            to={p.route}
            end={p.route === '/' || !!exact?.has(p.route)}
            onClick={onPick}
            data-testid="nav-pepper-pick"
            className={({ isActive }) => cn(
              'flex items-start gap-3 px-3 py-2 min-h-[44px] rounded-md text-sm font-medium touch-manipulation',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground hover:bg-accent',
            )}
          >
            <Icon className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block leading-tight">{p.label}</span>
              {!!p.why && (
                <span className="block text-xs font-normal opacity-80 leading-snug mt-0.5" data-testid="nav-pepper-why">{p.why}</span>
              )}
              {!!p.path && (
                <span className="block truncate text-[10px] font-normal opacity-60 leading-tight mt-0.5">{p.path}</span>
              )}
            </span>
          </NavLink>
        )
      })}
      {(!!pepper.note || !pepper.picks.length) && (
        <div className="mx-1 mt-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs leading-snug text-foreground" data-testid="nav-pepper-note">
          <p className="flex gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary shrink-0 mt-px" />
            <span>{pepper.note || 'Nothing in your menu fits that.'}</span>
          </p>
          {!pepper.picks.length && onOpenChat && (
            <button type="button" onClick={onOpenChat} data-testid="nav-pepper-chat"
              className="mt-2 w-full flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-md border bg-background text-primary hover:bg-primary/10 touch-manipulation text-sm font-medium">
              <MessageCircle className="w-4 h-4" /> Ask {ASSISTANT_NAME} in the chat
            </button>
          )}
        </div>
      )}
      <button type="button" onClick={onShowAll} data-testid="nav-pepper-show-all"
        className="w-full mt-1 min-h-[44px] px-3 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground touch-manipulation">
        Show the menu&rsquo;s own matches
      </button>
    </div>
  )
}

// `exact`: the links that only count as the page you are on at their exact
// address (AppShell's exactRoutes()), so /screens isn't marked while you are
// on /screens/boards.
export function NavSearchResults({ results, query, onPick, canAskAi, onAskAi, exact }) {
  if (!results.length) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground" data-testid="nav-search-empty">
        <p>Nothing in the menu matches &ldquo;{query.trim()}&rdquo;.</p>
        {canAskAi && (
          <button
            type="button"
            onClick={onAskAi}
            data-testid="nav-search-ask"
            className="mt-3 w-full flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-md border text-primary hover:bg-primary/10 touch-manipulation text-sm font-medium"
          >
            <Sparkles className="w-4 h-4" />
            Ask {ASSISTANT_NAME} to find it
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-0.5" data-testid="nav-search-results">
      {canAskAi && (
        <p className="px-3 pb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="nav-search-hint">
          <Sparkles className="w-3 h-3 text-primary shrink-0" />
          Press Enter for {ASSISTANT_NAME}&rsquo;s picks
        </p>
      )}
      {results.map(r => {
        const Icon = iconOf(r.icon)
        return (
          <NavLink
            key={r.key}
            to={r.route}
            end={r.route === '/' || !!exact?.has(r.route)}
            onClick={onPick}
            data-testid="nav-search-result"
            data-route={r.route}
            className={({ isActive }) => cn(
              'flex items-start gap-3 px-3 py-2 min-h-[44px] rounded-md text-sm font-medium touch-manipulation',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="min-w-0 flex-1">
              {/* The name in full (it wraps): it is what the search weighs most */}
              <span className="block leading-tight break-words" data-testid="nav-search-label">{r.label}</span>
              {!!r.description && (
                // No `block` here: it would undo line-clamp's own display.
                // Three lines at most; the whole of it is the tooltip.
                <span
                  className="text-[11px] font-normal leading-snug opacity-80 mt-0.5 line-clamp-3"
                  title={r.description}
                  data-testid="nav-search-description"
                >
                  {r.description}
                </span>
              )}
              {!!r.path && (
                <span className="block truncate text-[10px] font-normal opacity-60 leading-tight mt-0.5" data-testid="nav-search-place">{r.path}</span>
              )}
            </span>
          </NavLink>
        )
      })}
    </div>
  )
}
