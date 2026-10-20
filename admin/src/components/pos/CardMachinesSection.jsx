// src/components/pos/CardMachinesSection.jsx
//
// Till setup > Card machines (migration 193): the card machines at this
// venue, the company's accounts with Dojo, Stripe Terminal or SumUp, and the
// card payments taken lately. A till or kiosk picks its machine in its own
// settings (CardMachinePick). The money moves on the card machine; the till
// records a payment only once the provider says it was approved, so this tab
// shows what went through and flags money taken that no check shows.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Pencil, CreditCard, RefreshCw, AlertTriangle, KeyRound } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { Section, Modal, Field, inputCls, ErrorNote, ConfirmDelete, Segmented, Btn, money, ago } from './shared'

const PROVIDERS = [
  { value: 'dojo', label: 'Dojo' },
  { value: 'stripe', label: 'Stripe Terminal' },
  { value: 'sumup', label: 'SumUp' },
]

// Where each provider keeps the key, in staff words.
const KEY_HINT = {
  dojo: 'The secret key from the Dojo developer portal (API keys): sk_prod_… for real payments, sk_sandbox_… to try it.',
  stripe: 'A secret key from the Stripe Dashboard (Developers, API keys): sk_live_… or sk_test_…, or a restricted key with Terminal and PaymentIntents write.',
  sumup: 'An API key from SumUp (Developer settings, API keys): sup_sk_….',
}

const ADD_HINT = {
  dojo: 'Dojo card machines on this account are listed below: add the one at this venue.',
  stripe: 'Pick a reader already on the account, or type the registration code a new reader shows (Settings, Generate pairing code).',
  sumup: 'On the Solo: Connections, API, Connect. Type the code it shows. Solos already paired are listed below.',
}

const STATUS = {
  pending: ['Waiting for the card', 'text-amber-700'],
  signature: ['Signature check', 'text-amber-700'],
  approved: ['Approved', 'text-green-700'],
  declined: ['Declined', 'text-red-700'],
  cancelled: ['Cancelled', 'text-muted-foreground'],
  failed: ['Failed', 'text-red-700'],
}

/** The venue's card machines (Till setup view). */
export function useCardReaders(venueId) {
  const api = useApi()
  return useQuery({
    queryKey: ['pos-card-readers', venueId],
    queryFn: () => api.get(`/pos/venues/${venueId}/card-readers`),
    enabled: !!venueId,
  })
}

/** The card machine picker in a till's or kiosk's settings. */
export function CardMachinePick({ venueId, value, onChange, kiosk = false }) {
  const { data: readers = [], isLoading } = useCardReaders(venueId)
  const missing = value && value !== 'none' && !readers.some(r => r.id === value) && !isLoading
  return (
    <Field label="Card machine" hint={kiosk
      ? 'The card machine guests pay on. None: guests pay at the counter only (if the design allows it). Card machines are added in the Card machines tab.'
      : 'Card machine payments are sent to this machine and recorded when it approves them. None: staff take cards on any machine and tap Card. Card machines are added in the Card machines tab.'}>
      <select className={inputCls} value={missing ? 'none' : (value || 'none')} onChange={e => onChange(e.target.value)} data-testid="device-card-machine">
        <option value="none">None</option>
        {readers.map(r => <option key={r.id} value={r.id}>{r.name} ({r.provider_label}{r.test ? ', test' : ''})</option>)}
      </select>
    </Field>
  )
}

function AccountModal({ account, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    provider: account?.provider || 'stripe', name: account?.name || '', secret: '',
    merchant_code: account?.settings?.merchant_code || '',
    software_house_id: account?.settings?.software_house_id || '', reseller_id: account?.settings?.reseller_id || '',
  })
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const refresh = () => qc.invalidateQueries({ queryKey: ['pos-card-accounts'] })
  const settings = () => {
    if (form.provider === 'sumup') return form.merchant_code.trim() ? { merchant_code: form.merchant_code.trim() } : {}
    if (form.provider === 'dojo') {
      const s = {}
      if (form.software_house_id.trim()) s.software_house_id = form.software_house_id.trim()
      if (form.reseller_id.trim()) s.reseller_id = form.reseller_id.trim()
      return s
    }
    return {}
  }
  const save = useMutation({
    mutationFn: () => account
      ? api.patch(`/pos/card-accounts/${account.id}`, {
        name: form.name.trim(),
        ...(form.secret.trim() ? { secret: form.secret.trim() } : {}),
        ...(form.provider !== 'stripe' ? { settings: settings() } : {}),
      })
      : api.post('/pos/card-accounts', { provider: form.provider, name: form.name.trim(), secret: form.secret.trim(), settings: settings() }),
    onSuccess: () => { refresh(); onClose() },
  })
  const check = useMutation({ mutationFn: () => api.post(`/pos/card-accounts/${account.id}/check`), onSuccess: refresh })
  const remove = useMutation({
    mutationFn: () => api.delete(`/pos/card-accounts/${account.id}`),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['pos-card-readers'] }); qc.invalidateQueries({ queryKey: ['pos-setup'] }); onClose() },
  })
  const ready = form.name.trim() && (account || form.secret.trim().length >= 8)
  return (
    <Modal title={account ? 'Edit ' + account.name : 'Add a card machine account'} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!ready || save.isPending} onClick={() => save.mutate()} data-testid="card-account-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {account ? 'Save' : 'Check the key and add'}
        </Btn>
        {account && <ConfirmDelete label="Remove account" confirmLabel="Yes, remove" onConfirm={() => remove.mutate()} disabled={remove.isPending} />}
      </>}>
      {!account && (
        <Field group label="Provider">
          <Segmented value={form.provider} options={PROVIDERS} onChange={v => set({ provider: v })} />
        </Field>
      )}
      <Field label="Name" hint="For Till setup only, e.g. Dojo, Stripe (Ware).">
        <input className={inputCls} value={form.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder="e.g. Dojo" data-testid="card-account-name" />
      </Field>
      <Field label={account ? 'Key' : 'Key'} hint={(account ? 'Saved, ends ' + (account.hint || '…') + '. Leave empty to keep it, or type a new one. ' : '') + KEY_HINT[form.provider]}>
        <input className={inputCls} type="password" autoComplete="off" value={form.secret} maxLength={400}
          onChange={e => set({ secret: e.target.value })} placeholder={account ? 'Keep the saved key' : 'Paste the key'} data-testid="card-account-secret" />
      </Field>
      {form.provider === 'sumup' && (
        <Field label="Merchant code" hint="Only if the key works for several SumUp merchant accounts: the code of the one to use (e.g. MCXXXXXX).">
          <input className={inputCls} value={form.merchant_code} maxLength={40} onChange={e => set({ merchant_code: e.target.value })} />
        </Field>
      )}
      {form.provider === 'dojo' && (
        <details className="text-sm">
          <summary className="cursor-pointer min-h-[44px] flex items-center text-muted-foreground">Software house and reseller ids</summary>
          <p className="text-xs text-muted-foreground mb-2">Dojo gives these to the till software. Leave them empty to use Macaroonie's; fill them only if Dojo gave you your own.</p>
          <div className="space-y-3">
            <Field label="Software house id"><input className={inputCls} value={form.software_house_id} maxLength={80} onChange={e => set({ software_house_id: e.target.value })} /></Field>
            <Field label="Reseller id"><input className={inputCls} value={form.reseller_id} maxLength={80} onChange={e => set({ reseller_id: e.target.value })} /></Field>
          </div>
        </details>
      )}
      <p className="text-xs text-muted-foreground">The key is checked with {PROVIDERS.find(p => p.value === form.provider)?.label} before it is saved, stored sealed, and never shown again.</p>
      {account && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{account.mode === 'test' ? 'Test mode: no real money' : account.mode === 'live' ? 'Live: real payments' : 'Mode not known'}{account.checked_at ? ' · checked ' + ago(account.checked_at) : ''}</span>
          <Btn onClick={() => check.mutate()} disabled={check.isPending}><RefreshCw className={cn('w-4 h-4', check.isPending && 'animate-spin')} /> Check again</Btn>
        </div>
      )}
      <ErrorNote error={save.error || check.error || remove.error} />
    </Modal>
  )
}

function AddReaderModal({ venueId, accounts, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [accountId, setAccountId] = useState(accounts[0]?.id || 'test')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [location, setLocation] = useState('')
  const account = accounts.find(a => a.id === accountId) || null
  const list = useQuery({
    queryKey: ['pos-card-account-readers', accountId],
    queryFn: () => api.get(`/pos/card-accounts/${accountId}/readers`),
    enabled: !!account,
    retry: false,
  })
  const done = () => {
    qc.invalidateQueries({ queryKey: ['pos-card-readers', venueId] })
    qc.invalidateQueries({ queryKey: ['pos-card-accounts'] })
    onClose()
  }
  const add = useMutation({
    mutationFn: body => api.post(`/pos/venues/${venueId}/card-readers`, body),
    onSuccess: done,
  })
  const canPair = account && account.provider !== 'dojo'
  const locations = account?.settings?.locations || []
  return (
    <Modal title="Add a card machine" onClose={onClose}>
      <Field label="Account" hint="Add the account with Dojo, Stripe or SumUp first (Accounts, below), or start with the test card machine.">
        <select className={inputCls} value={accountId} onChange={e => { setAccountId(e.target.value); setCode('') }} data-testid="card-reader-account">
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.provider_label}{a.mode === 'test' ? ', test' : ''})</option>)}
          <option value="test">Test card machine (no account, no money)</option>
        </select>
      </Field>
      <Field label="Name" hint="Shown on the till and in Till setup, e.g. Counter, Bar machine.">
        <input className={inputCls} value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="e.g. Counter" data-testid="card-reader-name" />
      </Field>
      {accountId === 'test' ? (
        <>
          <p className="text-sm text-muted-foreground">A pretend card machine for training and trying the till: the till shows Approve and Decline instead of waiting for a card. Its payments are recorded as Card machine with "Test card", so don't use it for real sales.</p>
          <Btn variant="primary" className="w-full" disabled={!name.trim() || add.isPending} onClick={() => add.mutate({ provider: 'test', name: name.trim() })} data-testid="card-reader-add-test">
            {add.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Add the test card machine
          </Btn>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{ADD_HINT[account?.provider]}</p>
          {canPair && (
            <div className="rounded-lg border p-3 space-y-3">
              <Field label="Code the machine shows">
                <input className={cn(inputCls, 'font-mono uppercase tracking-wider')} value={code} maxLength={40}
                  onChange={e => setCode(e.target.value)} placeholder={account.provider === 'stripe' ? 'e.g. apple-banana-cherry' : 'e.g. 4K8T2P'} data-testid="card-reader-code" />
              </Field>
              {account.provider === 'stripe' && (
                <Field label="Stripe location" hint="The Stripe location the reader belongs to (Stripe Dashboard, Terminal, Locations).">
                  <select className={inputCls} value={location} onChange={e => setLocation(e.target.value)}>
                    <option value="">Pick a location</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </Field>
              )}
              <Btn variant="primary" className="w-full" disabled={!name.trim() || code.trim().length < 3 || (account.provider === 'stripe' && !location) || add.isPending}
                onClick={() => add.mutate({ account_id: accountId, code: code.trim(), name: name.trim(), ...(location ? { location } : {}) })} data-testid="card-reader-pair">
                {add.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Add by code
              </Btn>
            </div>
          )}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">On the account</div>
            {list.isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            <ErrorNote error={list.error} />
            {list.data && !list.data.length && <p className="text-sm text-muted-foreground">No card machines on this account yet.</p>}
            {(list.data || []).map(r => (
              <div key={r.ref} className="flex items-center gap-3 rounded-lg border p-3" data-testid="card-account-reader">
                <CreditCard className="w-5 h-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[r.model, r.serial, r.online === true ? 'online' : r.online === false ? 'offline' : null].filter(Boolean).join(' · ')}
                    {r.added_at ? ' · added at ' + r.added_at.venue_name : ''}
                  </div>
                </div>
                <Btn disabled={!!r.added_at || add.isPending} onClick={() => add.mutate({ account_id: accountId, provider_reader_id: r.ref, name: name.trim() || r.name })}>
                  {r.added_at ? 'Added' : 'Add'}
                </Btn>
              </div>
            ))}
          </div>
        </>
      )}
      <ErrorNote error={add.error} />
    </Modal>
  )
}

function RenameReaderModal({ venueId, reader, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [name, setName] = useState(reader.name)
  const done = () => { qc.invalidateQueries({ queryKey: ['pos-card-readers', venueId] }); qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }); onClose() }
  const save = useMutation({ mutationFn: () => api.patch(`/pos/card-readers/${reader.id}`, { name: name.trim() }), onSuccess: done })
  const remove = useMutation({ mutationFn: () => api.delete(`/pos/card-readers/${reader.id}`), onSuccess: done })
  return (
    <Modal title={'Edit ' + reader.name} onClose={onClose}
      footer={<>
        <Btn variant="primary" className="flex-1" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()} data-testid="card-reader-save">Save</Btn>
        <ConfirmDelete label="Remove card machine" confirmLabel="Yes, remove" onConfirm={() => remove.mutate()} disabled={remove.isPending} />
      </>}>
      <Field label="Name"><input className={inputCls} value={name} maxLength={60} onChange={e => setName(e.target.value)} data-testid="card-reader-rename" /></Field>
      {reader.devices.length > 0 && (
        <p className="text-xs text-muted-foreground">Used by {reader.devices.map(d => d.name).join(', ')}. Removing it leaves {reader.devices.length === 1 ? 'that device' : 'those devices'} without a card machine; past payments stay in the list.</p>
      )}
      <ErrorNote error={save.error || remove.error} />
    </Modal>
  )
}

function PaymentsList({ venueId }) {
  const api = useApi()
  const [status, setStatus] = useState('all')
  const [days, setDays] = useState(7)
  const q = useQuery({
    queryKey: ['pos-card-payments', venueId, status, days],
    queryFn: () => api.get(`/pos/venues/${venueId}/card-payments?days=${days}&status=${status}`),
    enabled: !!venueId,
    refetchInterval: 30_000,
  })
  const rows = q.data || []
  const lost = rows.filter(r => r.not_on_check)
  return (
    <Section title="Card payments" hint="Every card machine payment and refund. Money taken that no check shows is flagged: record it on the till, or refund it on the card machine.">
      <div className="flex flex-wrap gap-2">
        <Segmented value={status} onChange={setStatus} options={[
          { value: 'all', label: 'All' }, { value: 'approved', label: 'Approved' }, { value: 'problems', label: 'Needs a look' },
        ]} />
        <select className={cn(inputCls, 'w-auto')} value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Days">
          <option value={1}>Today and yesterday</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>
      {lost.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm flex gap-2" data-testid="card-payments-lost">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <span>{lost.length === 1 ? 'One approved payment isn\'t on a check' : lost.length + ' approved payments aren\'t on a check'}: {money(lost.reduce((s, r) => s + r.amount + r.tip, 0))}. A till that lost its connection mid-payment offers to add it when the check is opened again.</span>
        </div>
      )}
      {q.isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      <ErrorNote error={q.error} />
      {!q.isLoading && !rows.length && <p className="text-sm text-muted-foreground">No card machine payments in this time.</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto -mx-4">
          <table className="w-full text-sm min-w-[620px]" data-testid="card-payments">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-2 py-2 font-medium">Machine</th>
                <th className="px-2 py-2 font-medium">From</th>
                <th className="px-2 py-2 font-medium text-right">Amount</th>
                <th className="px-2 py-2 font-medium">Card</th>
                <th className="px-4 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => {
                const [label, tone] = STATUS[r.status] || [r.status, '']
                return (
                  <tr key={r.id} className={cn(r.not_on_check && 'bg-amber-50')} data-testid="card-payment-row">
                    <td className="px-4 py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-2 py-2">{r.reader_name}</td>
                    <td className="px-2 py-2">{[r.device_name, r.staff_name].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                      {r.kind === 'refund' ? '−' : ''}{money(r.amount + r.tip)}
                      {r.tip > 0 && <div className="text-xs text-muted-foreground">incl. tip {money(r.tip)}</div>}
                      {r.refunded > 0 && <div className="text-xs text-muted-foreground">refunded {money(r.refunded)}</div>}
                    </td>
                    <td className="px-2 py-2">{r.card_text || '—'}</td>
                    <td className="px-4 py-2">
                      <span className={cn('font-medium', tone)}>{r.kind === 'refund' ? 'Refund: ' + label.toLowerCase() : label}</span>
                      {r.not_on_check && <div className="text-xs text-amber-700">Not on a check</div>}
                      {r.message && r.status !== 'approved' && <div className="text-xs text-muted-foreground">{r.message}</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

export default function CardMachinesSection({ venueId, canManage }) {
  const api = useApi()
  const { isOwnerOrAdmin } = usePermission('pos_setup')
  const keyHolder = canManage && isOwnerOrAdmin
  const readers = useCardReaders(venueId)
  const accounts = useQuery({ queryKey: ['pos-card-accounts'], queryFn: () => api.get('/pos/card-accounts') })
  const [editing, setEditing] = useState(null)        // { account } | { reader } | 'add-account' | 'add-reader'
  const accountList = accounts.data?.accounts || []
  return (
    <>
      <Section title="Card machines at this venue"
        hint="A till or kiosk sends card payments to its card machine and records them once the machine approves. Pick each till's and kiosk's machine in its settings (Tills, Kiosks)."
        actions={canManage && <Btn onClick={() => setEditing('add-reader')} data-testid="card-reader-add"><Plus className="w-4 h-4" /> Add a card machine</Btn>}>
        {readers.isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <ErrorNote error={readers.error} />
        {readers.data && !readers.data.length && (
          <p className="text-sm text-muted-foreground">No card machines here yet. Add an account with Dojo, Stripe or SumUp below, then add its machines; or start with the test card machine.</p>
        )}
        <div className="divide-y rounded-lg border">
          {(readers.data || []).map(r => (
            <div key={r.id} className="flex items-center gap-3 p-3" data-testid="card-reader-row">
              <CreditCard className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{r.name} {r.test && <span className="ml-1 text-[11px] font-semibold rounded bg-amber-100 text-amber-800 px-1.5 py-0.5">Test</span>}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {[r.provider_label, r.account_name, r.model, r.serial].filter(Boolean).join(' · ')}
                </div>
                <div className="text-xs text-muted-foreground">{r.devices.length ? 'Used by ' + r.devices.map(d => d.name).join(', ') : 'No till or kiosk uses it yet'}</div>
              </div>
              {canManage && <Btn title={'Edit ' + r.name} onClick={() => setEditing({ reader: r })}><Pencil className="w-4 h-4" /></Btn>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Accounts" hint="The company's accounts with card machine providers, used at every venue. Adding or changing one needs an owner or admin: it holds the provider's key."
        actions={keyHolder && <Btn onClick={() => setEditing('add-account')} data-testid="card-account-add"><KeyRound className="w-4 h-4" /> Add an account</Btn>}>
        {accounts.isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <ErrorNote error={accounts.error} />
        {accounts.data && !accountList.length && <p className="text-sm text-muted-foreground">No accounts yet.</p>}
        <div className="divide-y rounded-lg border empty:hidden">
          {accountList.map(a => (
            <div key={a.id} className="flex items-center gap-3 p-3" data-testid="card-account-row">
              <KeyRound className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{a.name} <span className="text-muted-foreground font-normal">· {a.provider_label}</span></div>
                <div className="text-xs text-muted-foreground truncate">
                  {[a.mode === 'test' ? 'Test mode' : a.mode === 'live' ? 'Live' : null, a.settings.merchant_name || a.settings.merchant_code, 'key ' + (a.hint || '…'),
                    a.readers === 1 ? '1 card machine' : a.readers + ' card machines'].filter(Boolean).join(' · ')}
                </div>
              </div>
              {keyHolder && <Btn title={'Edit ' + a.name} onClick={() => setEditing({ account: a })}><Pencil className="w-4 h-4" /></Btn>}
            </div>
          ))}
        </div>
      </Section>

      <PaymentsList venueId={venueId} />

      {editing === 'add-account' && <AccountModal onClose={() => setEditing(null)} />}
      {editing?.account && <AccountModal account={editing.account} onClose={() => setEditing(null)} />}
      {editing === 'add-reader' && <AddReaderModal venueId={venueId} accounts={accountList} onClose={() => setEditing(null)} />}
      {editing?.reader && <RenameReaderModal venueId={venueId} reader={editing.reader} onClose={() => setEditing(null)} />}
    </>
  )
}
