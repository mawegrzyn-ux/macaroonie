// src/components/pos/OrderFlowsSection.jsx
//
// Store tech → Order flows (migration 235; shared/pos/orderFlows.js): rules
// that act on an order by themselves, company wide. A prompt that offers a
// dish or a choice of dishes (when a dish is added, or at checkout), or
// dishes and charges put on by themselves while the order matches (a channel,
// an order type, its dishes). Each runs at every location or the ones it
// names, on every till there or the ones it names. The list's order is the
// order flows act in (drag); each is switched on or off here; a flow is
// changed in the designer (pages/OrderFlowDesigner.jsx, /pos/flows/:id).

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Pencil, Plus, MessageSquarePlus, Zap, AlertTriangle, Loader2, Workflow } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { FLOWS_MAX, FLOW_NAME_MAX } from '@shared/pos/orderFlows.js'
import { Section, Field, Btn, ErrorNote, ConfirmDelete, Modal, SortableRows, Segmented, inputCls } from './shared'

export const FLOW_KIND_OPTIONS = [
  { value: 'ask', label: 'Suggest dishes' },
  { value: 'add', label: 'Add by itself' },
]

export function useOrderFlows() {
  const api = useApi()
  return useQuery({ queryKey: ['order-flows'], queryFn: () => api.get('/pos/order-flows') })
}

export const KindIcon = ({ kind, className }) => (kind === 'add' ? <Zap className={className} /> : <MessageSquarePlus className={className} />)

/** The on / off switch of a flow (its own save). */
export function OnSwitch({ on, onChange, disabled, label, testid }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} disabled={disabled} data-testid={testid}
      onClick={() => onChange(!on)}
      className={cn('relative inline-flex items-center h-11 min-w-[88px] px-1 rounded-full border touch-manipulation shrink-0 disabled:opacity-50',
        on ? 'bg-emerald-600 border-emerald-700 text-white' : 'bg-muted text-muted-foreground')}>
      <span className={cn('absolute top-1 w-9 h-9 rounded-full bg-white shadow transition-all', on ? 'left-[calc(100%-2.5rem)]' : 'left-1')} />
      <span className={cn('text-xs font-semibold w-full', on ? 'pr-10 text-left pl-2' : 'pl-10 text-right pr-2')}>{on ? 'On' : 'Off'}</span>
    </button>
  )
}

export default function OrderFlowsSection({ canManage = true }) {
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data, error } = useOrderFlows()
  const [starting, setStarting] = useState(null)
  const [err, setErr] = useState(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['order-flows'] })
  const create = useMutation({
    mutationFn: body => api.post('/pos/order-flows', body),
    onSuccess: f => { refresh(); navigate('/pos/flows/' + f.id) },
    onError: e => setErr(e),
  })
  const switchOn = useMutation({
    mutationFn: ({ id, on }) => api.patch('/pos/order-flows/' + id, { on }),
    onSuccess: () => { setErr(null); refresh() },
    onError: e => setErr(e),
  })
  const reorder = useMutation({
    mutationFn: ids => api.put('/pos/order-flows/order', { ids }),
    onSuccess: refresh,
    onError: e => setErr(e),
  })
  const remove = useMutation({
    mutationFn: id => api.delete('/pos/order-flows/' + id),
    onSuccess: () => { setErr(null); refresh() },
    onError: e => setErr(e),
  })

  if (!data) return <ErrorNote error={error} />
  const flows = data.flows || []
  const full = flows.length >= (data.max || FLOWS_MAX)

  return (
    <div className="space-y-4">
      <Section title="Order flows"
        hint="Suggest a dish when one is added or at checkout (Add a drink?), or put dishes and charges on orders by themselves (a bag charge on delivery orders). Each runs at the locations and tills you pick. Company wide."
        actions={canManage && (
          <Btn variant="primary" onClick={() => setStarting({ name: '', kind: 'ask' })} disabled={full} data-testid="new-flow">
            <Plus className="w-4 h-4" /> New flow
          </Btn>
        )}>
        {!flows.length && (
          <div className="text-sm text-muted-foreground flex items-start gap-3" data-testid="flows-empty">
            <Workflow className="w-5 h-5 shrink-0 mt-0.5" />
            <p>No flows yet. Start one: a prompt suggesting dishes, or dishes and charges that go on by themselves.</p>
          </div>
        )}
        {!!flows.length && (
          <div data-testid="flows">
            <SortableRows items={flows} locked={!canManage} onReorder={ids => reorder.mutate(ids)}
              renderItem={f => (
                <div className="flex flex-wrap items-center gap-3 py-1" data-testid="flow-row" data-id={f.id}>
                  <span className={cn('w-11 h-11 rounded-lg flex items-center justify-center shrink-0', f.kind === 'add' ? 'bg-violet-100 text-violet-800' : 'bg-sky-100 text-sky-800')}>
                    <KindIcon kind={f.kind} className="w-5 h-5" />
                  </span>
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-medium">{f.name}</p>
                    <p className="text-xs text-muted-foreground" data-testid="flow-summary">{f.summary}</p>
                    <p className="text-xs text-muted-foreground" data-testid="flow-where">{f.where}</p>
                    {f.problems.length > 0 && (
                      <p className="text-xs text-amber-700 flex items-center gap-1" data-testid="flow-needs">
                        <AlertTriangle className="w-3 h-3 shrink-0" /> Needs setting up before it can be switched on: {f.problems[0].message.toLowerCase()}
                      </p>
                    )}
                  </div>
                  <OnSwitch on={f.on} label={(f.on ? 'Switch off ' : 'Switch on ') + f.name} testid="flow-on"
                    disabled={!canManage || switchOn.isPending || (!f.on && f.problems.length > 0)}
                    onChange={on => switchOn.mutate({ id: f.id, on })} />
                  <Link to={'/pos/flows/' + f.id} title={(canManage ? 'Edit ' : 'Open ') + f.name} data-testid="flow-edit"
                    className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg text-sm font-medium border bg-background hover:bg-muted touch-manipulation">
                    <Pencil className="w-4 h-4" /> {canManage ? 'Edit' : 'Open'}
                  </Link>
                  {canManage && (
                    <>
                      <Btn title={'Copy ' + f.name} disabled={create.isPending || full} data-testid="flow-copy"
                        onClick={() => create.mutate({ name: (f.name + ' (copy)').slice(0, FLOW_NAME_MAX), copy_from: f.id })}>
                        <Copy className="w-4 h-4" />
                      </Btn>
                      <ConfirmDelete label={'Delete ' + f.name} confirmLabel="Yes, delete" onConfirm={() => remove.mutate(f.id)} disabled={remove.isPending} />
                    </>
                  )}
                </div>
              )} />
          </div>
        )}
        <ErrorNote error={err} />
        {!!flows.length && (
          <p className="text-xs text-muted-foreground">
            Flows act in this order{canManage ? ' (drag to change it)' : ''}: when two prompts are due together, the first one shows first.
            A new flow, or a copy, starts switched off. Deleting a flow leaves what it put on orders already.
          </p>
        )}
        {full && <p className="text-xs text-muted-foreground">A company can have up to {data.max || FLOWS_MAX} order flows.</p>}
      </Section>

      {starting && (
        <Modal title="New flow" onClose={() => setStarting(null)}
          footer={(
            <Btn variant="primary" className="flex-1" disabled={!starting.name.trim() || create.isPending} data-testid="new-flow-create"
              onClick={() => create.mutate({ name: starting.name.trim(), kind: starting.kind })}>
              {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Create and open
            </Btn>
          )}>
          <>
            <Field group label="What it does">
              <Segmented value={starting.kind} options={FLOW_KIND_OPTIONS} onChange={v => setStarting(s => ({ ...s, kind: v }))} />
            </Field>
            <p className="text-xs text-muted-foreground -mt-2" data-testid="new-flow-kind-hint">
              {starting.kind === 'add'
                ? 'Puts dishes or charges on the order by itself while the order matches, and takes them off again when it stops matching. You choose whether staff can take each one off.'
                : 'Shows staff a prompt offering a dish or a choice of dishes, when a dish is added or at checkout. No thanks is always there.'}
            </p>
            <Field label="Name" hint="For you: e.g. Add a drink, Delivery bag charge.">
              <input className={inputCls} value={starting.name} maxLength={FLOW_NAME_MAX} autoFocus data-testid="new-flow-name"
                onChange={e => setStarting(s => ({ ...s, name: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter' && starting.name.trim()) create.mutate({ name: starting.name.trim(), kind: starting.kind }) }} />
            </Field>
            <ErrorNote error={create.error} />
          </>
        </Modal>
      )}
    </div>
  )
}
