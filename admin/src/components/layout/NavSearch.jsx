// src/components/layout/NavSearch.jsx — the menu search (8 Nov 2026).
//
// A search box at the top of the sidebar: type a page's name or what you
// want to do ("change staff pay", "fridge temperatures") and the menu
// narrows to the links that fit. The matching is shared/navSearch.js (one
// implementation with its tests and the keyword list the API's nav test
// checks); this file only draws it. It searches the person's own nav_tree
// from /api/me, which the server has already pruned to what their role can
// see — so the results never offer a page they can't open. Enter opens the
// best match; when nothing fits, Ask Pepper is one tap away.
import { useMemo } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import * as LucideIcons from 'lucide-react'
import { Search, X, Sparkles } from 'lucide-react'
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

export function NavSearchInput({ value, onChange, results, onPick, inputRef }) {
  const navigate = useNavigate()
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
          if (e.key === 'Enter' && results?.length) {
            e.preventDefault()
            navigate(results[0].route)
            onPick?.()
          } else if (e.key === 'Escape' && value) {
            e.stopPropagation()
            onChange('')
          }
        }}
        placeholder="Search the menu"
        aria-label="Search the menu"
        data-testid="nav-search"
        className="w-full h-11 pl-8 pr-8 text-sm border rounded-md bg-background touch-manipulation placeholder:text-muted-foreground/70"
      />
      {!!value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear the search"
          data-testid="nav-search-clear"
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded text-muted-foreground hover:bg-accent touch-manipulation"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

export function NavSearchResults({ results, query, onPick, canAskAi, onAskAi }) {
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
            Ask {ASSISTANT_NAME}
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-0.5" data-testid="nav-search-results">
      {results.map(r => {
        const Icon = iconOf(r.icon)
        return (
          <NavLink
            key={r.key}
            to={r.route}
            onClick={onPick}
            data-testid="nav-search-result"
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-1.5 min-h-[44px] rounded-md text-sm font-medium touch-manipulation',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate leading-tight">{r.label}</span>
              {!!r.path && (
                <span className="block truncate text-[10px] font-normal opacity-70 leading-tight">{r.path}</span>
              )}
            </span>
          </NavLink>
        )
      })}
    </div>
  )
}
