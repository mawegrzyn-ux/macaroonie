// src/components/home/TeamSuggestions.jsx — the Team signal (Pepper-first
// step 7b, migration 283).
//
// Someone with Manage on Navigation suggests a page (at a venue and tab,
// where the page takes them) to a role, with an optional note. Everyone in
// that role sees it among Home's suggestions, "Suggested by <name or role>:
// <note>", until they pin it or dismiss it.
//
//   TeamSuggestionsCard  the list and Suggest a page, on the Navigation
//                        designer (pages/NavDesigner.jsx)
//   SuggestForm          the window that makes one, also opened from a pin's
//                        row in the pins editor (Pins.jsx: Suggest to a role)
//   useCanSuggest()      whether the person can (Manage on Navigation)
//
// All through /api/suggestions/team (api/src/routes/suggestions.js).

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, X, Loader2, Trash2, Megaphone } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { pageAccepts } from '@shared/nav/links.js'

export const NOTE_MAX = 140
const tabName = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '')

/** Whether the person can suggest pages to roles: Manage on Navigation (or a platform admin). */
export function useCanSuggest() {
  const api = useApi()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  return me?.permissions?.nav_designer === 'manage' || !!me?.is_platform_admin
}

/** The person's menu links, once each: { route, label }. */
function linksOf(tree) {
  const out = []
  const seen = new Set()
  const walk = nodes => {
    for (const n of nodes || []) {
      if (n.kind === 'link' && n.route && n.route !== '/' && !seen.has(n.route)) { seen.add(n.route); out.push({ route: n.route, label: n.label }) }
      walk(n.children)
    }
  }
  walk(tree)
  return out
}

/** The list of team suggestions and the way to add one. */
export function TeamSuggestionsCard() {
  const api = useApi()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['team-suggestions'], queryFn: () => api.get('/suggestions/team') })
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const remove = useMutation({
    mutationFn: id => api.delete('/suggestions/team/' + id),
    onSuccess: () => { setConfirm(null); qc.invalidateQueries({ queryKey: ['team-suggestions'] }) },
  })
  const rows = list.data?.suggestions || []
  const canManage = !!list.data?.can_manage
  return (
    <section className="border rounded-xl overflow-hidden bg-background" data-testid="team-suggestions">
      <div className="section-head px-4 py-2.5 flex items-center gap-2">
        <Megaphone className="w-4 h-4 shrink-0" />
        <h2 className="font-semibold flex-1">Suggested to roles</h2>
        {canManage && (
          <button type="button" onClick={() => setAdding(true)} data-testid="team-suggest-add"
            className="inline-flex items-center gap-1.5 min-h-[48px] px-3 rounded-md text-sm font-medium hover:bg-black/5 touch-manipulation">
            <Plus className="w-4 h-4" /> Suggest a page
          </button>
        )}
      </div>
      <p className="px-4 pt-3 text-sm text-muted-foreground">
        A page you suggest to a role shows on Home for everyone in it, with your note, until they pin it or dismiss it.
      </p>
      {list.isLoading && <p className="px-4 py-3 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline animate-spin" /> Loading</p>}
      {list.isError && <p className="px-4 py-3 text-sm text-destructive">Couldn&apos;t load them: {list.error?.message}</p>}
      {list.isSuccess && !rows.length && <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="team-suggestions-empty">Nothing suggested yet.</p>}
      {rows.length > 0 && (
        <ul className="divide-y mt-2">
          {rows.map(r => (
            <li key={r.id} className="px-4 py-2 flex flex-wrap items-center gap-2" data-testid="team-suggestion" data-id={r.id}>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium"><Users className="w-3.5 h-3.5" /> {r.role_label}</span>
              <div className="flex-1 min-w-[12rem]">
                <p className="text-sm font-medium">{r.label}{[r.venue_name, tabName(r.tab)].filter(Boolean).length ? ' · ' + [r.venue_name, tabName(r.tab)].filter(Boolean).join(' · ') : ''}</p>
                <p className="text-xs text-muted-foreground break-words">Suggested by {r.by_label}{r.note ? ': ' + r.note : ''}</p>
              </div>
              {canManage && (confirm === r.id ? (
                <span className="flex items-center gap-2">
                  <span className="text-sm text-destructive">Take it back?</span>
                  <button type="button" onClick={() => remove.mutate(r.id)} disabled={remove.isPending} data-testid="team-suggestion-remove-yes"
                    className="min-h-[48px] px-3 rounded-md bg-destructive text-white text-sm font-medium touch-manipulation disabled:opacity-50">Yes, remove</button>
                  <button type="button" onClick={() => setConfirm(null)} className="min-h-[48px] px-3 rounded-md border text-sm touch-manipulation">Keep</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirm(r.id)} aria-label={'Remove ' + r.label + ' for ' + r.role_label} data-testid="team-suggestion-remove"
                  className="w-12 h-12 flex items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive touch-manipulation">
                  <Trash2 className="w-4 h-4" />
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
      {remove.isError && <p className="px-4 pb-3 text-sm text-destructive">{remove.error?.message}</p>}
      <div className="h-2" />
      {adding && <SuggestForm onClose={() => setAdding(false)} />}
    </section>
  )
}

/** The window that suggests a page to a role. `initial`: { path, venue_id, tab } (from a pin). */
export function SuggestForm({ initial = null, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const { data: roles = [] } = useQuery({ queryKey: ['access-roles'], queryFn: () => api.get('/access/roles') })
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const links = useMemo(() => linksOf(me?.nav_tree), [me?.nav_tree])
  const [path, setPath] = useState(initial?.path || '')
  const [venueId, setVenueId] = useState(initial?.venue_id || '')
  const [tab, setTab] = useState(initial?.tab || '')
  const [roleId, setRoleId] = useState('')
  const [note, setNote] = useState('')
  const [signAs, setSignAs] = useState('name')
  const { keys, tabs } = pageAccepts(path)
  const save = useMutation({
    mutationFn: () => api.post('/suggestions/team', {
      role_id: roleId, path, venue_id: keys.includes('venue') ? venueId || null : null,
      tab: keys.includes('tab') ? tab || null : null, note: note.trim() || null, sign_as: signAs,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team-suggestions'] }); onClose() },
  })
  const field = 'w-full h-12 rounded-md border bg-background px-2 text-sm touch-manipulation'
  const ready = path && roleId && note.length <= NOTE_MAX
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Suggest a page to a role" data-testid="team-suggest-form"
        className="w-full sm:max-w-lg bg-background rounded-t-xl sm:rounded-xl shadow-xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="section-head px-4 h-14 shrink-0 flex items-center gap-2 rounded-t-xl">
          <Megaphone className="w-4 h-4" />
          <h2 className="font-semibold flex-1">Suggest a page to a role</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-12 h-12 -mr-2 flex items-center justify-center rounded-md hover:bg-black/5 touch-manipulation">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          <label className="block text-sm font-medium">Page
            <select value={path} onChange={e => { setPath(e.target.value); setTab('') }} className={cn(field, 'mt-1')} data-testid="team-suggest-page">
              <option value="">Pick a page</option>
              {links.map(l => <option key={l.route} value={l.route}>{l.label}</option>)}
            </select>
          </label>
          {keys.includes('venue') && venues.length > 0 && (
            <label className="block text-sm font-medium">Opens at
              <select value={venueId} onChange={e => setVenueId(e.target.value)} className={cn(field, 'mt-1')} data-testid="team-suggest-venue">
                <option value="">Their own venue on Home</option>
                {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          )}
          {keys.includes('tab') && tabs.length > 0 && (
            <label className="block text-sm font-medium">Tab
              <select value={tab} onChange={e => setTab(e.target.value)} className={cn(field, 'mt-1')} data-testid="team-suggest-tab">
                <option value="">First tab</option>
                {tabs.map(t => <option key={t} value={t}>{tabName(t)}</option>)}
              </select>
            </label>
          )}
          <label className="block text-sm font-medium">To everyone in the role
            <select value={roleId} onChange={e => setRoleId(e.target.value)} className={cn(field, 'mt-1')} data-testid="team-suggest-role">
              <option value="">Pick a role</option>
              {roles.filter(r => r.is_active !== false).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Note (optional)
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Why it's worth a look"
              className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm touch-manipulation" data-testid="team-suggest-note" />
            <span className={cn('block text-xs text-right', note.length > NOTE_MAX ? 'text-destructive' : 'text-muted-foreground')}>{note.length} / {NOTE_MAX}</span>
          </label>
          <fieldset className="text-sm">
            <legend className="font-medium mb-1">Signed with</legend>
            <div className="flex gap-2">
              {[['name', 'Your name'], ['role', 'Your role']].map(([k, label]) => (
                <label key={k} className={cn('flex-1 flex items-center gap-2 min-h-[48px] px-3 rounded-md border touch-manipulation cursor-pointer', signAs === k && 'border-primary bg-primary/5')}>
                  <input type="radio" name="sign_as" value={k} checked={signAs === k} onChange={() => setSignAs(k)} data-testid={'team-suggest-sign-' + k} /> {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="shrink-0 border-t p-3 flex items-center gap-2">
          {save.isError && <p className="text-sm text-destructive flex-1 min-w-0" data-testid="team-suggest-error">{save.error?.message}</p>}
          <button type="button" onClick={onClose} className="ml-auto min-h-[48px] px-4 rounded-md border text-sm touch-manipulation">Cancel</button>
          <button type="button" onClick={() => save.mutate()} disabled={!ready || save.isPending} data-testid="team-suggest-save"
            className="min-h-[48px] px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50 touch-manipulation">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Suggest it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
