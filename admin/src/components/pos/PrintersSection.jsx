// src/components/pos/PrintersSection.jsx
//
// Till setup > Printers: the venue's network printers and what prints
// where. A dish's kitchen ticket goes to the printers set for the dish,
// else its menu section, else its revenue centre, else Everything
// (routeFor() in shared/pos/printing.js). Printing to network printers
// goes through the venue hub, which comes later (docs/POS.md): until then
// print jobs wait in the queue and tills print bills in their browser.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Segmented, Btn, NumberBox, Toggle } from './shared'
import RoutingEditor from './RoutingEditor'

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
      <Field group label="Used for"><Segmented value={form.kind} options={KINDS} onChange={v => set({ kind: v })} /></Field>
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
        <RoutingEditor venueId={venueId} setup={setup} targets={setup.printers.filter(p => p.is_active)} routes={setup.routes}
          idKey="printer_id" path={`/pos/venues/${venueId}/routes`} noun="Printers" saveLabel="Save printing"
          emptyText="Add a printer first, then choose what prints on it."
          everythingHint="Dishes with nothing set below print here." findHint="Find a dish to set its own printer" />
      </Section>
    </>
  )
}
