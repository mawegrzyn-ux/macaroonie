// src/pages/OrderingSettings.jsx
//
// Ordering setup (/orders/settings, web_ordering_setup module): per venue,
// turn online ordering on, choose the menus, the ordering hours and
// collection slots, payment methods, tips and the guest-facing notes.
// One Save for the whole form (PUT /api/orders/settings/:venueId).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings2, Plus, Trash2, ExternalLink, Loader2, ArrowLeft } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

function Section({ title, children, hint }) {
  return (
    <section className="rounded-lg border bg-background p-4 md:p-5 space-y-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 min-h-[44px] cursor-pointer touch-manipulation">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="w-5 h-5 mt-0.5" />
      <span className="text-sm"><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  )
}

function Num({ label, value, onChange, suffix, min = 0, max, allowEmpty, hint }) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-2 mt-1">
        <input type="number" inputMode="numeric" min={min} max={max} value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? (allowEmpty ? null : min) : Number(e.target.value))}
          className="w-28 border rounded-md px-3 min-h-[44px] bg-background" />
        {suffix && <span className="text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <span className="block text-xs text-muted-foreground mt-1">{hint}</span>}
    </label>
  )
}

export default function OrderingSettings() {
  const api = useApi()
  const qc = useQueryClient()
  const [venueId, setVenueId] = useState(() => { try { return localStorage.getItem('maca_orders_venue') || '' } catch { return '' } })
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  useEffect(() => {
    if (venues.length && !venues.some(v => v.id === venueId)) setVenueId(venues[0].id)
  }, [venues, venueId])

  const q = useQuery({
    queryKey: ['ordering-settings', venueId],
    queryFn: () => api.get(`/orders/settings/${venueId}`),
    enabled: !!venueId,
  })
  const { data: site } = useQuery({ queryKey: ['tenant-site'], queryFn: () => api.get('/website/tenant-site').catch(() => null) })

  const [f, setF] = useState(null)
  useEffect(() => { if (q.data) setF(structuredClone(q.data.settings)) }, [q.data])
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))

  const save = useMutation({
    mutationFn: body => api.put(`/orders/settings/${venueId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ordering-settings', venueId] })
      qc.invalidateQueries({ queryKey: ['orders', venueId] })
    },
  })

  const venue = venues.find(v => v.id === venueId)
  const dirty = f && q.data && JSON.stringify(f) !== JSON.stringify(q.data.settings)
  const siteHost = site?.custom_domain && site?.custom_domain_verified ? site.custom_domain
    : site?.subdomain_slug ? `${site.subdomain_slug}.macaroonie.com` : null
  const orderUrl = siteHost && venue ? `https://${siteHost}/${venues.length > 1 ? `locations/${venue.slug}/order` : 'order'}` : null

  const setDay = (day, windows) => set('hours', DAY_ORDER.map(d => {
    const cur = (f.hours || []).find(h => h.day === d) || { day: d, windows: [] }
    return d === day ? { day: d, windows } : cur
  }))
  const windowsOf = day => ((f?.hours || []).find(h => h.day === day)?.windows) || []

  const gateways = q.data?.gateways || []

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto max-lg:notouch:pl-14">
      <Link to="/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground min-h-[44px] touch-manipulation"><ArrowLeft className="w-4 h-4" /> Online orders</Link>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Settings2 className="w-6 h-6 text-primary" /> Ordering setup</h1>
        {venues.length > 1 && (
          <select value={venueId} onChange={e => setVenueId(e.target.value)} className="border rounded-md px-3 min-h-[44px] text-sm bg-background">
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
      </div>

      {(q.isLoading || !f) && <Loader2 className="w-5 h-5 animate-spin" />}
      {q.error && <p className="text-sm text-destructive">{q.error.message}</p>}

      {f && (
        <div className="space-y-4">
          <Section title="Online ordering">
            <Toggle label="Take online orders for collection" checked={f.is_enabled} onChange={v => set('is_enabled', v)}
              hint="Guests order on your website at /order. Nothing changes on the site until this is on." />
            {orderUrl && f.is_enabled && (
              <a href={orderUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
                {orderUrl} <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <Toggle label="Paused" checked={f.is_paused} onChange={v => set('is_paused', v)}
              hint="Guests can see the menu but can't order. Staff can also pause from the orders board." />
            {f.is_paused && (
              <input value={f.pause_message || ''} onChange={e => set('pause_message', e.target.value || null)} placeholder="Message for guests while paused"
                className="w-full border rounded-md px-3 min-h-[44px] text-sm bg-background" />
            )}
            <Toggle label="Accept orders automatically" checked={f.auto_accept} onChange={v => set('auto_accept', v)}
              hint="Off: every new order waits on the board until someone taps Accept." />
          </Section>

          <Section title="Menus" hint="The menus guests can order from. Dishes switched off for ordering (Menus page, dish settings) or without a price are left out.">
            {!q.data.menus.length && <p className="text-sm text-muted-foreground">No menus yet. Build one on the <Link to="/menus" className="underline">Menus</Link> page.</p>}
            {q.data.menus.map(m => {
              const on = f.menu_ids.includes(m.id)
              return (
                <Toggle key={m.id} label={m.name} hint={m.venue_id ? 'This venue only' : 'Shared menu'} checked={on}
                  onChange={v => set('menu_ids', v ? [...f.menu_ids, m.id] : f.menu_ids.filter(x => x !== m.id))} />
              )
            })}
          </Section>

          <Section title="Ordering hours" hint="When guests can collect. Filled from your opening hours the first time; each day can have several windows (e.g. lunch and dinner).">
            {DAY_ORDER.map(day => {
              const ws = windowsOf(day)
              return (
                <div key={day} className="flex flex-wrap items-start gap-3 py-2 border-b last:border-0">
                  <div className="w-28 text-sm font-medium pt-3">{DAYS[day]}</div>
                  <div className="flex-1 space-y-2">
                    {!ws.length && <p className="text-sm text-muted-foreground pt-3">Closed</p>}
                    {ws.map((w, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input type="time" value={w.open} onChange={e => setDay(day, ws.map((x, j) => j === i ? { ...x, open: e.target.value } : x))}
                          className="border rounded-md px-2 min-h-[44px] bg-background" />
                        <span>to</span>
                        <input type="time" value={w.close} onChange={e => setDay(day, ws.map((x, j) => j === i ? { ...x, close: e.target.value } : x))}
                          className="border rounded-md px-2 min-h-[44px] bg-background" />
                        <button onClick={() => setDay(day, ws.filter((_, j) => j !== i))} className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-accent touch-manipulation" aria-label="Remove">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setDay(day, [...ws, { open: '17:00', close: '21:30' }])}
                    className="inline-flex items-center gap-1 min-h-[44px] px-3 border rounded-md text-sm touch-manipulation">
                    <Plus className="w-4 h-4" /> Window
                  </button>
                </div>
              )
            })}
          </Section>

          <Section title="Collection times">
            <Toggle label="Offer 'as soon as possible'" checked={f.allow_asap} onChange={v => set('allow_asap', v)} />
            <div className="grid sm:grid-cols-2 gap-4">
              <Num label="Preparation time" suffix="minutes" value={f.lead_time_mins} max={240} onChange={v => set('lead_time_mins', v)}
                hint="The earliest a new order can be ready." />
              <label className="block text-sm">
                <span className="font-medium">Time slots every</span>
                <select value={f.slot_interval_mins} onChange={e => set('slot_interval_mins', Number(e.target.value))}
                  className="block mt-1 border rounded-md px-3 min-h-[44px] bg-background">
                  {[5, 10, 15, 20, 30, 60].map(n => <option key={n} value={n}>{n} minutes</option>)}
                </select>
              </label>
              <Num label="Orders per time slot" suffix="max" allowEmpty min={1} value={f.max_orders_per_slot} onChange={v => set('max_orders_per_slot', v)}
                hint="Leave empty for no limit. Full slots are greyed out for guests." />
              <Num label="Order ahead" suffix="days" max={14} value={f.max_days_ahead} onChange={v => set('max_days_ahead', v)}
                hint="0 = today only." />
            </div>
          </Section>

          <Section title="Money">
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block text-sm">
                <span className="font-medium">Minimum order</span>
                <div className="flex items-center gap-2 mt-1">
                  <span>£</span>
                  <input type="number" inputMode="decimal" min="0" step="0.5" value={(f.min_order_pence / 100).toString()}
                    onChange={e => set('min_order_pence', Math.max(0, Math.round(Number(e.target.value || 0) * 100)))}
                    className="w-28 border rounded-md px-3 min-h-[44px] bg-background" />
                </div>
              </label>
              <Num label="Default VAT rate" suffix="%" max={100} value={f.default_vat_rate} onChange={v => set('default_vat_rate', v)}
                hint="For dishes without their own takeaway VAT rate (Menus page)." />
            </div>
            <Toggle label="Ask guests for a tip" checked={f.tips_enabled} onChange={v => set('tips_enabled', v)} />
            {f.tips_enabled && (
              <label className="block text-sm">
                <span className="font-medium">Tip choices (%)</span>
                <input value={f.tip_percents.join(', ')} onChange={e => set('tip_percents', e.target.value.split(/[ ,]+/).map(Number).filter(n => n > 0 && n <= 50).slice(0, 5))}
                  className="block mt-1 w-48 border rounded-md px-3 min-h-[44px] bg-background" />
              </label>
            )}
          </Section>

          <Section title="Payment methods" hint="What guests can choose at checkout, in this order. Card payments through a payment provider appear here once one is connected.">
            {gateways.map(g => {
              const on = f.payment_methods.includes(g.key)
              return (
                <div key={g.key}>
                  <Toggle label={g.adminLabel} hint={g.description} checked={on}
                    onChange={v => set('payment_methods', v ? [...f.payment_methods, g.key] : f.payment_methods.filter(k => k !== g.key))} />
                  {g.key === 'demo' && on && (
                    <p className="ml-8 text-xs font-medium text-amber-700">Test payments take no money. Turn this off before taking real orders.</p>
                  )}
                </div>
              )
            })}
          </Section>

          <Section title="Messages for guests">
            <label className="block text-sm">
              <span className="font-medium">Collection instructions</span>
              <textarea value={f.collection_instructions || ''} onChange={e => set('collection_instructions', e.target.value || null)} rows={2}
                placeholder="e.g. Come to the takeaway window on Church Street."
                className="block mt-1 w-full border rounded-md px-3 py-2 bg-background" />
              <span className="text-xs text-muted-foreground">Shown on the ordering page and in the confirmation email.</span>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Confirmation email note</span>
              <textarea value={f.confirmation_note || ''} onChange={e => set('confirmation_note', e.target.value || null)} rows={2}
                className="block mt-1 w-full border rounded-md px-3 py-2 bg-background" />
            </label>
          </Section>

          <div className="sticky bottom-0 z-30 bg-background/95 border-t -mx-4 md:mx-0 p-3 flex items-center justify-end gap-3">
            {save.error && <span className="text-sm text-destructive">{save.error.message}</span>}
            {save.isSuccess && !dirty && <span className="text-sm text-emerald-700">Saved</span>}
            <button onClick={() => setF(structuredClone(q.data.settings))} disabled={!dirty}
              className="min-h-[48px] px-4 rounded-md border text-sm touch-manipulation disabled:opacity-40">Discard</button>
            <button onClick={() => save.mutate(f)} disabled={!dirty || save.isPending || (f.is_enabled && !f.payment_methods.length)}
              className={cn('min-h-[48px] px-6 rounded-md bg-primary text-primary-foreground text-sm font-semibold touch-manipulation disabled:opacity-40')}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
