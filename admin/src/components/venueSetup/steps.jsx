// src/components/venueSetup/steps.jsx
//
// The venue setup wizard's steps (pages/NewLocation.jsx). Each step edits
// part of the opening's plan (routes/storeOpenings.js, shared/storeOpening.js)
// and saves it with Save and continue (PATCH: overrides for the venue's
// details and each area's way, settings for an area's whole settings).
// A step tells the page whether it has unsaved changes (useGuard), so moving
// to another step can offer to save them first.
//
//   VenueStep    name, web address, time zone, address, opening date, start
//                from scratch or like another venue; Pepper can fill it in
//   BrandStep    the group's brand (Brand & theme's own sections) and, for a
//                later venue, its web page's own look (a theme kit)
//   MenuStep     a menu read from photos or a PDF, or the group's menus
//   HoursStep    opening days and sittings
//   TablesStep   rooms and tables, booking rules
//   RestStep     every other area: copy, set up here or later; devices
//   CheckStep    what creating it will do, then Create

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Store, Palette, ChefHat, Clock, Table2, LayoutGrid, ClipboardCheck, Plus, Trash2, Copy, Check, X, Lock, Search,
  Sparkles, CircleCheck, CircleDashed, CircleSlash, Loader2, Settings, Globe, Mail, ShoppingBag, Bike, Percent,
  MonitorSmartphone, Tablet, Wallet, Thermometer, ListChecks, ShoppingCart, UsersRound, AlertTriangle, ChevronRight,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, openPicker } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { BrandIdentitySection, BrandThemeSection } from '@/pages/Website'
import { ThemeMakerButton, KitPreview, KitSwatches, useBrandKit } from '@/components/themes/ThemeMaker'
import { MenuImport } from '@/components/menus/MenuImport'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import { MODE_LABELS, DAY_NAMES } from '@shared/storeOpening.js'
import { Card, ErrorLine, ModePick, primary, outline, inp, TIMEZONES } from './ui'

const ICONS = { Clock, Table2, Settings, Globe, Mail, ShoppingBag, Bike, Percent, MonitorSmartphone, ChefHat, Tablet, Wallet, Thermometer, ListChecks, LayoutGrid, ShoppingCart, UsersRound }
const WEEK = [1, 2, 3, 4, 5, 6, 0]
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const areaOf = (o, key) => o.areas.find(a => a.key === key)

/** Tells the page about this step's unsaved changes and how to save them. */
function useGuard(guard, dirty, save) {
  useEffect(() => {
    if (guard) guard.current = { dirty, save }
  })
  useEffect(() => () => { if (guard) guard.current = null }, [guard])
}

/** A step's frame: its card and the Back / Save and continue bar. */
function StepFrame({ title, icon, intro, children, dirty, saving, error, onSave, onBack, readOnly, saveLabel = 'Save and continue', testid }) {
  return (
    <div className="space-y-4" data-testid={testid}>
      <Card title={title} icon={icon}>
        {intro && <p className="text-sm text-muted-foreground mb-4">{intro}</p>}
        {children}
      </Card>
      <ErrorLine error={error} />
      <div className="flex flex-wrap items-center justify-between gap-2 sticky bottom-0 bg-page py-2">
        {onBack ? <button type="button" className={outline} onClick={onBack} disabled={saving} data-testid="wz-back">Back</button> : <span />}
        {!readOnly && (
          <button type="button" className={primary} onClick={onSave} disabled={saving} data-testid="wz-next">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}{dirty ? saveLabel : saveLabel.replace('Save and continue', 'Continue')}
          </button>
        )}
        {readOnly && onSave && <button type="button" className={outline} onClick={onSave} data-testid="wz-next">Next</button>}
      </div>
    </div>
  )
}

function useStepSave(patch, onNext) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const run = async (body, next = true) => {
    setSaving(true)
    setError(null)
    try {
      if (body) await patch(body)
      if (next) onNext?.()
      return true
    } catch (e) {
      setError(e)
      return false
    } finally {
      setSaving(false)
    }
  }
  return { saving, error, run }
}

// ── 1. The venue ────────────────────────────────────────────────

const LOCATION_KEYS = ['address_line1', 'address_line2', 'city', 'postcode', 'country', 'phone', 'email']

export function VenueStep({ o, venues, readOnly, patch, guard, onNext, ai, onDescribe, describing }) {
  const p = o.plan
  const fresh = () => ({
    name: p.venue.name === 'New location' ? '' : p.venue.name, slug: p.venue.slug === 'new-location' ? '' : p.venue.slug,
    timezone: p.venue.timezone, currency: p.venue.currency,
    opening_date: p.opening_date || '', template_venue_id: p.template_venue_id || '',
    ...Object.fromEntries(LOCATION_KEYS.map(k => [k, p.location[k] || ''])),
  })
  const [f, setF] = useState(fresh)
  const [slugTouched, setSlugTouched] = useState(false)
  useEffect(() => { setF(fresh()) }, [o.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps
  const before = fresh()
  const dirty = Object.keys(f).some(k => f[k] !== before[k])
  const set = k => e => {
    const v = e.target.value
    setF(x => {
      const next = { ...x, [k]: v }
      // The web address follows the name until it is typed itself.
      if (k === 'name' && !slugTouched && (!x.slug || x.slug === slugOf(x.name))) next.slug = slugOf(v)
      return next
    })
    if (k === 'slug') setSlugTouched(true)
  }
  const { saving, error, run } = useStepSave(patch, onNext)
  const body = () => {
    const venue = {}, location = {}, overrides = {}
    if (f.name.trim() !== before.name) venue.name = f.name.trim()
    if (f.slug !== before.slug && f.slug) venue.slug = f.slug
    for (const k of ['timezone', 'currency']) if (f[k] !== before[k]) venue[k] = k === 'currency' ? f[k].toUpperCase() : f[k]
    for (const k of LOCATION_KEYS) if (f[k] !== before[k]) location[k] = f[k]
    if (Object.keys(venue).length) overrides.venue = venue
    if (Object.keys(location).length) overrides.location = location
    if (f.opening_date !== before.opening_date) overrides.opening_date = f.opening_date || null
    if (f.template_venue_id !== before.template_venue_id) {
      overrides.template_venue_id = f.template_venue_id || null
      // Starting like another venue copies what it can; from scratch sets up new.
      overrides.modes = Object.fromEntries(['booking_rules', 'website', 'ordering', 'till', 'cash'].map(k => [k, f.template_venue_id ? null : 'new']))
    }
    return Object.keys(overrides).length ? { overrides } : null
  }
  const save = () => run(body(), false)
  useGuard(guard, dirty, save)

  const field = (k, label, props = {}) => (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input value={f[k]} onChange={set(k)} disabled={readOnly} className={inp} data-testid={'wz-' + k} {...props} />
    </label>
  )
  const zones = TIMEZONES.includes(f.timezone) ? TIMEZONES : [f.timezone, ...TIMEZONES]
  const missingName = !f.name.trim()
  const [tried, setTried] = useState(false)
  return (
    <>
      {venues.length > 0 || ai?.can_chat ? (
        <DescribeCard o={o} ai={ai} readOnly={readOnly} onDescribe={onDescribe} busy={describing} />
      ) : null}
      <StepFrame title="The venue" icon={Store} testid="wz-step-venue" readOnly={readOnly}
        intro="Its name, where it is and how people reach it. The web address is the end of its page on your website."
        dirty={dirty} saving={saving} error={error || (missingName && tried ? { message: 'Give the venue a name.' } : null)}
        onSave={() => { setTried(true); if (!missingName) run(body()) }}>
        <div className="grid sm:grid-cols-2 gap-3">
          {field('name', 'Name', { placeholder: 'e.g. Wingvibes Leeds', autoFocus: !f.name })}
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Web address</span>
            <input value={f.slug} onChange={set('slug')} disabled={readOnly} className={inp} data-testid="wz-slug" placeholder="leeds" />
            {p.venue.slug_final && p.venue.slug_final !== p.venue.slug && <span className="text-xs text-muted-foreground">Already used: it will be <span className="font-mono">{p.venue.slug_final}</span></span>}
          </label>
          {venues.length > 0 && (
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Start from</span>
              <select value={f.template_venue_id} onChange={set('template_venue_id')} disabled={readOnly} className={inp} data-testid="wz-template">
                <option value="">Scratch: set it up here, step by step</option>
                {venues.map(v => <option key={v.id} value={v.id}>Like {v.name}: copy its setup, change what's different</option>)}
              </select>
            </label>
          )}
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Time zone</span>
            <select value={f.timezone} onChange={set('timezone')} disabled={readOnly} className={inp}>
              {zones.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {field('currency', 'Currency', { maxLength: 3 })}
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Opening date</span>
              <span className="relative flex items-center gap-2 min-h-[44px] px-3 rounded-lg border bg-background text-sm touch-manipulation">
                <span className="flex-1">{f.opening_date || 'Open now'}</span>
                {f.opening_date && !readOnly && <button type="button" onClick={() => setF(x => ({ ...x, opening_date: '' }))} className="relative z-10 p-1" aria-label="Clear the date"><X className="w-4 h-4" /></button>}
                <input type="date" value={f.opening_date} onClick={openPicker} onChange={set('opening_date')} disabled={readOnly} aria-label="Opening date"
                  className="absolute inset-0 opacity-0 cursor-pointer" />
              </span>
            </label>
          </div>
          {field('address_line1', 'Address')}
          {field('address_line2', 'Address line 2')}
          {field('city', 'Town or city')}
          {field('postcode', 'Postcode')}
          {field('country', 'Country')}
          {field('phone', 'Phone', { type: 'tel', inputMode: 'tel' })}
          <div className="sm:col-span-2">{field('email', 'Email', { type: 'email' })}</div>
        </div>
      </StepFrame>
    </>
  )
}

const slugOf = name => String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

/** Pepper's optional help: a description fills in the steps. */
function DescribeCard({ o, ai, readOnly, onDescribe, busy }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(o.input || '')
  if (!ai?.can_chat) return null
  return (
    <Card title={'Describe it to ' + ASSISTANT_NAME + ' (optional)'} icon={Sparkles}
      extra={<button type="button" className={cn(outline, 'min-h-[36px] px-3')} onClick={() => setOpen(v => !v)} aria-expanded={open} data-testid="wz-describe-open">{open ? 'Hide' : 'Open'}</button>}>
      {!open ? (
        <p className="text-sm text-muted-foreground">
          {o.input ? ASSISTANT_NAME + ' filled in the steps from your description. ' : ''}
          Tell {ASSISTANT_NAME} about the venue in a few sentences and it fills in the steps: what to copy, the hours, the tables,
          the devices. Anything you set yourself stays as you set it.
        </p>
      ) : (
        <div className="space-y-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} disabled={readOnly || busy} data-testid="wz-describe"
            placeholder="For example: a new store in Leeds city centre like our busiest one, about 80 seats, two tills and two kiosks, opening 1 December."
            className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y" />
          <button type="button" className={primary} disabled={readOnly || busy || text.trim().length < 10} onClick={() => onDescribe(text.trim())} data-testid="wz-describe-send">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}Fill in the steps
          </button>
        </div>
      )}
    </Card>
  )
}

// ── 2. Brand & theme ────────────────────────────────────────────

export function BrandStep({ o, venues, readOnly, patch, guard, onNext, onBack }) {
  const website = usePermission('website')
  const brandKit = useBrandKit()
  const api = useApi()
  const { data: site } = useQuery({ queryKey: ['tenant-site'], queryFn: () => api.get('/website/tenant-site'), staleTime: 60_000 })
  const first = venues.length === 0
  const [editing, setEditing] = useState(first)
  const initialKit = o.plan.brand?.kit || null
  const [own, setOwn] = useState(!!initialKit)
  const [kit, setKit] = useState(initialKit)
  const dirty = own !== !!initialKit || (own && !same(kit, initialKit))
  const { saving, error, run } = useStepSave(patch, onNext)
  const body = () => (dirty ? { settings: { brand: own && kit ? { kit } : null } } : null)
  useGuard(guard, dirty, () => run(body(), false))
  const websiteArea = areaOf(o, 'website')
  return (
    <StepFrame title="Brand & theme" icon={Palette} testid="wz-step-brand" readOnly={readOnly}
      intro={first
        ? 'This is your restaurant group\'s brand: the website uses it, and every designer (kiosks, menu screens, printed menus) offers it. Set it once here; every venue shares it.'
        : 'Every venue shares the group\'s brand. You can change it here (for every venue), or give this venue\'s web page a look of its own.'}
      dirty={dirty} saving={saving} error={error} onSave={() => (own && !kit ? null : run(body()))} onBack={onBack}>
      <div className="space-y-4">
        <div className="rounded-lg border p-3 flex flex-wrap items-center gap-3" data-testid="wz-brand-summary">
          {brandKit ? <KitSwatches kit={brandKit} /> : <span className="text-xs text-muted-foreground">No brand colours yet</span>}
          <span className="text-sm flex-1 min-w-[180px]">
            <span className="font-medium">{site?.brand_name || site?.site_name || 'Your brand'}</span>
            {site?.tagline ? <span className="text-muted-foreground"> · {site.tagline}</span> : null}
          </span>
          {website.canManage && (
            <button type="button" className={outline} onClick={() => setEditing(v => !v)} aria-expanded={editing} data-testid="wz-brand-edit">
              {editing ? 'Done' : first ? 'Set up the brand' : 'Change the group\'s brand'}
            </button>
          )}
        </div>
        {editing && website.canManage && (
          <div className="space-y-5 rounded-xl border bg-page/50 p-3" data-testid="wz-brand-editor">
            <p className="text-xs text-muted-foreground">These save on their own (each has its Save) and change the brand for every venue.</p>
            <BrandIdentitySection part="brand" />
            <BrandThemeSection />
          </div>
        )}
        {!website.canManage && <p className="text-xs text-muted-foreground flex gap-1.5"><Lock className="w-3.5 h-3.5 mt-0.5" />Changing the brand needs Website manage.</p>}
        {!first && (
          <div className="space-y-3">
            <p className="text-sm font-medium">This venue&apos;s web page</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="This venue's web page">
              {[[false, 'Uses the group\'s brand'], [true, 'Has its own look']].map(([v, label]) => (
                <button key={label} type="button" role="radio" aria-checked={own === v} disabled={readOnly} onClick={() => setOwn(v)}
                  data-testid={'wz-own-' + (v ? 'yes' : 'no')}
                  className={cn('min-h-[44px] px-4 rounded-lg border text-sm touch-manipulation', own === v ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
                  {label}
                </button>
              ))}
            </div>
            {own && (
              <div className="space-y-2">
                {!readOnly && <ThemeMakerButton target="website" current={site?.theme} onApply={k => setKit(k)} label={kit ? 'Make another look' : 'Make its look'} />}
                {kit ? (
                  <div className="max-w-sm">
                    <p className="text-xs text-muted-foreground mb-1">{kit.name}</p>
                    <KitPreview kit={kit} target="website" name={o.plan.venue.name} />
                  </div>
                ) : <p className="text-xs text-amber-800">Make its look from a picture or a few words.</p>}
                {websiteArea?.mode === 'skip' && <p className="text-xs text-amber-800">Its location page is left for later (last step), so this look waits until it is set up.</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </StepFrame>
  )
}

// ── 3. Menu ─────────────────────────────────────────────────────

export function MenuStep({ o, venues, readOnly, patch, guard, onNext, onBack }) {
  const api = useApi()
  const qc = useQueryClient()
  const menusPerm = usePermission('menus')
  const { data: menus = [] } = useQuery({ queryKey: ['menus'], queryFn: () => api.get('/menus') })
  const m0 = o.plan.menus || { ids: [], made: [], only_here: false }
  const [ids, setIds] = useState(m0.ids)
  const [made, setMade] = useState(m0.made)
  const [onlyHere, setOnlyHere] = useState(m0.only_here)
  const [importing, setImporting] = useState(false)
  const now = { ids, made, only_here: onlyHere && made.length > 0 }
  const dirty = !same(now, { ids: m0.ids, made: m0.made, only_here: m0.only_here })
  const { saving, error, run } = useStepSave(patch, onNext)
  const ordering = areaOf(o, 'ordering')
  const body = () => {
    if (!dirty) return null
    const out = { settings: { menus: now } }
    // Menus picked for online ordering: set it up unless the person chose otherwise.
    if (ids.length && ordering && !ordering.chosen && ordering.mode === 'skip') out.overrides = { modes: { ordering: o.plan.template_venue_id ? 'copy' : 'new' } }
    return out
  }
  useGuard(guard, dirty, () => run(body(), false))
  const toggle = id => setIds(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
  const usable = menus.filter(m => !m.venue_id)
  return (
    <StepFrame title="Menu" icon={ChefHat} testid="wz-step-menu" readOnly={readOnly}
      intro="Photos or a PDF of the menu become a menu you check and change. Or pick menus the group already has. Menus are shared by the till, kiosks, the website and online ordering."
      dirty={dirty} saving={saving} error={error} onSave={() => run(body())} onBack={onBack}>
      <div className="space-y-5">
        {menusPerm.canManage && !readOnly ? (
          importing ? (
            <div className="rounded-xl border p-3">
              <MenuImport venues={[]} hideVenue onCancel={() => setImporting(false)}
                onCreated={r => {
                  setIds(l => [...new Set([...l, r.menu_id])])
                  setMade(l => [...new Set([...l, r.menu_id])])
                  qc.invalidateQueries({ queryKey: ['menus'] })
                }} />
              <div className="mt-3 flex justify-end">
                <button type="button" className={outline} onClick={() => setImporting(false)} data-testid="wz-import-close">Done</button>
              </div>
            </div>
          ) : (
            <button type="button" className={cn(primary, 'w-full sm:w-auto')} onClick={() => setImporting(true)} data-testid="wz-import">
              <Sparkles className="w-4 h-4" />Read a menu from photos or a PDF
            </button>
          )
        ) : !menusPerm.canManage && <p className="text-xs text-muted-foreground flex gap-1.5"><Lock className="w-3.5 h-3.5 mt-0.5" />Making menus needs Menus manage.</p>}

        <div>
          <p className="text-sm font-medium mb-1">On this venue&apos;s online ordering</p>
          {usable.length === 0 ? (
            <p className="text-sm text-muted-foreground">No menus yet.</p>
          ) : (
            <ul className="divide-y border rounded-lg" data-testid="wz-menus">
              {usable.map(m => (
                <li key={m.id}>
                  <label className="flex items-center gap-3 px-3 min-h-[52px] touch-manipulation cursor-pointer">
                    <input type="checkbox" className="w-5 h-5" checked={ids.includes(m.id)} onChange={() => toggle(m.id)} disabled={readOnly} />
                    <span className="flex-1 min-w-0 text-sm font-medium truncate">{m.name}</span>
                    {made.includes(m.id) && <span className="text-[11px] rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-900">Made here</span>}
                    {!m.is_published && <span className="text-[11px] text-muted-foreground">Hidden from guests</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground mt-1">The till and kiosks show every published menu unless a revenue stream picks its own.</p>
        </div>
        {made.length > 0 && venues.length > 0 && (
          <label className="flex items-center gap-3 min-h-[44px] touch-manipulation">
            <input type="checkbox" className="w-5 h-5" checked={onlyHere} onChange={e => setOnlyHere(e.target.checked)} disabled={readOnly} data-testid="wz-only-here" />
            <span className="text-sm">Menus made here are for {o.plan.venue.name} only (not the group&apos;s other venues)</span>
          </label>
        )}
      </div>
    </StepFrame>
  )
}

// ── 4. Opening hours ────────────────────────────────────────────

const newSitting = () => ({ name: '', opens_at: '12:00', closes_at: '22:00', max_covers: 40 })

function fullWeek(hours) {
  const by = new Map((hours?.days || []).map(d => [d.day, d]))
  return {
    slot_interval_mins: hours?.slot_interval_mins || 15,
    days: WEEK.map(day => by.get(day) || { day, open: false, sittings: [] }),
  }
}

function HoursEditor({ value, onChange, readOnly }) {
  const setDay = (day, patch) => onChange({ ...value, days: value.days.map(d => (d.day === day ? { ...d, ...patch } : d)) })
  const setSitting = (day, i, patch) => setDay(day, { sittings: value.days.find(d => d.day === day).sittings.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const copyToAll = day => {
    const from = value.days.find(d => d.day === day)
    onChange({ ...value, days: value.days.map(d => ({ ...d, open: from.open, sittings: from.sittings.map(s => ({ ...s })) })) })
  }
  return (
    <div className="space-y-3" data-testid="wz-hours">
      <label className="flex items-center gap-2 text-sm">
        <span>A booking can start every</span>
        <select value={value.slot_interval_mins} onChange={e => onChange({ ...value, slot_interval_mins: Number(e.target.value) })} disabled={readOnly}
          className="min-h-[44px] border rounded-lg px-2 bg-background">
          {[15, 30, 60].map(n => <option key={n} value={n}>{n} minutes</option>)}
        </select>
      </label>
      {value.days.map(d => (
        <div key={d.day} className={cn('rounded-lg border p-3', !d.open && 'bg-muted/30')} data-testid="wz-day" data-day={d.day}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm w-24">{DAY_NAMES[d.day]}</span>
            <button type="button" role="switch" aria-checked={d.open} disabled={readOnly} data-testid="wz-day-open"
              onClick={() => setDay(d.day, d.open ? { open: false } : { open: true, sittings: d.sittings.length ? d.sittings : [newSitting()] })}
              className={cn('min-h-[40px] px-3 rounded-lg border text-sm touch-manipulation', d.open ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
              {d.open ? 'Open' : 'Closed'}
            </button>
            {!readOnly && (
              <button type="button" onClick={() => copyToAll(d.day)} className="ml-auto text-xs text-primary inline-flex items-center gap-1 min-h-[40px] px-2 touch-manipulation" data-testid="wz-day-copy">
                <Copy className="w-3.5 h-3.5" />Same every day
              </button>
            )}
          </div>
          {d.open && (
            <div className="mt-2 space-y-2">
              {d.sittings.map((s, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <label className="block flex-1 min-w-[110px]">
                    <span className="text-[11px] text-muted-foreground">Name</span>
                    <input value={s.name || ''} onChange={e => setSitting(d.day, i, { name: e.target.value })} disabled={readOnly} placeholder={i ? 'Dinner' : 'Lunch'} className={inp} />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-muted-foreground">Opens</span>
                    <input type="time" value={s.opens_at} onChange={e => setSitting(d.day, i, { opens_at: e.target.value })} disabled={readOnly} className={cn(inp, 'w-32')} />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-muted-foreground">Last booking</span>
                    <input type="time" value={s.closes_at} onChange={e => setSitting(d.day, i, { closes_at: e.target.value })} disabled={readOnly} className={cn(inp, 'w-32')} />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-muted-foreground">Covers</span>
                    <input type="text" inputMode="numeric" value={s.max_covers ?? ''} disabled={readOnly}
                      onChange={e => setSitting(d.day, i, { max_covers: e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')) })} className={cn(inp, 'w-24')} />
                  </label>
                  {!readOnly && d.sittings.length > 1 && (
                    <button type="button" onClick={() => setDay(d.day, { sittings: d.sittings.filter((_, j) => j !== i) })} aria-label="Remove this sitting"
                      className="w-11 h-11 rounded-lg border flex items-center justify-center text-destructive touch-manipulation"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
              {!readOnly && d.sittings.length < 6 && (
                <button type="button" onClick={() => setDay(d.day, { sittings: [...d.sittings, { ...newSitting(), opens_at: '17:00' }] })}
                  className="text-xs text-primary inline-flex items-center gap-1 min-h-[40px] touch-manipulation"><Plus className="w-3.5 h-3.5" />Add a sitting</button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function HoursStep({ o, readOnly, patch, guard, onNext, onBack }) {
  const area = areaOf(o, 'hours')
  const template = o.template
  const initial = useMemo(() => fullWeek(o.plan.hours), [o.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps
  const [hours, setHours] = useState(initial)
  const [mode, setMode] = useState(area?.mode === 'skip' && !area?.chosen && !template ? 'new' : area?.mode || 'new')
  const dirty = mode !== area?.mode || (mode === 'new' && !same(hours, initial))
  const { saving, error, run } = useStepSave(patch, onNext)
  const noneOpen = mode === 'new' && !hours.days.some(d => d.open && d.sittings.length)
  const body = () => (dirty ? { overrides: { modes: { hours: mode } }, ...(mode === 'new' ? { settings: { hours } } : {}) } : null)
  useGuard(guard, dirty, () => run(body(), false))
  return (
    <StepFrame title="Opening hours" icon={Clock} testid="wz-step-hours" readOnly={readOnly}
      intro="The days it opens and its sittings (lunch, dinner): when bookings can start and how many covers each takes. Health & safety checks and the rota follow the open days."
      dirty={dirty} saving={saving} error={error || (noneOpen ? { message: 'Open at least one day, or pick Later.' } : null)}
      onSave={() => (noneOpen ? null : run(body()))} onBack={onBack}>
      <div className="space-y-4">
        <ModePick area={area} template={template} value={mode} onChange={setMode} disabled={readOnly} />
        {mode === 'new' && <HoursEditor value={hours} onChange={setHours} readOnly={readOnly} />}
        {mode === 'copy' && <p className="text-sm text-muted-foreground">{template?.name}&apos;s days and sittings are copied, with any dated changes still to come.</p>}
        {mode === 'skip' && <p className="text-sm text-muted-foreground">Set them on the Schedule page later. Until then nobody can book.</p>}
      </div>
    </StepFrame>
  )
}

// ── 5. Tables and booking rules ─────────────────────────────────

function TablesEditor({ value, onChange, readOnly }) {
  const [count, setCount] = useState('6')
  const [seats, setSeats] = useState('4')
  const sections = value.sections.length ? value.sections : [{ name: 'Main room', tables: [] }]
  const setSection = (i, patch) => onChange({ sections: sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const labels = new Set(sections.flatMap(s => s.tables.map(t => t.label.toLowerCase())))
  const nextLabel = () => { let n = 1; while (labels.has(String(n)) || labels.has('t' + n)) n++; return String(n) }
  const addMany = i => {
    const n = Math.min(60, Math.max(1, Number(count) || 0)), max = Math.min(40, Math.max(1, Number(seats) || 0))
    const add = []
    for (let k = 0; k < n; k++) {
      const label = nextLabel()
      labels.add(label)
      add.push({ label, min_covers: Math.min(max, 1), max_covers: max })
    }
    setSection(i, { tables: [...sections[i].tables, ...add] })
  }
  const total = sections.flatMap(s => s.tables)
  return (
    <div className="space-y-3" data-testid="wz-tables">
      <p className="text-sm">{total.length} tables, {total.reduce((n, t) => n + (t.max_covers || 0), 0)} seats</p>
      {sections.map((s, i) => (
        <div key={i} className="rounded-lg border p-3 space-y-2" data-testid="wz-room">
          <div className="flex items-center gap-2">
            <input value={s.name} onChange={e => setSection(i, { name: e.target.value })} disabled={readOnly} className={cn(inp, 'flex-1')} aria-label="Room name" />
            {!readOnly && sections.length > 1 && (
              <button type="button" onClick={() => onChange({ sections: sections.filter((_, j) => j !== i) })} aria-label={'Remove ' + s.name}
                className="w-11 h-11 rounded-lg border flex items-center justify-center text-destructive touch-manipulation"><Trash2 className="w-4 h-4" /></button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {s.tables.map((t, k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-lg border bg-background pl-2 text-sm" data-testid="wz-table">
                <input value={t.label} onChange={e => setSection(i, { tables: s.tables.map((x, j) => (j === k ? { ...x, label: e.target.value.slice(0, 20) } : x)) })}
                  disabled={readOnly} aria-label="Table name" className="w-12 min-h-[40px] bg-transparent font-medium focus:outline-none" />
                <input type="text" inputMode="numeric" value={t.max_covers} disabled={readOnly} aria-label={'Seats at ' + t.label}
                  onChange={e => setSection(i, { tables: s.tables.map((x, j) => (j === k ? { ...x, max_covers: Number(e.target.value.replace(/\D/g, '')) || 0 } : x)) })}
                  className="w-9 min-h-[40px] bg-transparent text-right focus:outline-none" />
                <span className="text-xs text-muted-foreground">seats</span>
                {!readOnly && (
                  <button type="button" onClick={() => setSection(i, { tables: s.tables.filter((_, j) => j !== k) })} aria-label={'Remove table ' + t.label}
                    className="w-9 h-10 flex items-center justify-center text-muted-foreground touch-manipulation"><X className="w-3.5 h-3.5" /></button>
                )}
              </span>
            ))}
          </div>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Add</span>
              <input type="text" inputMode="numeric" value={count} onChange={e => setCount(e.target.value.replace(/\D/g, '').slice(0, 2))} className={cn(inp, 'w-16')} aria-label="How many tables" />
              <span>tables for</span>
              <input type="text" inputMode="numeric" value={seats} onChange={e => setSeats(e.target.value.replace(/\D/g, '').slice(0, 2))} className={cn(inp, 'w-16')} aria-label="Seats each" />
              <button type="button" className={outline} onClick={() => addMany(i)} data-testid="wz-add-tables"><Plus className="w-4 h-4" />Add</button>
            </div>
          )}
        </div>
      ))}
      {!readOnly && sections.length < 12 && (
        <button type="button" className={outline} onClick={() => onChange({ sections: [...sections, { name: 'Room ' + (sections.length + 1), tables: [] }] })}>
          <Plus className="w-4 h-4" />Add a room
        </button>
      )}
    </div>
  )
}

const RULE_FIELDS = [
  ['slot_duration_mins', 'A booking lasts (minutes)'],
  ['min_covers', 'Smallest party'],
  ['max_covers', 'Largest party'],
  ['book_until_days', 'Book up to (days ahead)'],
  ['cutoff_before_mins', 'Stop online bookings (minutes before)'],
]

export function TablesStep({ o, readOnly, patch, guard, onNext, onBack }) {
  const tablesArea = areaOf(o, 'tables')
  const rulesArea = areaOf(o, 'booking_rules')
  const template = o.template
  const initTables = useMemo(() => o.plan.tables, [o.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps
  const initRules = useMemo(() => o.plan.booking_rules, [o.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps
  const [tables, setTables] = useState(initTables)
  const [rules, setRules] = useState(initRules)
  const [tMode, setTMode] = useState(tablesArea?.mode === 'skip' && !tablesArea?.chosen && !template ? 'new' : tablesArea?.mode || 'new')
  const [rMode, setRMode] = useState(rulesArea?.mode || 'new')
  const tablesOut = { sections: (tables.sections || []).map(s => ({ ...s, tables: s.tables.filter(t => t.label && t.max_covers) })).filter(s => s.tables.length) }
  const dirty = tMode !== tablesArea?.mode || rMode !== rulesArea?.mode
    || (tMode === 'new' && !same(tablesOut, initTables)) || (rMode === 'new' && !same(rules, initRules))
  const { saving, error, run } = useStepSave(patch, onNext)
  const noTables = tMode === 'new' && !tablesOut.sections.length
  const body = () => (dirty ? {
    overrides: { modes: { tables: tMode, booking_rules: rMode } },
    settings: { ...(tMode === 'new' ? { tables: tablesOut } : {}), ...(rMode === 'new' ? { booking_rules: rules } : {}) },
  } : null)
  useGuard(guard, dirty, () => run(body(), false))
  return (
    <StepFrame title="Tables and bookings" icon={Table2} testid="wz-step-tables" readOnly={readOnly}
      intro="The rooms and tables bookings go on, and how bookings work. A counter-only venue can leave tables for later."
      dirty={dirty} saving={saving} error={error || (noTables ? { message: 'Add a table, or pick Later.' } : null)}
      onSave={() => (noTables ? null : run(body()))} onBack={onBack}>
      <div className="space-y-5">
        <div className="space-y-3">
          <p className="text-sm font-medium">Tables</p>
          <ModePick area={tablesArea} template={template} value={tMode} onChange={setTMode} disabled={readOnly} />
          {tMode === 'new' && <TablesEditor value={tables} onChange={setTables} readOnly={readOnly} />}
          {tMode === 'copy' && <p className="text-sm text-muted-foreground">{template?.name}&apos;s rooms, tables and combinations are copied.</p>}
        </div>
        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">Booking rules</p>
          <ModePick area={rulesArea} template={template} value={rMode} onChange={setRMode} disabled={readOnly} />
          {rMode === 'new' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="wz-rules">
              {RULE_FIELDS.map(([k, label]) => (
                <label key={k} className="block">
                  <span className="text-xs font-medium text-muted-foreground">{label}</span>
                  <input type="text" inputMode="numeric" value={rules[k] ?? ''} disabled={readOnly}
                    onChange={e => setRules(r => ({ ...r, [k]: Number(e.target.value.replace(/\D/g, '')) || 0 }))} className={inp} />
                </label>
              ))}
            </div>
          )}
          {rMode === 'copy' && <p className="text-sm text-muted-foreground">{template?.name}&apos;s booking and deposit rules are copied.</p>}
        </div>
      </div>
    </StepFrame>
  )
}

// ── 6. Everything else ──────────────────────────────────────────

const RESULT_ICON = { done: CircleCheck, skipped: CircleDashed, no_access: CircleSlash }
const EARLIER = new Set(['hours', 'tables', 'booking_rules'])

export function AreaCard({ area, hasTemplate, onMode, onDeepDive, readOnly, created }) {
  const Icon = ICONS[area.icon] || Store
  const r = area.result
  const RIcon = r ? RESULT_ICON[r.status] || CircleDashed : null
  return (
    <div className={cn('rounded-xl border bg-background p-3 flex flex-col gap-2', area.mode === 'skip' && !created && 'bg-muted/30')} data-testid="nl-area" data-area={area.key} data-mode={area.mode}>
      <div className="flex items-start gap-2">
        <Icon className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
        <h3 className="font-medium text-sm flex-1 min-w-0">{area.label}</h3>
        {area.deep_dive && !created && <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-amber-100 text-amber-900">Worth a closer look</span>}
        {RIcon && <RIcon className={cn('w-4 h-4 shrink-0', r.status === 'done' ? 'text-emerald-600' : 'text-muted-foreground')} aria-label={r.status} />}
      </div>
      {!created && (
        <div className="flex rounded-lg border overflow-hidden" role="radiogroup" aria-label={area.label + ': how to set it up'}>
          {area.modes.map(m => {
            const on = area.mode === m
            const off = readOnly || !area.can_set_up || (m === 'copy' && !hasTemplate)
            return (
              <button key={m} type="button" role="radio" aria-checked={on} disabled={off || on} onClick={() => onMode(area.key, m)}
                data-testid="nl-mode" data-value={m}
                className={cn('flex-1 min-h-[44px] text-xs font-medium touch-manipulation border-l first:border-l-0', on ? 'bg-primary text-primary-foreground' : 'bg-background', off && !on && 'text-muted-foreground/60')}>
                {m === 'skip' ? 'Later' : m === 'new' ? 'New' : MODE_LABELS[m]}
              </button>
            )
          })}
        </div>
      )}
      <p className="text-sm">{created && r ? (r.lines?.length ? r.lines.join('. ') + '.' : r.status === 'skipped' ? 'Left for later.' : '') : area.preview}</p>
      {!created && area.note && <p className="text-xs text-muted-foreground flex gap-1.5"><Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />{area.note}</p>}
      {!created && !area.can_set_up && <p className="text-xs text-muted-foreground flex gap-1.5"><Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />Your role can&apos;t set this up: it&apos;s left for someone who can.</p>}
      {!created && !readOnly && onDeepDive && area.can_set_up && area.mode !== 'skip' && (
        <button type="button" onClick={() => onDeepDive(area.key)} className="self-start text-xs text-primary inline-flex items-center gap-1 min-h-[32px] touch-manipulation" data-testid="nl-deep-dive">
          <Search className="w-3.5 h-3.5" />Ask {ASSISTANT_NAME} about this
        </button>
      )}
    </div>
  )
}

export function AreaGrid({ o, areas, onMode, onDeepDive, readOnly, created }) {
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="nl-areas">
      {areas.map(a => (
        <AreaCard key={a.key} area={a} hasTemplate={!!o.plan.template_venue_id} onMode={onMode} onDeepDive={onDeepDive} readOnly={readOnly} created={created} />
      ))}
    </div>
  )
}

const DEVICE_FIELDS = [['tills', 'Tills'], ['kitchen_screens', 'Kitchen screens'], ['kiosks', 'Kiosks'], ['menu_screens', 'Menu screens']]

export function RestStep({ o, readOnly, patch, guard, onNext, onBack, onDeepDive }) {
  const initDevices = useMemo(() => o.plan.devices, [o.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps
  const [devices, setDevices] = useState(initDevices)
  const [orderingOn, setOrderingOn] = useState(!!o.plan.ordering.enabled)
  const [busy, setBusy] = useState(false)
  const devicesArea = areaOf(o, 'devices')
  const ordering = areaOf(o, 'ordering')
  const devicesNew = devicesArea?.mode === 'new' || (devicesArea?.mode === 'skip' && !o.plan.template_venue_id)
  const dirty = (devicesNew && !same(devices, initDevices)) || orderingOn !== !!o.plan.ordering.enabled
  const { saving, error, run } = useStepSave(patch, onNext)
  const body = () => {
    if (!dirty) return null
    const out = { settings: { ordering: { enabled: orderingOn } } }
    if (devicesNew && !same(devices, initDevices)) {
      out.settings.devices = devices
      const any = Object.values(devices).some(n => n > 0)
      out.overrides = { modes: { devices: any ? 'new' : 'skip' } }
    }
    return out
  }
  useGuard(guard, dirty, () => run(body(), false))
  const setMode = async (key, mode) => {
    setBusy(true)
    try { await patch({ overrides: { modes: { [key]: mode } } }) } catch { /* the card stays as it was */ } finally { setBusy(false) }
  }
  const rest = o.areas.filter(a => !EARLIER.has(a.key))
  return (
    <StepFrame title="Everything else" icon={LayoutGrid} testid="wz-step-rest" readOnly={readOnly}
      intro={o.template
        ? 'Each area is copied from ' + o.template.name + ' unless you pick otherwise. "Later" leaves it for its own page.'
        : 'Pick how each area starts: set up here with sensible defaults, or later on its own page.'}
      dirty={dirty} saving={saving || busy} error={error} onSave={() => run(body())} onBack={onBack}>
      <div className="space-y-5">
        {devicesNew && (
          <div className="rounded-lg border p-3 space-y-2" data-testid="wz-devices">
            <p className="text-sm font-medium">Devices to get ready</p>
            <p className="text-xs text-muted-foreground">Each one is linked on the day: it shows a code, someone links it from Till setup or the installer app.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {DEVICE_FIELDS.map(([k, label]) => (
                <label key={k} className="block">
                  <span className="text-xs font-medium text-muted-foreground">{label}</span>
                  <input type="text" inputMode="numeric" value={devices[k] ?? 0} disabled={readOnly}
                    onChange={e => setDevices(d => ({ ...d, [k]: Math.min(40, Number(e.target.value.replace(/\D/g, '')) || 0) }))} className={inp} data-testid={'wz-dev-' + k} />
                </label>
              ))}
            </div>
          </div>
        )}
        {ordering && ordering.mode !== 'skip' && (
          <label className="flex items-center gap-3 min-h-[44px] touch-manipulation">
            <input type="checkbox" className="w-5 h-5" checked={orderingOn} disabled={readOnly || !!o.plan.opening_date} onChange={e => setOrderingOn(e.target.checked)} data-testid="wz-ordering-on" />
            <span className="text-sm">Switch online ordering on straight away{o.plan.opening_date ? ' (it stays off until the opening day)' : ''}</span>
          </label>
        )}
        <AreaGrid o={o} areas={rest} onMode={setMode} onDeepDive={['questions', 'ready'].includes(o.status) ? onDeepDive : null} readOnly={readOnly || busy} />
      </div>
    </StepFrame>
  )
}

// ── 7. Check and create ─────────────────────────────────────────

export function CheckStep({ o, readOnly, onBack, onCreate, creating, error, onGo }) {
  const [confirm, setConfirm] = useState(false)
  const b = o.brief
  const setUp = o.areas.filter(a => a.mode !== 'skip' && a.can_set_up)
  const later = o.areas.filter(a => a.mode === 'skip')
  return (
    <div className="space-y-4" data-testid="wz-step-check">
      <Card title={'Check: ' + o.plan.venue.name} icon={ClipboardCheck}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {[o.plan.location.address_line1, o.plan.location.city, o.plan.location.postcode].filter(Boolean).join(', ') || 'No address yet'}
            {' · '}{o.plan.opening_date ? 'Opens ' + o.plan.opening_date : 'Open now'}
            {o.template ? ' · Like ' + o.template.name : ' · From scratch'}
          </p>
          {b?.summary && <p className="text-sm flex gap-1.5"><Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-primary" />{b.summary}</p>}
          <ul className="divide-y border rounded-lg" data-testid="wz-check-list">
            {setUp.map(a => (
              <li key={a.key} className="px-3 py-2 text-sm flex gap-2">
                <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                <span><span className="font-medium">{a.label}:</span> {a.preview}</span>
              </li>
            ))}
          </ul>
          {later.length > 0 && (
            <p className="text-xs text-muted-foreground">Left for later: {later.map(a => a.label).join(', ')}.</p>
          )}
          {o.areas.some(a => a.mode !== 'skip' && !a.can_set_up) && (
            <p className="text-xs text-muted-foreground flex gap-1.5"><Lock className="w-3.5 h-3.5 mt-0.5" />Some areas need someone with access: they go on the to-do list.</p>
          )}
          {o.problems?.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-sm space-y-1" data-testid="wz-problems">
              {o.problems.map((p, i) => <p key={i} className="flex gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{p}</p>)}
              <button type="button" className="text-xs underline" onClick={() => onGo('venue')}>Fix it on The venue</button>
            </div>
          )}
        </div>
      </Card>
      <ErrorLine error={error} />
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={outline} onClick={onBack} disabled={creating}>Back</button>
          {!confirm ? (
            <button type="button" className={primary} disabled={!o.can.create || creating} onClick={() => setConfirm(true)} data-testid="nl-create">
              <Store className="w-4 h-4" />Create {o.plan.venue.name}
            </button>
          ) : (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 w-full sm:w-auto" data-testid="nl-create-confirm">
              <p className="text-sm">
                Create <span className="font-semibold">{o.plan.venue.name}</span> and set up {setUp.length} {setUp.length === 1 ? 'area' : 'areas'}?
                {o.plan.opening_date ? ' It stays closed for bookings until ' + o.plan.opening_date + '.' : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primary} disabled={creating} onClick={onCreate} data-testid="nl-create-yes">
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Yes, create it
                </button>
                <button type="button" className={outline} disabled={creating} onClick={() => setConfirm(false)}>Not yet</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function CreatedCard({ opening, onTick, readOnly }) {
  const left = opening.followups.filter(f => !f.done).length
  return (
    <Card title="Still to do" icon={ListChecks} extra={<span className="text-xs text-muted-foreground">{left} of {opening.followups.length} left</span>}>
      <div className="space-y-3" data-testid="nl-followups">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 text-sm flex items-start gap-2">
          <CircleCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <span className="font-semibold">{opening.venue?.name}</span> was created
            {opening.opened_at ? ' on ' + new Date(opening.opened_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : ''}.
            {' '}It&apos;s now in every venue picker. <Link to="/venues" className="underline">Venues</Link>
          </span>
        </div>
        <ul className="space-y-2">
          {opening.followups.map(f => (
            <li key={f.key} className="flex items-start gap-3 rounded-lg border px-3 py-2" data-testid="nl-followup" data-done={f.done ? '1' : '0'}>
              <button type="button" role="checkbox" aria-checked={!!f.done} disabled={readOnly} onClick={() => onTick(f.key, !f.done)}
                className={cn('w-7 h-7 shrink-0 rounded-md border flex items-center justify-center touch-manipulation', f.done && 'bg-emerald-600 border-emerald-600 text-white')}
                aria-label={(f.done ? 'Not done: ' : 'Done: ') + f.text}>
                {f.done && <Check className="w-4 h-4" />}
              </button>
              <span className={cn('text-sm flex-1', f.done && 'line-through text-muted-foreground')}>{f.text}</span>
              {f.link && <Link to={f.link} className="shrink-0 text-primary inline-flex items-center gap-1 text-xs min-h-[28px]">Open<ChevronRight className="w-3 h-3" /></Link>}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}
