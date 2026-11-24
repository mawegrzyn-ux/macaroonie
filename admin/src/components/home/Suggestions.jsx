// src/components/home/Suggestions.jsx — suggestions on Home, after the pins
// (Pepper-first step 7a, docs/PEPPER_FIRST.md 4.4).
//
// Up to four, worked out by the server's rules (api/src/services/
// suggestions.js) and sent with the Today feed (`d.suggestions`), each with a
// one-line reason. A tap opens it (a page at Home's venue and the tab its
// reason is about, where the page's address takes them; a report). Pin keeps
// it in the person's pins (the same PUT /api/pins as the editor, the whole
// list). Dismiss (x) hides it for 14 days (a manager's team suggestion for
// good): POST /api/suggestions/hide. Dotted, so they never pass for pins. At
// 1024 px and below the fourth is left out (the strip keeps to one or two rows).
// Each one shown, opened, pinned or dismissed goes into the person's usage
// record (lib/usage.js, kind 'suggestion', step 7d).

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as LucideIcons from 'lucide-react'
import { Pin, X, Lightbulb, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePins, MAX_PINS } from '@/components/home/Pins'
import { recordUse } from '@/lib/usage'

const iconOf = name => LucideIcons[name] || LucideIcons.Circle
// The usage record (step 7d): the person's own; the group sees tap-through by rule only.
const track = (s, act) => recordUse({ kind: 'suggestion', rule: s.rule, act, path: s.path })

/** `list`: the feed's suggestions; `onGone(key)`: take one off the shown list (dismissed or pinned). */
export default function Suggestions({ list, onGone }) {
  const api = useApi()
  const { pins, save } = usePins()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  // Each suggestion counted as shown once while Home is open (the feed comes again every minute).
  const counted = useRef(new Set())
  const shownKeys = (list || []).slice(0, 4).map(s => s.key).join('|')
  useEffect(() => {
    // At 1024 px and below the fourth isn't drawn: not shown.
    const n = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1023px)').matches ? 3 : 4
    for (const s of (list || []).slice(0, n)) {
      if (counted.current.has(s.key)) continue
      counted.current.add(s.key)
      track(s, 'shown')
    }
  }, [shownKeys]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!list?.length) return null
  const current = pins.data?.pins || []
  const full = current.length >= MAX_PINS

  async function dismiss(s) {
    setBusy(s.key); setError(null)
    try {
      await api.post('/suggestions/hide', { key: s.key })
      track(s, 'dismissed')
      onGone(s.key)
    } catch (err) {
      console.error(err)
      setError('Couldn\'t dismiss it: ' + (err?.message || 'try again'))
    } finally { setBusy(null) }
  }
  async function pin(s) {
    setBusy(s.key); setError(null)
    try {
      await save.mutateAsync([...current, { ...s.pin, label: null }])
      track(s, 'pinned')
      onGone(s.key)
    } catch (err) {
      console.error(err)
      setError('Couldn\'t pin it: ' + (err?.message || 'try again'))
    } finally { setBusy(null) }
  }

  return (
    <div className="px-3 pb-3 space-y-2" data-testid="suggestions">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
        <Lightbulb className="w-3.5 h-3.5" /> Suggested for you
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {list.map((s, i) => {
          const Icon = iconOf(s.icon)
          return (
            <li key={s.key} data-testid="suggestion" data-key={s.key} data-rule={s.rule}
              className={cn('flex items-stretch rounded-lg border-2 border-dashed border-primary/30 bg-background min-w-0', i >= 3 && 'max-lg:hidden')}>
              <Link to={s.link} data-testid="suggestion-open" onClick={() => track(s, 'opened')}
                className="flex-1 min-w-0 flex items-center gap-2 min-h-[56px] pl-3 pr-1 py-1.5 rounded-l-lg hover:bg-accent touch-manipulation">
                <Icon className="w-4 h-4 shrink-0 text-primary" />
                <span className="min-w-0 leading-tight">
                  <span className="block text-sm font-medium truncate">{s.label}</span>
                  <span className="block text-xs text-muted-foreground line-clamp-2 break-words" data-testid="suggestion-reason">{s.reason}</span>
                </span>
              </Link>
              {s.pin && (
                <button type="button" onClick={() => pin(s)} disabled={!!busy || full || !pins.isSuccess} data-testid="suggestion-pin"
                  aria-label={'Pin ' + s.label} title={full ? 'You have ' + MAX_PINS + ' pins: take one off first' : 'Pin it'}
                  className="w-12 shrink-0 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 touch-manipulation">
                  {busy === s.key && save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pin className="w-4 h-4" />}
                </button>
              )}
              <button type="button" onClick={() => dismiss(s)} disabled={!!busy} data-testid="suggestion-dismiss"
                aria-label={'Dismiss ' + s.label} title="Dismiss"
                className="w-12 shrink-0 flex items-center justify-center rounded-r-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 touch-manipulation">
                <X className="w-4 h-4" />
              </button>
            </li>
          )
        })}
      </ul>
      {error && <p className="text-sm text-destructive px-1" data-testid="suggestions-error">{error}</p>}
    </div>
  )
}
