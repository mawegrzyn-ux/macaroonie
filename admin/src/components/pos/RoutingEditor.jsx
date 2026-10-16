// src/components/pos/RoutingEditor.jsx
//
// "What goes where" for printers (pos_print_routes): a dish goes to what is
// set for the dish, else its menu section, else its revenue centre, else
// Everything (routeFor() in shared/pos/printing.js). Explicit Save. (Kitchen
// screens use the kitchen flow instead: KitchenFlow.jsx.)

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, X, Search } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { inputCls, ErrorNote, Btn } from './shared'

/** Target chips (printers or stations) for one routing target. */
function TargetChips({ targets, chosen, onToggle, label }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {targets.map(p => {
        const on = chosen.includes(p.id)
        return (
          <button key={p.id} type="button" onClick={() => onToggle(p.id)} aria-pressed={on}
            className={cn('min-h-[44px] px-3 rounded-lg border text-sm touch-manipulation', on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
            {p.name}
          </button>
        )
      })}
    </div>
  )
}

const keyOf = (kind, id) => kind + ':' + (id || '')

/**
 *   targets    [{ id, name }] the printers or stations to choose from
 *   routes     saved routes [{ [idKey], target_kind, target_id }]
 *   idKey      'printer_id' | 'station_id'
 *   path       the PUT route for the whole list
 *   noun       'Printers' | 'Stations' (aria labels)
 */
export default function RoutingEditor({ venueId, setup, targets, routes, idKey, path, noun, saveLabel, emptyText, everythingHint, findHint }) {
  const api = useApi()
  const qc = useQueryClient()
  const toMap = list => {
    const m = {}
    for (const r of list) {
      const k = keyOf(r.target_kind, r.target_id)
      m[k] = [...(m[k] || []), r[idKey]]
    }
    return m
  }
  const saved = useMemo(() => toMap(routes), [routes]) // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])
  const [search, setSearch] = useState('')
  const dishKeys = Object.keys(draft).filter(k => k.startsWith('item:') && draft[k].length)
  const [extraDishes, setExtraDishes] = useState([])
  const shownDishes = [...new Set([...dishKeys.map(k => k.slice(5)), ...extraDishes])]
  const normal = m => Object.keys(m).filter(k => m[k]?.length).sort().map(k => [k, [...m[k]].sort()])
  const dirty = JSON.stringify(normal(draft)) !== JSON.stringify(normal(saved))

  function toggle(kind, id, targetId) {
    const k = keyOf(kind, id)
    setDraft(d => {
      const list = d[k] || []
      return { ...d, [k]: list.includes(targetId) ? list.filter(x => x !== targetId) : [...list, targetId] }
    })
  }
  const save = useMutation({
    mutationFn: () => {
      const out = []
      for (const [k, ids] of Object.entries(draft)) {
        const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
        for (const t of ids) out.push({ [idKey]: t, target_kind: kind, target_id: id || null })
      }
      return api.put(path, { routes: out })
    },
    onSuccess: () => { setExtraDishes([]); qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }) },
  })

  if (!targets.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>
  const itemById = Object.fromEntries(setup.items.map(i => [i.id, i]))
  const matches = search.trim().length >= 2
    ? setup.items.filter(i => i.name.toLowerCase().includes(search.trim().toLowerCase()) && !shownDishes.includes(i.id)).slice(0, 8)
    : []
  const row = (title, kind, id, sub) => (
    <div key={keyOf(kind, id)} className="flex flex-col sm:flex-row sm:items-center gap-2 py-2">
      <div className="sm:w-48 shrink-0">
        <p className="text-sm font-medium">{title}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <TargetChips targets={targets} chosen={draft[keyOf(kind, id)] || []} onToggle={tid => toggle(kind, id, tid)} label={noun + ' for ' + title} />
    </div>
  )

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold mb-1">Everything</h3>
        <p className="text-xs text-muted-foreground mb-1">{everythingHint}</p>
        {row('Everything', 'default', null)}
      </div>
      {setup.revenue_centres.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-1">By revenue centre</h3>
          <div className="divide-y">{setup.revenue_centres.map(rc => row(rc.name, 'revenue_centre', rc.id))}</div>
        </div>
      )}
      {setup.menus.map(m => {
        const secs = setup.sections.filter(s => s.menu_id === m.id)
        if (!secs.length) return null
        return (
          <div key={m.id}>
            <h3 className="text-sm font-semibold mb-1">{m.name}: by section</h3>
            <div className="divide-y">{secs.map(s => row(s.title, 'section', s.id))}</div>
          </div>
        )
      })}
      <div>
        <h3 className="text-sm font-semibold mb-1">Single dishes</h3>
        <div className="divide-y">
          {shownDishes.map(id => itemById[id] && (
            <div key={id} className="flex items-start gap-2">
              <div className="flex-1">{row(itemById[id].name, 'item', id, setup.sections.find(s => s.id === itemById[id].section_id)?.title)}</div>
              <button type="button" aria-label={'Remove ' + itemById[id].name} onClick={() => {
                setDraft(d => ({ ...d, [keyOf('item', id)]: [] }))
                setExtraDishes(x => x.filter(y => y !== id))
              }} className="w-11 h-11 mt-2 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="relative mt-2 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-3.5 text-muted-foreground" />
          <input className={cn(inputCls, 'pl-9')} value={search} onChange={e => setSearch(e.target.value)} placeholder={findHint} aria-label="Find a dish" />
          {matches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border bg-background shadow-lg divide-y">
              {matches.map(i => (
                <button key={i.id} type="button" onClick={() => { setExtraDishes(x => [...x, i.id]); setSearch('') }}
                  className="w-full text-left px-3 min-h-[44px] text-sm hover:bg-muted touch-manipulation">{i.name}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
        <Btn variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {saveLabel}
        </Btn>
        {dirty && <Btn onClick={() => { setDraft(saved); setExtraDishes([]) }}>Discard</Btn>}
        <ErrorNote error={save.error} />
      </div>
    </div>
  )
}
