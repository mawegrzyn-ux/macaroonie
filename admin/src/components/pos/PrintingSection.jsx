// src/components/pos/PrintingSection.jsx
//
// Store tech → Printing (migration 190): the company's designs for printed
// kitchen tickets and receipts, and which design prints where, for the whole
// company and for the venue picked at the top of Store tech. Designs are
// edited on their own page (pages/PrintDesigner.jsx). shared/pos/ticketLayout.js.

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Pencil, Plus, Receipt, ChefHat } from 'lucide-react'
import { useApi } from '@/lib/api'
import { PRINT_USES, kindOfUse } from '@shared/pos/ticketLayout.js'
import { Section, Field, Btn, ErrorNote, ConfirmDelete, usePosVenue } from './shared'

const KIND_NAMES = { kitchen: 'Kitchen ticket', receipt: 'Receipt' }
const selectCls = 'h-11 w-full rounded-lg border bg-background px-3 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40'

export function usePrintDesigns(venueId) {
  const api = useApi()
  return useQuery({
    queryKey: ['print-designs', venueId || null],
    queryFn: () => api.get('/pos/print-designs' + (venueId ? '?venue_id=' + venueId : '')),
  })
}

export default function PrintingSection({ venueId, canManage = true }) {
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { venues } = usePosVenue()
  const venueName = venues.find(v => v.id === venueId)?.name || 'This venue'
  const { data, error } = usePrintDesigns(venueId)
  const [err, setErr] = useState(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['print-designs'] })

  const setUse = useMutation({
    mutationFn: body => api.put('/pos/print-design-uses', body),
    onSuccess: () => { setErr(null); refresh() },
    onError: e => setErr(e),
  })
  const create = useMutation({
    mutationFn: body => api.post('/pos/print-designs', body),
    onSuccess: d => { refresh(); navigate('/pos/printing/designs/' + d.id) },
    onError: e => setErr(e),
  })
  const remove = useMutation({
    mutationFn: id => api.delete('/pos/print-designs/' + id),
    onSuccess: () => { setErr(null); refresh() },
    onError: e => setErr(e),
  })

  if (!data) return <ErrorNote error={error} />
  const designs = data.designs || []
  const ofKind = kind => designs.filter(d => d.kind === kind)
  const nameOf = id => designs.find(d => d.id === id)?.name
  const where = d => {
    const list = data.used_at?.[d.id] || []
    if (!list.length) return 'Not used anywhere yet'
    return list.map(u => (PRINT_USES.find(x => x.key === u.use)?.label || u.use) + ' (' + (u.venue_id ? venues.find(v => v.id === u.venue_id)?.name || 'a venue' : 'company') + ')').join(', ')
  }
  // What a use prints at the company level, in words.
  const companyText = use => {
    const id = data.uses.company?.[use]
    if (id) return nameOf(id)
    if (use === 'kiosk_receipt' && data.uses.company?.receipt) return 'Same as till receipts (' + nameOf(data.uses.company.receipt) + ')'
    return 'Built-in layout'
  }

  return (
    <div className="space-y-4">
      <Section title="What prints where"
        hint="Pick a design for each kind of ticket for the whole company, and change it at this venue if it needs another. A venue left on the company's prints the company's.">
        <div className="space-y-4" data-testid="print-uses">
          {PRINT_USES.map(u => {
            const options = ofKind(kindOfUse(u.key))
            return (
              <div key={u.key} className="rounded-lg border p-3 space-y-3" data-testid="print-use" data-use={u.key}>
                <p className="text-sm font-semibold">{u.label}</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Company">
                    <select className={selectCls} value={data.uses.company?.[u.key] || ''} disabled={!canManage || setUse.isPending}
                      onChange={e => setUse.mutate({ venue_id: null, use: u.key, design_id: e.target.value || null })} data-testid="use-company">
                      <option value="">{u.key === 'kiosk_receipt' ? 'Same as till receipts' : 'Built-in layout'}</option>
                      {options.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </Field>
                  <Field label={venueName}>
                    <select className={selectCls} value={data.uses.venue?.[u.key] || ''} disabled={!canManage || setUse.isPending}
                      onChange={e => setUse.mutate({ venue_id: venueId, use: u.key, design_id: e.target.value || null })} data-testid="use-venue">
                      <option value="">Same as the company ({companyText(u.key)})</option>
                      {options.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
            )
          })}
        </div>
        <ErrorNote error={err} />
      </Section>

      {['kitchen', 'receipt'].map(kind => (
        <Section key={kind} title={kind === 'kitchen' ? 'Kitchen ticket designs' : 'Receipt designs'}
          hint={kind === 'kitchen'
            ? 'What a kitchen or bar ticket shows and in which order: the station, the order title (table, order number, tent or name), details, the dishes, your own words.'
            : 'What receipts and bills show: your name and address, a heading, the details, the dishes, totals, VAT, payments, a footer. A venue can change the words and hide parts of a design.'}
          actions={canManage && (
            <Btn variant="primary" disabled={create.isPending} onClick={() => create.mutate({ kind, name: 'New ' + KIND_NAMES[kind].toLowerCase() + ' design' })}
              data-testid={'new-design-' + kind}>
              <Plus className="w-4 h-4" /> New design
            </Btn>
          )}>
          {ofKind(kind).length === 0 && (
            <p className="text-sm text-muted-foreground">
              No designs yet: tickets print in the built-in layout. Start a design to change it.
            </p>
          )}
          <div className="divide-y rounded-xl border" data-testid={'designs-' + kind}>
            {ofKind(kind).map(d => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="design-row">
                <span className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  {kind === 'kitchen' ? <ChefHat className="w-4 h-4" /> : <Receipt className="w-4 h-4" />}
                </span>
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{where(d)}</p>
                </div>
                <Link to={'/pos/printing/designs/' + d.id} title={(canManage ? 'Edit ' : 'Open ') + d.name}
                  className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg text-sm font-medium border bg-background hover:bg-muted touch-manipulation">
                  <Pencil className="w-4 h-4" /> {canManage ? 'Edit' : 'Open'}
                </Link>
                {canManage && (
                  <>
                    <Btn title={'Copy ' + d.name} disabled={create.isPending}
                      onClick={() => create.mutate({ kind, name: (d.name + ' (copy)').slice(0, 80), copy_from: d.id })}>
                      <Copy className="w-4 h-4" />
                    </Btn>
                    <ConfirmDelete label={'Delete ' + d.name}
                      confirmLabel={(data.used_at?.[d.id] || []).length ? 'Yes, delete (places using it go back)' : 'Yes, delete'}
                      onConfirm={() => remove.mutate(d.id)} />
                  </>
                )}
              </div>
            ))}
          </div>
        </Section>
      ))}
    </div>
  )
}
