// src/components/pos/PrintersSection.jsx
//
// Till setup > Printers: the venue's network printers and what prints
// where. A dish's kitchen ticket goes to the printers set for the dish,
// else its menu section, else its revenue centre, else Everything
// (routeFor() in shared/pos/printing.js). Printing to network printers
// goes through the venue hub, which comes later (docs/POS.md): until then
// print jobs wait in the queue and tills print bills in their browser.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil, X, Search } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Segmented, Btn, NumberBox, Toggle } from './shared'

const KINDS = [
  { value: 'station', label: 'Kitchen / bar' },
  { value: 'receipt', label: 'Receipts' },
]

function PrinterModal({ venueId, setup, printer, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: printer?.name || '', kind: printer?.kind || 'station', host: printer?.host || '',
    port: printer?.port ?? 9100, columns: printer?.columns ?? 42,
    backup_printer_id: printer?.backup_printer_id || '', is_active: printer ? printer.is_active : true,
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] })
  const body = () => ({
    ...form, name: form.name.trim(), host: form.host.trim() || null,
    port: form.port || 9100, columns: form.columns || 42, backup_printer_id: form.backup_printer_id || null,
  })
  const save = useMutation({
    mutationFn: () => printer ? api.patch(`/pos/printers/${printer.id}`, body()) : api.post(`/pos/venues/${venueId}/printers`, body()),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/printers/${printer.id}`), onSuccess: () => { refresh(); onClose() } })
  return (
    <Modal title={printer ? 'Edit ' + printer.name : 'Add a printer'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {printer && <ConfirmDelete label="Delete printer" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      <Field label="Name"><input className={inputCls} value={form.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder="e.g. Kitchen" /></Field>
      <Field label="Used for"><Segmented value={form.kind} options={KINDS} onChange={v => set({ kind: v })} /></Field>
      <div className="flex flex-wrap gap-4">
        <Field label="IP address" hint="Give the printer a fixed address on the router.">
          <input className={cn(inputCls, 'w-48')} value={form.host} maxLength={120} onChange={e => set({ host: e.target.value })} placeholder="192.168.1.50" inputMode="decimal" />
        </Field>
        <Field label="Port"><NumberBox value={form.port} max={65535} min={1} onChange={v => set({ port: v })} ariaLabel="Port" /></Field>
        <Field label="Characters per line" hint="80mm paper: 42 (48 on some).">
          <NumberBox value={form.columns} min={24} max={64} onChange={v => set({ columns: v })} ariaLabel="Characters per line" />
        </Field>
      </div>
      <Field label="Backup printer" hint="Used when this one doesn't answer.">
        <select className={inputCls} value={form.backup_printer_id} onChange={e => set({ backup_printer_id: e.target.value })}>
          <option value="">None</option>
          {setup.printers.filter(p => p.id !== printer?.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      {printer && <Toggle label="In use" checked={form.is_active} onChange={v => set({ is_active: v })} />}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

/** Printer chips for one routing target. */
function PrinterChips({ printers, chosen, onToggle, label }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {printers.map(p => {
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

function RoutingEditor({ venueId, setup }) {
  const api = useApi()
  const qc = useQueryClient()
  const printers = setup.printers.filter(p => p.is_active)
  const toMap = routes => {
    const m = {}
    for (const r of routes) {
      const k = keyOf(r.target_kind, r.target_id)
      m[k] = [...(m[k] || []), r.printer_id]
    }
    return m
  }
  const saved = useMemo(() => toMap(setup.routes), [setup.routes])
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])
  const [search, setSearch] = useState('')
  const dishKeys = Object.keys(draft).filter(k => k.startsWith('item:') && draft[k].length)
  const [extraDishes, setExtraDishes] = useState([])
  const shownDishes = [...new Set([...dishKeys.map(k => k.slice(5)), ...extraDishes])]
  const dirty = JSON.stringify(normal(draft)) !== JSON.stringify(normal(saved))

  function normal(m) {
    return Object.keys(m).filter(k => m[k]?.length).sort().map(k => [k, [...m[k]].sort()])
  }
  function toggle(kind, id, printerId) {
    const k = keyOf(kind, id)
    setDraft(d => {
      const list = d[k] || []
      return { ...d, [k]: list.includes(printerId) ? list.filter(x => x !== printerId) : [...list, printerId] }
    })
  }
  const save = useMutation({
    mutationFn: () => {
      const routes = []
      for (const [k, ids] of Object.entries(draft)) {
        const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
        for (const printer_id of ids) routes.push({ printer_id, target_kind: kind, target_id: id || null })
      }
      return api.put(`/pos/venues/${venueId}/routes`, { routes })
    },
    onSuccess: () => { setExtraDishes([]); qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }) },
  })

  if (!printers.length) return <p className="text-sm text-muted-foreground">Add a printer first, then choose what prints on it.</p>
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
      <PrinterChips printers={printers} chosen={draft[keyOf(kind, id)] || []} onToggle={pid => toggle(kind, id, pid)} label={'Printers for ' + title} />
    </div>
  )

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold mb-1">Everything</h3>
        <p className="text-xs text-muted-foreground mb-1">Dishes with nothing set below print here.</p>
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
          <input className={cn(inputCls, 'pl-9')} value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a dish to set its own printer" aria-label="Find a dish" />
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
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save printing
        </Btn>
        {dirty && <Btn onClick={() => { setDraft(saved); setExtraDishes([]) }}>Discard</Btn>}
        <ErrorNote error={save.error} />
      </div>
    </div>
  )
}

export default function PrintersSection({ venueId, setup }) {
  const [editing, setEditing] = useState(null)
  return (
    <>
      <Section title="Printers" hint="Epson network printers (ePOS or ESC/POS on port 9100). They print through the venue hub, which is coming later: until then kitchen tickets wait in the print queue (Till reports) and tills print bills and receipts in their own browser."
        actions={<Btn variant="primary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add</Btn>}>
        {!setup.printers.length
          ? <p className="text-sm text-muted-foreground">No printers yet.</p>
          : (
            <div className="rounded-xl border divide-y">
              {setup.printers.map(p => (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-medium', !p.is_active && 'line-through text-muted-foreground')}>{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.kind === 'receipt' ? 'Receipts' : 'Kitchen / bar'} · {p.host ? p.host + ':' + p.port : 'no address yet'} · {p.columns} characters
                      {p.backup_printer_id && ' · backup ' + (setup.printers.find(x => x.id === p.backup_printer_id)?.name || '')}
                    </p>
                  </div>
                  <Btn onClick={() => setEditing(p)} title={'Edit ' + p.name}><Pencil className="w-4 h-4" /></Btn>
                </div>
              ))}
            </div>
          )}
        {editing && <PrinterModal venueId={venueId} setup={setup} printer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </Section>
      <Section title="What prints where" hint="A dish prints on the printers set for it, else for its section, else for its revenue centre, else Everything.">
        <RoutingEditor venueId={venueId} setup={setup} />
      </Section>
    </>
  )
}
