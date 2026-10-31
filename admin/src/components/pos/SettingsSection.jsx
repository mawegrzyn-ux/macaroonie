// src/components/pos/SettingsSection.jsx
//
// Store tech > Receipts and payments, and Cash Recon. One explicit Save
// each. Settings are per venue (pos_settings); tills pick changes up
// straight away (pos.config over the socket, else on their next poll).

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TimeSelect } from '@/components/staff/shared'
import { Section, Field, inputCls, ErrorNote, Btn, Toggle, Segmented } from './shared'
import { RECEIPT_MODES, ORDER_PROMPTS } from './TillsSection'
import { MANAGER_ACTIONS } from '@shared/pos/permissions.js'
import { typeCharges } from '@shared/pos/charges.js'

const LOGOUTS = [
  { value: 0, label: 'Never' },
  { value: 30, label: '30 s' },
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
  { value: 300, label: '5 min' },
]

function useSave(venueId) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: body => api.patch(`/pos/venues/${venueId}/settings`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }),
  })
}

function fromSettings(s) {
  return {
    day_starts_at: String(s.day_starts_at || '04:00').slice(0, 5),
    vat_number: s.vat_number || '',
    receipt_name: s.receipt_name || '',
    receipt_address: (s.receipt_address || []).join('\n'),
    tenders: s.tenders.map(t => ({ ...t })),
    tips_enabled: !!s.tips_enabled,
    require_covers: !!s.require_covers,
    auto_logout_secs: s.auto_logout_secs,
    receipt_mode: s.receipt_mode || 'ask',
    order_prompt: s.order_prompt === 'two' ? 'two' : 'one',
    approvals: Object.fromEntries(MANAGER_ACTIONS.map(a => [a.key, !!s.approvals?.[a.key]])),
  }
}

export function ReceiptSettingsSection({ venueId, setup }) {
  const saved = useMemo(() => fromSettings(setup.settings), [setup.settings])
  const [form, setForm] = useState(saved)
  useEffect(() => setForm(saved), [saved])
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const save = useSave(venueId)
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  const noTender = !form.tenders.some(t => t.enabled)
  const logoutOptions = LOGOUTS.some(o => o.value === form.auto_logout_secs) ? LOGOUTS : [...LOGOUTS, { value: form.auto_logout_secs, label: form.auto_logout_secs + ' s' }]
  function submit() {
    save.mutate({
      day_starts_at: form.day_starts_at,
      vat_number: form.vat_number.trim() || null,
      receipt_name: form.receipt_name.trim() || null,
      receipt_address: form.receipt_address.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 6),
      tenders: form.tenders.map(t => ({ key: t.key, label: t.label.trim() || t.key, enabled: t.enabled })),
      tips_enabled: form.tips_enabled,
      require_covers: form.require_covers,
      auto_logout_secs: form.auto_logout_secs,
      receipt_mode: form.receipt_mode,
      order_prompt: form.order_prompt,
      approvals: form.approvals,
    })
  }
  return (
    <Section title="Receipts and payments" hint="Settings for this venue's tills.">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Trading day starts at" hint="Sales before this time count for the day before.">
          <TimeSelect value={form.day_starts_at} step={30} onChange={v => set({ day_starts_at: v })} label="Trading day starts at" />
        </Field>
        <Field label="Sign staff out after" hint="Of no taps. The till goes back to the PIN screen.">
          <Segmented value={form.auto_logout_secs} options={logoutOptions} onChange={v => set({ auto_logout_secs: v })} className="flex-wrap" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <Field label="VAT number" hint="Printed on receipts. Tax rates are set on Menus, Tax rates.">
          <input className={cn(inputCls, 'w-48')} value={form.vat_number} maxLength={40} onChange={e => set({ vat_number: e.target.value })} />
        </Field>
      </div>
      <Field label="Name on receipts" hint="Empty: the venue's name.">
        <input className={inputCls} value={form.receipt_name} maxLength={80} onChange={e => set({ receipt_name: e.target.value })} />
      </Field>
      <Field label="Address on receipts" hint="One line each, up to 6.">
        <textarea className={cn(inputCls, 'h-auto py-2')} rows={3} value={form.receipt_address} onChange={e => set({ receipt_address: e.target.value })} />
      </Field>
      <p className="text-xs text-muted-foreground">
        What receipts, bills and kitchen tickets say and how they look (headings, footers, the order number big) is on the{' '}
        <Link to="/pos/printing" className="font-medium text-foreground underline">Printing</Link> tab.
      </p>
      <p className="text-xs text-muted-foreground" data-testid="charges-note">
        Service charges and other charges (packaging, delivery) come with the order type: set them on{' '}
        <Link to="/pos/types" className="font-medium text-foreground underline">Order types</Link>, by name as printed.
        Discounts the till offers by name are on{' '}
        <Link to="/pos/discounts" className="font-medium text-foreground underline">Discounts</Link>.
      </p>
      <div>
        <p className="text-sm font-medium mb-1">Ways to pay</p>
        <p className="text-xs text-muted-foreground mb-2">Card payments are taken on your own card machine for now; the till records them. Card machine links come later.</p>
        <div className="rounded-xl border divide-y">
          {form.tenders.map((t, i) => (
            <div key={t.key} className="flex items-center gap-3 px-3 py-1">
              <input type="checkbox" className="w-5 h-5" checked={t.enabled} aria-label={'Use ' + t.label}
                onChange={e => set({ tenders: form.tenders.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x) })} />
              <input className={cn(inputCls, 'flex-1 border-transparent')} value={t.label} maxLength={30} aria-label={'Name for ' + t.key}
                onChange={e => set({ tenders: form.tenders.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
            </div>
          ))}
        </div>
        {noTender && <p className="text-xs text-destructive mt-1">Switch on at least one way to pay.</p>}
      </div>
      <Field group label="Receipt when a check is paid" hint="Ask: the till offers Close and print or Close, no receipt. A till can have its own (Tills).">
        <Segmented value={form.receipt_mode} options={RECEIPT_MODES} onChange={v => set({ receipt_mode: v })} className="flex-wrap" />
      </Field>
      <Field group label="Asking for the order type, name and tent number"
        hint="When a counter order or a tab starts, and when a check is missing a name or tent number, the till takes over the screen with its own keys: letters for the name, digits for the tent number. One screen: the order types and the details together. Two steps: the order type first, then what it asks for. A till can have its own (Tills).">
        <Segmented value={form.order_prompt} options={ORDER_PROMPTS} onChange={v => set({ order_prompt: v })} className="flex-wrap" />
      </Field>
      <div data-testid="manager-approvals">
        <p className="text-sm font-medium mb-1">Needs a manager every time</p>
        <p className="text-xs text-muted-foreground mb-2">
          Switched on, someone whose till role has Approve for others (and, for voids and refunds, that permission too)
          types their PIN, whatever the person's own role allows. Off: the person's role decides (Till roles).
        </p>
        <div className="rounded-xl border divide-y">
          {MANAGER_ACTIONS.map(a => (
            <div key={a.key} className="px-3 py-1">
              <Toggle label={a.label} hint={a.hint} checked={form.approvals[a.key]} onChange={v => set({ approvals: { ...form.approvals, [a.key]: v } })} />
            </div>
          ))}
        </div>
      </div>
      <Toggle label="Ask for a tip when paying" checked={form.tips_enabled} onChange={v => set({ tips_enabled: v })} />
      <Toggle label="Ask for covers when opening a table" checked={form.require_covers} onChange={v => set({ require_covers: v })} />
      <p className="text-xs text-muted-foreground" data-testid="order-numbers-note">
        Check and order numbers: every till and kiosk numbers its own (checks T1-1, T1-2, ... each trading day; counter
        orders from its own range, e.g. 100-199), so they never clash, even offline. Change a device's range under{' '}
        <Link to="/pos/tills" className="font-medium text-foreground underline">Tills</Link> or{' '}
        <Link to="/pos/kiosks" className="font-medium text-foreground underline">Kiosks</Link>.
      </p>
      <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
        <Btn variant="primary" disabled={!dirty || noTender || save.isPending} onClick={submit}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {dirty && <Btn onClick={() => setForm(saved)}>Discard</Btn>}
        <ErrorNote error={save.error} />
      </div>
    </Section>
  )
}

/** One Cash Recon field: chips for what goes into it. */
function TermChips({ options, value, onChange, label }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map(o => {
        const on = value.includes(o.value)
        return (
          <button key={o.value} type="button" aria-pressed={on}
            onClick={() => onChange(on ? value.filter(v => v !== o.value) : [...value, o.value])}
            className={cn('min-h-[44px] px-3 rounded-lg border text-sm touch-manipulation', on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function ReconSection({ venueId, setup }) {
  const saved = useMemo(() => ({
    map: {
      income: { ...(setup.settings.recon_map?.income || {}) },
      takings: { ...(setup.settings.recon_map?.takings || {}) },
      sc: { ...(setup.settings.recon_map?.sc || {}) },
    },
    auto: !!setup.settings.recon_auto_fill,
  }), [setup.settings])
  const [map, setMap] = useState(saved.map)
  const [auto, setAuto] = useState(saved.auto)
  useEffect(() => { setMap(saved.map); setAuto(saved.auto) }, [saved])
  const save = useSave(venueId)
  const clean = m => Object.fromEntries(Object.entries(m).filter(([, v]) => v?.length).map(([k, v]) => [k, [...v].sort()]).sort())
  const dirty = auto !== saved.auto || ['income', 'takings', 'sc'].some(g => JSON.stringify(clean(map[g])) !== JSON.stringify(clean(saved.map[g])))
  const setTerm = (group, id, terms) => setMap(m => ({ ...m, [group]: { ...m[group], [id]: terms } }))
  const f = setup.recon_fields
  const incomeOptions = [
    { value: 'all', label: 'All sales' },
    ...setup.revenue_streams.map(r => ({ value: r.id, label: r.name })),
    { value: '-refunds', label: 'minus refunds' },
  ]
  const tenderOptions = setup.settings.tenders.map(t => ({ value: t.key, label: t.label }))
  // Charges by name (Order types): one can go to a tip pot's source and
  // another (a packaging fee) nowhere. All charges = every one together.
  const chargeNames = [...new Set([
    ...(setup.order_types || []).flatMap(t => typeCharges(t).map(x => x.name)),
    ...Object.values(map.sc || {}).flat().filter(v => typeof v === 'string' && v.startsWith('charge:')).map(v => v.slice(7)),
  ])]
  const scOptions = [
    { value: 'service_charge', label: 'All charges' },
    ...chargeNames.map(n => ({ value: 'charge:' + n, label: n })),
    { value: 'tips', label: 'Tips' },
  ]
  const empty = !f.income.length && !f.takings.length && !f.sc.length
  return (
    <Section title="Cash Recon" hint="When the day is closed (Z), the till's figures can fill this venue's Cash Recon day. Pick what goes into each field; fields with nothing picked are left alone.">
      {empty && <p className="text-sm text-muted-foreground">This venue has no Cash Recon income sources, payment channels or service charge sources yet. Set them up in Cash Recon settings.</p>}
      {f.income.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-1">Income</h3>
          <p className="text-xs text-muted-foreground mb-2">Sales after discounts, without charges or tips.</p>
          <div className="divide-y">
            {f.income.map(src => (
              <div key={src.id} className="flex flex-col sm:flex-row sm:items-center gap-2 py-2">
                <p className="sm:w-44 shrink-0 text-sm font-medium">{src.name}</p>
                <TermChips options={incomeOptions} value={map.income[src.id] || []} onChange={v => setTerm('income', src.id, v)} label={'Into ' + src.name} />
              </div>
            ))}
          </div>
        </div>
      )}
      {f.takings.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-1">Takings</h3>
          <p className="text-xs text-muted-foreground mb-2">Money taken by each way to pay, tips included, refunds taken off.</p>
          <div className="divide-y">
            {f.takings.map(ch => (
              <div key={ch.id} className="flex flex-col sm:flex-row sm:items-center gap-2 py-2">
                <p className="sm:w-44 shrink-0 text-sm font-medium">{ch.name}</p>
                <TermChips options={tenderOptions} value={map.takings[ch.id] || []} onChange={v => setTerm('takings', ch.id, v)} label={'Into ' + ch.name} />
              </div>
            ))}
          </div>
        </div>
      )}
      {f.sc.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-1">Charges and tips</h3>
          <p className="text-xs text-muted-foreground mb-2">Charges come with the order type (Order types): pick them by name, or All charges together.</p>
          <div className="divide-y">
            {f.sc.map(src => (
              <div key={src.id} className="flex flex-col sm:flex-row sm:items-center gap-2 py-2">
                <p className="sm:w-44 shrink-0 text-sm font-medium">{src.name}</p>
                <TermChips options={scOptions} value={map.sc[src.id] || []} onChange={v => setTerm('sc', src.id, v)} label={'Into ' + src.name} />
              </div>
            ))}
          </div>
        </div>
      )}
      <Toggle label="Fill Cash Recon when the day is closed" hint="Off: fill it from Till reports when you're ready. A submitted Cash Recon day is never changed." checked={auto} onChange={setAuto} />
      <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
        <Btn variant="primary" disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ recon_map: { income: clean(map.income), takings: clean(map.takings), sc: clean(map.sc) }, recon_auto_fill: auto })}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </Btn>
        {dirty && <Btn onClick={() => { setMap(saved.map); setAuto(saved.auto) }}>Discard</Btn>}
        <ErrorNote error={save.error} />
      </div>
    </Section>
  )
}
