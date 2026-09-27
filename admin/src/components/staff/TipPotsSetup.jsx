// src/components/staff/TipPotsSetup.jsx
//
// Tip pots section of Rota setup (migration 108). Tenant-wide, like shifts.
// A pot has a name, a distribution method (kept by the house / by points /
// manual amounts per person), the Cash Recon service charge / tips sources
// allocated to it (each source feeds at most one pot; sources belong to a
// venue, so the list is grouped by venue), and manual lines whose values
// are entered each week on the Rota page: £ or % (migration 115), and
// either may be negative to take money out of the pot.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Coins } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  SortableRows, Modal, Field, inputCls, ConfirmDelete, ErrorNote, Segmented,
} from '@/components/staff/shared'

export const POT_DISTRIBUTIONS = [
  { value: 'points', label: 'By points', hint: 'Shared by each person\'s tip points (shift points x role multiplier).' },
  { value: 'manual', label: 'Manual',    hint: 'Payroll types each person\'s amount every week on the Rota page.' },
  { value: 'house',  label: 'Kept by house', hint: 'Recorded as tips in, but not shared with staff.' },
]
export const POT_DIST_LABEL = Object.fromEntries(POT_DISTRIBUTIONS.map(d => [d.value, d.label]))

const LINE_KINDS = [
  { value: 'amount',  label: '£ amount' },
  { value: 'percent', label: '% of pot' },
]

function useScSources() {
  const api = useApi()
  return useQuery({ queryKey: ['rota-sc-sources'], queryFn: () => api.get('/rota/sc-sources') })
}

function invalidateAll(qc) {
  qc.invalidateQueries({ queryKey: ['rota-setup'] })
  qc.invalidateQueries({ queryKey: ['rota-sc-sources'] })
  qc.invalidateQueries({ queryKey: ['rota-pay'] })
}

function PotLines({ pot }) {
  const api = useApi()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [kind, setKind] = useState('amount')
  const add = useMutation({
    mutationFn: () => api.post(`/rota/pots/${pot.id}/lines`, { name: name.trim(), kind }),
    onSuccess: () => { setName(''); setKind('amount'); invalidateAll(qc) },
  })
  const remove = useMutation({ mutationFn: id => api.delete(`/rota/pot-lines/${id}`), onSuccess: () => invalidateAll(qc) })
  const reorder = useMutation({
    mutationFn: ids => api.put(`/rota/pots/${pot.id}/lines/reorder`, { ids }),
    onSettled: () => invalidateAll(qc),
  })

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Manual lines</p>
      <p className="text-[11px] text-muted-foreground">
        Adjustments to what Cash Recon brings in, e.g. a cash tips jar (£) or a card fee deduction (%).
        Name the line here; its value is entered each week on the Rota page, and can be negative to take money out.
        A % line is a percentage of the pot's Cash Recon sources plus its £ lines.
      </p>
      {pot.lines.length > 0 && (
        <SortableRows items={pot.lines} onReorder={ids => reorder.mutate(ids)} renderItem={l => (
          <div className="flex items-center gap-2 min-h-[44px]">
            <span className="flex-1 min-w-0 truncate text-sm">{l.name}</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
              {l.kind === 'percent' ? '%' : '£'}
            </span>
            <ConfirmDelete onConfirm={() => remove.mutate(l.id)} disabled={remove.isPending} label={`Delete ${l.name}`} />
          </div>
        )} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={kind} options={LINE_KINDS} onChange={setKind} />
        <input className={cn(inputCls, 'flex-1 min-w-[160px]')} placeholder={kind === 'percent' ? 'e.g. Card fees' : 'e.g. Cash tips jar'} value={name} maxLength={100}
          aria-label="New manual line name" onChange={e => setName(e.target.value)} />
        <button type="button" onClick={() => add.mutate()} disabled={!name.trim() || add.isPending}
          className="h-11 px-4 shrink-0 rounded-lg border text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50 flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add line
        </button>
      </div>
      <ErrorNote error={add.error || remove.error} />
    </div>
  )
}

// Waits for a just-created pot to appear in the refetched setup, then
// mounts the form keyed by pot id so its state starts from that pot.
function PotEditor({ potId, pots, onClose, onCreated }) {
  const pot = potId ? pots.find(p => p.id === potId) : null
  if (potId && !pot) {
    return (
      <Modal title="Tip pot" onClose={onClose}>
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      </Modal>
    )
  }
  return <PotForm key={potId ?? 'new'} pot={pot} pots={pots} onClose={onClose} onCreated={onCreated} />
}

function PotForm({ pot, pots, onClose, onCreated }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: sources = [], isLoading: loadingSources } = useScSources()
  const [name, setName] = useState(pot?.name ?? '')
  const [distribution, setDistribution] = useState(pot?.distribution ?? 'points')
  const [active, setActive] = useState(pot?.is_active ?? true)
  const [surchargeName, setSurchargeName] = useState(pot?.surcharge_name ?? '')
  const [surchargePct, setSurchargePct] = useState(pot?.surcharge_pct ? String(pot.surcharge_pct) : '')
  const pctNum = surchargePct === '' ? 0 : Number(surchargePct)
  const pctValid = Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100
  const [picked, setPicked] = useState(() => new Set(pot?.source_ids ?? []))

  const potName = useMemo(() => Object.fromEntries(pots.map(p => [p.id, p.name])), [pots])
  const byVenue = useMemo(() => {
    const m = new Map()
    for (const s of sources) {
      if (!m.has(s.venue_id)) m.set(s.venue_id, { name: s.venue_name, items: [] })
      m.get(s.venue_id).items.push(s)
    }
    return [...m.values()]
  }, [sources])

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(), distribution,
        surcharge_name: surchargeName.trim() || null,
        surcharge_pct: pctNum,
      }
      let id = pot?.id
      if (id) await api.patch(`/rota/pots/${id}`, { ...body, is_active: active })
      else id = (await api.post('/rota/pots', body)).id
      await api.put(`/rota/pots/${id}/sources`, { source_ids: [...picked] })
      return id
    },
    onSuccess: id => {
      invalidateAll(qc)
      if (!pot) onCreated(id)
      else onClose()
    },
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/rota/pots/${pot.id}`),
    onSuccess: () => { invalidateAll(qc); onClose() },
  })

  function toggle(id) {
    setPicked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const dist = POT_DISTRIBUTIONS.find(d => d.value === distribution)

  return (
    <Modal title={pot ? `Edit ${pot.name}` : 'Add tip pot'} onClose={onClose}
      footer={<>
        <button type="button" onClick={() => save.mutate()} disabled={!name.trim() || !pctValid || save.isPending}
          className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center justify-center gap-1.5">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {pot ? 'Save' : 'Create pot'}
        </button>
        {pot && <ConfirmDelete onConfirm={() => remove.mutate()} disabled={remove.isPending} label="Delete tip pot" />}
      </>}>
      <Field label="Name">
        <input className={inputCls} value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="e.g. Front of house tips" />
      </Field>
      <Field label="How the pot is shared" hint={dist?.hint}>
        <Segmented value={distribution} options={POT_DISTRIBUTIONS} onChange={setDistribution} />
      </Field>
      <Field label="Surcharge (optional)"
        hint={pctValid
          ? 'A percentage taken off the pot before it is shared, e.g. tax or card fees. Leave blank for none.'
          : 'Enter a percentage between 0 and 100.'}>
        <div className="flex gap-2">
          <input className={cn(inputCls, 'flex-1 min-w-0')} value={surchargeName} maxLength={60}
            onChange={e => setSurchargeName(e.target.value)} placeholder="Name, e.g. Tax" />
          <div className="relative w-28 shrink-0">
            <input className={cn(inputCls, 'pr-7 text-right')} type="text" inputMode="decimal"
              value={surchargePct} onChange={e => setSurchargePct(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">%</span>
          </div>
        </div>
      </Field>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Service charges and tips from Cash Recon</p>
        <p className="text-[11px] text-muted-foreground">
          Tick the sources whose week total goes into this pot. A source can only be in one pot; ticking one that is in another pot moves it here.
        </p>
        {loadingSources ? (
          <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
        ) : byVenue.length === 0 ? (
          <p className="text-sm text-muted-foreground">No service charge sources yet. Add them in Cash Recon settings.</p>
        ) : byVenue.map(v => (
          <div key={v.name} className="rounded-lg border">
            <p className="px-3 py-1.5 text-xs font-semibold bg-muted/40 border-b">{v.name}</p>
            {v.items.map(s => {
              const elsewhere = s.tip_pot_id && s.tip_pot_id !== pot?.id && picked.has(s.id) === false
              return (
                <label key={s.id} className="flex items-center gap-3 px-3 min-h-[44px] touch-manipulation cursor-pointer border-b last:border-b-0">
                  <input type="checkbox" className="w-5 h-5" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className={cn('flex-1 min-w-0 truncate text-sm', !s.is_active && 'text-muted-foreground')}>
                    {s.name}{!s.is_active && ' (inactive)'}
                  </span>
                  {elsewhere && <span className="text-[11px] text-muted-foreground shrink-0">in {potName[s.tip_pot_id] ?? 'another pot'}</span>}
                </label>
              )
            })}
          </div>
        ))}
      </div>

      {pot ? <PotLines pot={pot} /> : (
        <p className="text-[11px] text-muted-foreground">Create the pot first, then add manual lines.</p>
      )}

      {pot && (
        <label className="flex items-center gap-3 min-h-[44px] touch-manipulation">
          <input type="checkbox" className="w-5 h-5" checked={active} onChange={e => setActive(e.target.checked)} />
          <span className="text-sm">Active (shown on the Rota page)</span>
        </label>
      )}
      {pot && (
        <p className="text-[11px] text-muted-foreground">
          Deleting a pot takes its sources out of it and removes its manual lines and all weekly amounts entered for it.
        </p>
      )}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

export function TipPotsSection({ pots }) {
  const api = useApi()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null) // null | 'new' | pot id
  const reorder = useMutation({
    mutationFn: ids => api.put('/rota/pots/reorder', { ids }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rota-setup'] }),
  })

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold flex-1">Tip pots</h2>
        <button type="button" onClick={() => setEditing('new')}
          className="h-10 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add tip pot
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        A pot collects service charges and tips from Cash Recon plus any manual lines, and is shared by points, shared by hand, or kept by the house.
      </p>
      {pots.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No tip pots yet. Add one, e.g. "Staff tips" shared by points.</p>
      ) : (
        <SortableRows items={pots} onReorder={ids => reorder.mutate(ids)} renderItem={p => (
          <button type="button" onClick={() => setEditing(p.id)}
            className={cn('w-full min-h-[48px] flex flex-wrap items-center gap-x-3 gap-y-1 text-left rounded-lg px-2 py-1 hover:bg-muted touch-manipulation', !p.is_active && 'opacity-60')}>
            <Coins className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="flex-1 basis-24 min-w-0 truncate text-sm font-medium">{p.name}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{POT_DIST_LABEL[p.distribution]}</span>
            {p.surcharge_pct > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                {p.surcharge_name || 'Surcharge'} {p.surcharge_pct}%
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {p.source_ids.length} source{p.source_ids.length === 1 ? '' : 's'} · {p.lines.length} manual line{p.lines.length === 1 ? '' : 's'}
            </span>
            {!p.is_active && <span className="text-[11px] text-muted-foreground">Inactive</span>}
          </button>
        )} />
      )}
      {editing && (
        <PotEditor potId={editing === 'new' ? null : editing} pots={pots}
          onClose={() => setEditing(null)} onCreated={id => setEditing(id)} />
      )}
    </section>
  )
}
