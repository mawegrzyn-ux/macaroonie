// src/components/pos/TillLayoutsSection.jsx
//
// Store tech → Till layouts (migration 228; shared/pos/tillLayout.js): how
// tills arrange their order screen, company wide. Which layout this venue's
// tills use (a till can pick its own in its window on Tills), the company's
// layouts with where each is used, a new one from a starting point or a
// copy, delete. A layout is edited on its own page (pages/TillLayoutDesigner.jsx).

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Pencil, Plus, PanelsTopLeft, AlertTriangle, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { LAYOUT_TEMPLATES } from '@shared/pos/tillLayout.js'
import { Section, Field, Btn, ErrorNote, ConfirmDelete, Modal, inputCls, usePosVenue } from './shared'
import { layoutName } from './TillsSection'

export function useTillLayouts() {
  const api = useApi()
  return useQuery({ queryKey: ['till-layouts'], queryFn: () => api.get('/pos/till-layouts') })
}

/** Where a layout is used, in words. */
export function usedByText(used, venues) {
  const parts = [
    ...(used?.venues || []).map(v => (venues.find(x => x.id === v.id)?.name || v.name) + ' (the location)'),
    ...(used?.tills || []).map(t => t.name + ' at ' + t.venue_name),
  ]
  return parts.length ? 'Used by ' + parts.join(', ') : 'Not used yet'
}

export default function TillLayoutsSection({ venueId, setup, canManage = true }) {
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { venues } = usePosVenue()
  const venueName = venues.find(v => v.id === venueId)?.name || 'This venue'
  const { data, error } = useTillLayouts()
  const [err, setErr] = useState(null)
  const [starting, setStarting] = useState(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['till-layouts'] })
    qc.invalidateQueries({ queryKey: ['pos-setup'] })
  }
  const setVenue = useMutation({
    mutationFn: id => api.patch(`/pos/venues/${venueId}/settings`, { till_layout_id: id || null }),
    onSuccess: () => { setErr(null); refresh() },
    onError: e => setErr(e),
  })
  const create = useMutation({
    mutationFn: body => api.post('/pos/till-layouts', body),
    onSuccess: l => { refresh(); navigate('/pos/layouts/' + l.id) },
    onError: e => setErr(e),
  })
  const remove = useMutation({
    mutationFn: id => api.delete('/pos/till-layouts/' + id),
    onSuccess: () => { setErr(null); refresh() },
    onError: e => setErr(e),
  })

  if (!data) return <ErrorNote error={error} />
  const layouts = data.layouts || []
  const tills = setup.devices.filter(d => d.kind === 'terminal' && !d.revoked_at)
  const ownChoice = tills.filter(d => d.settings?.till_layout && d.settings.till_layout !== 'venue')

  return (
    <div className="space-y-4">
      <Section title={'Tills at ' + venueName}
        hint="The layout this venue's tills draw their order screen with. A till can have its own: pick it in the till's window on Tills.">
        <Field label="Layout">
          <select className={inputCls} value={setup.settings.till_layout_id || ''} disabled={!canManage || setVenue.isPending}
            onChange={e => setVenue.mutate(e.target.value)} data-testid="venue-layout">
            <option value="">The standard screen</option>
            {layouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        {ownChoice.length > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="venue-layout-own">
            With their own: {ownChoice.map(d => d.name + ' (' + (d.settings.till_layout === 'standard' ? 'the standard screen' : layoutName(setup, d.settings.till_layout)) + ')').join(', ')}.
          </p>
        )}
        <ErrorNote error={err} />
      </Section>

      <Section title="Layouts"
        hint="Arrange the till's order screen: where the order, the categories, the dishes and your own buttons go, how big their buttons are, and where a dish's choices show. Company wide."
        actions={canManage && (
          <Btn variant="primary" onClick={() => setStarting({ name: '', from: 'standard' })} disabled={layouts.length >= 30} data-testid="new-layout">
            <Plus className="w-4 h-4" /> New layout
          </Btn>
        )}>
        {!layouts.length && (
          <div className="text-sm text-muted-foreground flex items-start gap-3">
            <PanelsTopLeft className="w-5 h-5 shrink-0 mt-0.5" />
            <p>No layouts yet: tills show the standard screen. Start one from the standard screen or the quick service layout and change it as you like.</p>
          </div>
        )}
        {!!layouts.length && (
          <div className="divide-y rounded-xl border" data-testid="layouts">
            {layouts.map(l => (
              <div key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="layout-row" data-id={l.id}>
                <span className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center shrink-0"><PanelsTopLeft className="w-4 h-4" /></span>
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">{l.zones} {l.zones === 1 ? 'zone' : 'zones'} · {usedByText(l.used_by, venues)}</p>
                  {l.problems > 0 && <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Needs fixing before it can be saved again</p>}
                </div>
                <Link to={'/pos/layouts/' + l.id} title={(canManage ? 'Edit ' : 'Open ') + l.name} data-testid="layout-edit"
                  className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg text-sm font-medium border bg-background hover:bg-muted touch-manipulation">
                  <Pencil className="w-4 h-4" /> {canManage ? 'Edit' : 'Open'}
                </Link>
                {canManage && (
                  <>
                    <Btn title={'Copy ' + l.name} disabled={create.isPending || layouts.length >= 30} data-testid="layout-copy"
                      onClick={() => create.mutate({ name: (l.name + ' (copy)').slice(0, 60), copy_from: l.id })}>
                      <Copy className="w-4 h-4" />
                    </Btn>
                    <ConfirmDelete label={'Delete ' + l.name}
                      confirmLabel={(l.used_by?.venues?.length || l.used_by?.tills?.length) ? 'Yes, delete (they go back)' : 'Yes, delete'}
                      onConfirm={() => remove.mutate(l.id)} disabled={remove.isPending} />
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {layouts.length >= 30 && <p className="text-xs text-muted-foreground">A company can have up to 30 layouts.</p>}
        <p className="text-xs text-muted-foreground">
          Deleting a layout puts the locations using it back on the standard screen, and the tills that picked it back on their location's.
        </p>
      </Section>

      {starting && (
        <Modal title="New layout" onClose={() => setStarting(null)}
          footer={(
            <Btn variant="primary" className="flex-1" disabled={!starting.name.trim() || create.isPending} data-testid="new-layout-create"
              onClick={() => create.mutate(starting.from.startsWith('copy:')
                ? { name: starting.name.trim(), copy_from: starting.from.slice(5) }
                : { name: starting.name.trim(), template: starting.from })}>
              {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Create and open
            </Btn>
          )}>
          <>
            <Field label="Name" hint="e.g. Counter, Bar, Busy Saturday.">
              <input className={inputCls} value={starting.name} maxLength={60} autoFocus data-testid="new-layout-name"
                onChange={e => setStarting(s => ({ ...s, name: e.target.value }))} />
            </Field>
            <Field label="Start from">
              <select className={inputCls} value={starting.from} data-testid="new-layout-from"
                onChange={e => setStarting(s => ({ ...s, from: e.target.value }))}>
                {LAYOUT_TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                {layouts.map(l => <option key={l.id} value={'copy:' + l.id}>A copy of {l.name}</option>)}
              </select>
            </Field>
            <ErrorNote error={create.error} />
          </>
        </Modal>
      )}
    </div>
  )
}
