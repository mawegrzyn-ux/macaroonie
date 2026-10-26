// src/pages/Loyalty.jsx
//
// Loyalty (/loyalty, migration 211): the tenant's programme. Tabs in the
// address (?tab=): Overview, Programme (switches, points, where it works,
// sign-up words, card colours), Rewards (drag = the order guests see),
// Stamp cards, Members (the basic CRM, ?member=<id> opens one) and Wallet
// (Macaroonie's Apple / Google accounts, or the group's own).
//
// Modules: loyalty (everything but members), loyalty_members (the members
// list). The rules are shared/loyalty.js; the API is routes/loyalty.js.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  Gift, Loader2, Plus, ArrowLeft, Search, Copy, ExternalLink, Download, Stamp, Users, Wallet, Settings2, LayoutDashboard,
  AlertTriangle, CircleCheck,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import { PageHeader, Segmented, SortableRows, ConfirmDelete, Modal, Field, ErrorNote, inputCls } from '@/components/staff/shared'
import { PriceInput } from '@/components/menus/shared'
import { DishPicker } from '@/components/menus/DishPicker'
import { ColourPicker, useThemeColours, inkOn } from '@/components/ColourPicker'
import { ImageField } from '@/components/website-builder/shared'
import { AppleWalletForm, GoogleWalletForm } from '@/components/loyalty/WalletForms'
import {
  FEATURES, LOYALTY_CHANNELS, CHANNEL_LABELS, REWARD_KINDS, STAMP_PER, DEFAULT_TERMS, DEFAULT_MARKETING,
  normaliseReward, normaliseStampCard, rewardProblems, stampCardProblems, formatMemberNo,
} from '@shared/loyalty.js'

const money = p => '£' + ((Number(p) || 0) / 100).toFixed(2)
const day = v => (v ? format(typeof v === 'string' ? parseISO(v) : new Date(v), 'd MMM yyyy') : '')
const dayTime = v => (v ? format(typeof v === 'string' ? parseISO(v) : new Date(v), 'd MMM yyyy, HH:mm') : '')
const btn = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border text-sm bg-background hover:bg-muted touch-manipulation disabled:opacity-50'
const primaryBtn = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-40'

const TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'programme', label: 'Programme', icon: Settings2 },
  { value: 'rewards', label: 'Rewards', icon: Gift },
  { value: 'stamps', label: 'Stamp cards', icon: Stamp },
  { value: 'members', label: 'Members', icon: Users },
  { value: 'wallet', label: 'Wallet', icon: Wallet },
]

export default function Loyalty() {
  const api = useApi()
  const [params, setParams] = useSearchParams()
  const perm = usePermission('loyalty')
  const members = usePermission('loyalty_members')
  const tabs = TABS.filter(t => t.value !== 'members' || members.canView)
  const tab = tabs.some(t => t.value === params.get('tab')) ? params.get('tab') : 'overview'
  const memberId = tab === 'members' ? params.get('member') : null
  const setTab = t => setParams(p => { const n = new URLSearchParams(p); n.delete('member'); if (t === 'overview') n.delete('tab'); else n.set('tab', t); return n })
  const openMember = id => setParams(p => { const n = new URLSearchParams(p); n.set('tab', 'members'); n.set('member', id); return n })
  const closeMember = () => setParams(p => { const n = new URLSearchParams(p); n.delete('member'); return n })

  const { data, isLoading, error } = useQuery({ queryKey: ['loyalty', 'programme'], queryFn: () => api.get('/loyalty/programme'), enabled: perm.canView })
  const { data: catalog } = useQuery({ queryKey: ['loyalty', 'catalog'], queryFn: () => api.get('/loyalty/catalog'), enabled: perm.canView, staleTime: 60_000 })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={Gift} title="Loyalty">
        {data && <StatusPill enabled={data.programme.enabled} />}
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-4 space-y-4">
          {!perm.loaded || isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" /> : !perm.canView ? (
            <p className="text-sm text-muted-foreground">Your role can't see Loyalty.</p>
          ) : (
            <>
              <div className="overflow-x-auto -mx-1 px-1">
                <div className="inline-flex rounded-lg border overflow-hidden bg-background" role="tablist" aria-label="Loyalty">
                  {tabs.map(t => (
                    <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}
                      data-testid={'loy-tab-' + t.value}
                      className={cn('h-11 px-3 sm:px-4 text-sm font-medium touch-manipulation inline-flex items-center gap-2 whitespace-nowrap',
                        tab === t.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                      <t.icon className="w-4 h-4" /> {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <ErrorNote error={error} />
              {data && tab === 'overview' && <Overview data={data} onTab={setTab} />}
              {data && tab === 'programme' && <ProgrammeTab data={data} catalog={catalog} canManage={perm.canManage} />}
              {data && tab === 'rewards' && <RewardsTab data={data} catalog={catalog} canManage={perm.canManage} />}
              {data && tab === 'stamps' && <StampCardsTab data={data} catalog={catalog} canManage={perm.canManage} />}
              {data && tab === 'members' && !memberId && <MembersTab perm={members} onOpen={openMember} venues={catalog?.venues || []} />}
              {data && tab === 'members' && memberId && (
                <MemberDetail key={memberId} id={memberId} onBack={closeMember} perm={members} data={data} />
              )}
              {data && tab === 'wallet' && <WalletTab data={data} canManage={perm.canManage && perm.isOwnerOrAdmin} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusPill({ enabled }) {
  return enabled
    ? <span className="text-xs rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-800" data-testid="loy-status">On</span>
    : <span className="text-xs rounded-full px-2 py-0.5 bg-muted text-muted-foreground" data-testid="loy-status">Off</span>
}

function Card({ title, icon: Icon, children, actions, testId }) {
  return (
    <section className="rounded-xl border bg-background overflow-hidden" data-testid={testId}>
      <div className="px-4 py-3 section-head font-semibold text-sm flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4" />}
        <span className="flex-1 min-w-0">{title}</span>
        {actions}
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </section>
  )
}

function IntInput({ value, onChange, min = 0, max, allowEmpty, className, placeholder, ...rest }) {
  const [text, setText] = useState(null)
  const shown = text ?? (value == null ? '' : String(value))
  return (
    <input {...rest} type="text" inputMode="numeric" value={shown} placeholder={placeholder}
      onFocus={() => setText(value == null ? '' : String(value))}
      onChange={e => setText(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={() => {
        const n = text === '' || text == null ? null : Number(text)
        setText(null)
        if (n == null) onChange(allowEmpty ? null : min)
        else onChange(Math.max(min, max != null ? Math.min(max, n) : n))
      }}
      className={cn('border rounded-lg px-3 min-h-[44px] bg-background text-sm touch-manipulation tabular-nums', className)} />
  )
}

function Switch({ checked, onChange, label, testId, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={label} onClick={() => onChange(!checked)} disabled={disabled}
      data-testid={testId} className="w-14 h-12 shrink-0 flex items-center justify-center touch-manipulation disabled:opacity-50">
      <span className={cn('relative w-11 h-6 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted-foreground/30')}>
        <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

function Check({ checked, onChange, children, hint, testId, disabled }) {
  return (
    <label className={cn('flex items-start gap-3 min-h-[44px] cursor-pointer touch-manipulation', disabled && 'opacity-60')}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
        className="w-5 h-5 mt-0.5 shrink-0" data-testid={testId} />
      <span className="text-sm">{children}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  )
}

function CopyLink({ url, testId }) {
  const [copied, setCopied] = useState(false)
  if (!url) return null
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testId}>
      <code className="text-xs bg-muted/60 rounded px-2 py-1.5 break-all flex-1 min-w-0">{url}</code>
      <button type="button" className={btn} onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
        <Copy className="w-4 h-4" /> {copied ? 'Copied' : 'Copy'}
      </button>
      <a href={url} target="_blank" rel="noreferrer" className={btn}><ExternalLink className="w-4 h-4" /> Open</a>
    </div>
  )
}

// ── Overview ────────────────────────────────────────────────────────────────

function Overview({ data, onTab }) {
  const { programme, figures, rewards, stamp_cards: cards, wallet } = data
  const s = programme.settings
  const label = s.points.label
  const problems = [
    ...rewards.filter(r => r.is_active && r.problems.length).map(r => ({ what: 'Reward "' + r.name + '"', text: r.problems.join('; '), tab: 'rewards' })),
    ...cards.filter(c => c.is_active && c.problems.length).map(c => ({ what: 'Stamp card "' + c.name + '"', text: c.problems.join('; '), tab: 'stamps' })),
  ]
  if (s.features.points && s.features.rewards && !rewards.some(r => r.is_active && r.points_cost)) {
    problems.push({ what: 'Rewards', text: 'No reward can be bought with ' + label + ' yet', tab: 'rewards' })
  }
  if ((s.features.wallet_apple && !wallet.apple.available) || (s.features.wallet_google && !wallet.google.available)) {
    problems.push({ what: 'Wallet', text: 'A wallet is switched on but has no account to sign the cards', tab: 'wallet' })
  }
  const tiles = [
    { label: 'Members', value: figures.members },
    { label: 'Joined in 30 days', value: figures.joined_30d },
    { label: label[0].toUpperCase() + label.slice(1) + ' held', value: figures.points_out.toLocaleString() },
    { label: label[0].toUpperCase() + label.slice(1) + ' earned in 30 days', value: figures.earned_30d.toLocaleString() },
    { label: 'Rewards used in 30 days', value: figures.redeemed_30d },
  ]
  return (
    <div className="space-y-4">
      {!programme.enabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-sm flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-0">The programme is off: nobody can join, earn or spend. Set it up, then switch it on in Programme.</span>
          <button type="button" className={btn} onClick={() => onTab('programme')}>Open Programme</button>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="loy-figures">
        {tiles.map(t => (
          <div key={t.label} className="rounded-xl border bg-background p-3">
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className="text-2xl font-semibold tabular-nums">{t.value}</div>
          </div>
        ))}
      </div>
      {problems.length > 0 && (
        <Card title="To sort out" icon={AlertTriangle} testId="loy-problems">
          <ul className="space-y-2">
            {problems.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{p.what}:</span>
                <span className="flex-1 min-w-0 text-muted-foreground">{p.text}</span>
                <button type="button" className={btn} onClick={() => onTab(p.tab)}>Open</button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Where guests find their card" icon={ExternalLink}>
        {s.features.web_app ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Guests join, sign in with a code sent to their email and see their card here. Both addresses open the same app, which can be added to a phone's home screen.</p>
            {data.web_app_url ? <CopyLink url={data.web_app_url} testId="loy-web-url" /> : <p className="text-sm text-muted-foreground">Set up your website address first (Website, Domain).</p>}
            <CopyLink url={data.hub_url} testId="loy-hub-url" />
          </div>
        ) : <p className="text-sm text-muted-foreground">The loyalty web app is switched off in Programme. Guests can still join at the till or the kiosk.</p>}
      </Card>
      <Card title="What's on" icon={CircleCheck}>
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {FEATURES.filter(f => f.key !== 'network').map(f => (
            <li key={f.key} className="flex items-center gap-2">
              <span className={cn('w-2 h-2 rounded-full', s.features[f.key] ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />
              <span className={cn(!s.features[f.key] && 'text-muted-foreground')}>{f.label}</span>
            </li>
          ))}
          {LOYALTY_CHANNELS.map(c => (
            <li key={c} className="flex items-center gap-2">
              <span className={cn('w-2 h-2 rounded-full', s.channels[c].earn || s.channels[c].redeem ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />
              <span>{CHANNEL_LABELS[c]}: {[s.channels[c].earn && 'earn', s.channels[c].redeem && 'spend'].filter(Boolean).join(' and ') || 'off'}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

// ── Programme ───────────────────────────────────────────────────────────────

function cardLook(settings, theme) {
  const byKey = Object.fromEntries(theme.map(t => [t.key, t.hex]))
  const background = settings.card.background || byKey.primary || '#1f2937'
  const text = settings.card.text || inkOn(background)
  const accent = settings.card.accent || byKey.accent || text
  return { background, text, accent }
}

function ProgrammeTab({ data, catalog, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const theme = useThemeColours()
  const saved = useMemo(() => ({ enabled: data.programme.enabled, settings: data.programme.settings }), [data.programme])
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const s = draft.settings
  const set = patch => setDraft(d => ({ ...d, settings: { ...d.settings, ...patch } }))
  const setIn = (key, patch) => set({ [key]: { ...s[key], ...patch } })
  const save = useMutation({
    mutationFn: () => api.put('/loyalty/programme', draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loyalty'] }),
  })
  const venues = catalog?.venues || []
  const look = cardLook(s, theme)
  return (
    <div className="space-y-4">
      {!canManage && <ReadOnlyNotice what="the loyalty programme" />}
      <ReadOnlyFieldset disabled={!canManage} className="space-y-4">
        <Card title="Programme" icon={Gift}>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">Loyalty is on</div>
              <div className="text-xs text-muted-foreground">Off: nobody can join, earn or spend, and the web app says so. Members and their points are kept.</div>
            </div>
            <Switch checked={draft.enabled} onChange={v => setDraft(d => ({ ...d, enabled: v }))} label="Loyalty is on" testId="loy-enabled" />
          </div>
          <Field label="Name guests see">
            <input value={s.name} onChange={e => set({ name: e.target.value.slice(0, 60) })} className={inputCls} data-testid="loy-name" placeholder="e.g. Thai Club" />
          </Field>
        </Card>

        <Card title="Features">
          <div className="divide-y">
            {FEATURES.map(f => (
              <div key={f.key} className="flex items-center gap-3 py-1">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{f.label}</div>
                  <div className="text-xs text-muted-foreground">{f.hint}</div>
                </div>
                <Switch checked={s.features[f.key]} disabled={f.key === 'network'} label={f.label} testId={'loy-feature-' + f.key}
                  onChange={v => setIn('features', { [f.key]: v })} />
              </div>
            ))}
          </div>
        </Card>

        {s.features.points && (
          <Card title="Points">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="What they're called" hint="Shown everywhere guests see them: 120 points, 120 stars.">
                <input value={s.points.label} onChange={e => setIn('points', { label: e.target.value.slice(0, 20) })} className={inputCls} data-testid="loy-points-label" />
              </Field>
              <Field label={'For every £1 spent'} hint="Worked out on what the guest paid after discounts, without tips or service charge.">
                <div className="flex items-center gap-2">
                  <IntInput value={s.points.per_pound} min={1} max={1000} onChange={v => setIn('points', { per_pound: v })} className="w-24" data-testid="loy-per-pound" aria-label="Points per pound" />
                  <span className="text-sm">{s.points.label}</span>
                </div>
              </Field>
              <Field label="Smallest spend that earns">
                <PriceInput pence={s.points.min_spend_pence} onChange={v => setIn('points', { min_spend_pence: v ?? 0 })} placeholder="0.00" />
              </Field>
              <Field label="Welcome gift" hint="Given once, when someone joins.">
                <div className="flex items-center gap-2">
                  <IntInput value={s.points.welcome} min={0} max={100000} onChange={v => setIn('points', { welcome: v })} className="w-24" data-testid="loy-welcome" aria-label="Welcome points" />
                  <span className="text-sm">{s.points.label}</span>
                </div>
              </Field>
              <Field label="Points run out" hint="When a member hasn't earned or spent for this long, their balance goes. Empty = never.">
                <div className="flex items-center gap-2">
                  <IntInput value={s.points.expiry_months} min={1} max={60} allowEmpty onChange={v => setIn('points', { expiry_months: v })} className="w-24" placeholder="Never" aria-label="Months" data-testid="loy-expiry" />
                  <span className="text-sm">months without a visit</span>
                </div>
              </Field>
            </div>
          </Card>
        )}

        <Card title="Where it works">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Place</th><th className="py-1 font-medium w-24 text-center">Earn</th><th className="py-1 font-medium w-24 text-center">Spend rewards</th></tr></thead>
            <tbody>
              {LOYALTY_CHANNELS.map(c => (
                <tr key={c} className="border-t">
                  <td className="py-1">{CHANNEL_LABELS[c]}</td>
                  {['earn', 'redeem'].map(w => (
                    <td key={w} className="text-center">
                      <input type="checkbox" className="w-5 h-5" checked={s.channels[c][w]} data-testid={`loy-ch-${c}-${w}`} aria-label={CHANNEL_LABELS[c] + (w === 'earn' ? ' earn' : ' spend')}
                        onChange={e => set({ channels: { ...s.channels, [c]: { ...s.channels[c], [w]: e.target.checked } } })} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {venues.length > 1 && (
            <div className="space-y-2">
              <Check checked={s.venue_ids === null} onChange={v => set({ venue_ids: v ? null : venues.map(x => x.id) })} testId="loy-all-venues"
                hint="Points and rewards are shared: earn at one venue, spend at another.">Every venue takes part</Check>
              {s.venue_ids !== null && (
                <div className="pl-8 grid sm:grid-cols-2 gap-x-4">
                  {venues.map(v => (
                    <Check key={v.id} checked={s.venue_ids.includes(v.id)} testId={'loy-venue-' + v.id}
                      onChange={on => set({ venue_ids: on ? [...s.venue_ids, v.id] : s.venue_ids.filter(x => x !== v.id) })}>{v.name}</Check>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Joining">
          <Check checked={s.signup.ask_phone} onChange={v => setIn('signup', { ask_phone: v })}>Ask for a phone number too (optional for guests)</Check>
          <Field label="What guests agree to" hint="Shown beside the box they must tick to join. Keep it plain: what you keep and why.">
            <textarea value={s.signup.terms_text} onChange={e => setIn('signup', { terms_text: e.target.value.slice(0, 600) })}
              className={cn(inputCls, 'min-h-[88px] py-2')} data-testid="loy-terms" placeholder={DEFAULT_TERMS} />
          </Field>
          <Field label="The newsletter box" hint="Never ticked for them: marketing needs the guest's own yes.">
            <textarea value={s.signup.marketing_text} onChange={e => setIn('signup', { marketing_text: e.target.value.slice(0, 400) })}
              className={cn(inputCls, 'min-h-[64px] py-2')} placeholder={DEFAULT_MARKETING} />
          </Field>
          <Field label="Welcome words" hint="Shown on the card after joining. Optional.">
            <input value={s.signup.welcome_text} onChange={e => setIn('signup', { welcome_text: e.target.value.slice(0, 300) })} className={inputCls} />
          </Field>
        </Card>

        <Card title="The card's colours" icon={Wallet}>
          <div className="grid md:grid-cols-[1fr_280px] gap-4 items-start">
            <div className="space-y-3">
              <ColourPicker label="Background" optional placeholder="Brand colour" value={s.card.background} fallback={look.background}
                onChange={v => setIn('card', { background: v || null })} disabled={!canManage} testId="loy-card-bg" />
              <ColourPicker label="Words" optional placeholder="Automatic" value={s.card.text} fallback={look.text}
                onChange={v => setIn('card', { text: v || null })} disabled={!canManage} />
              <ColourPicker label="Highlights" optional placeholder="Brand accent" value={s.card.accent} fallback={look.accent}
                onChange={v => setIn('card', { accent: v || null })} disabled={!canManage} />
            </div>
            <div className="rounded-2xl p-4 shadow-sm aspect-[1.6] flex flex-col justify-between" style={{ background: look.background, color: look.text }} data-testid="loy-card-preview">
              <div className="flex items-center justify-between text-sm font-semibold"><span>{s.name}</span><Gift className="w-5 h-5" style={{ color: look.accent }} /></div>
              {s.features.points && <div><div className="text-3xl font-bold tabular-nums" style={{ color: look.accent }}>120</div><div className="text-xs opacity-80">{s.points.label}</div></div>}
              <div className="text-xs opacity-80 tabular-nums">Member 123 456 789</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Used in Apple and Google Wallet and on the web app. Not set: the brand colours from Brand & theme.</p>
        </Card>
      </ReadOnlyFieldset>
      {canManage && (
        <div className="sticky bottom-0 bg-page/95 py-3 flex flex-wrap items-center gap-2 border-t">
          <button type="button" className={primaryBtn} disabled={!dirty || save.isPending} onClick={() => save.mutate()} data-testid="loy-save-programme">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
          {dirty && <button type="button" className={btn} onClick={() => setDraft(saved)}>Discard</button>}
          {save.isSuccess && !dirty && <span className="text-sm text-emerald-700">Saved</span>}
          <ErrorNote error={save.error} />
        </div>
      )}
    </div>
  )
}

// ── Rewards ─────────────────────────────────────────────────────────────────

function RewardsTab({ data, catalog, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)   // null | 'new' | reward
  const [error, setError] = useState(null)
  const label = data.programme.settings.points.label
  const refresh = () => qc.invalidateQueries({ queryKey: ['loyalty'] })
  const reorder = useMutation({ mutationFn: ids => api.patch('/loyalty/rewards/reorder', { ids }), onSuccess: refresh })
  const remove = useMutation({
    mutationFn: id => api.delete('/loyalty/rewards/' + id),
    onSuccess: () => { setError(null); refresh() },
    onError: e => setError(e.message),
  })
  const rewards = data.rewards
  return (
    <div className="space-y-4">
      {!canManage && <ReadOnlyNotice what="rewards" />}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground flex-1 min-w-[200px]">
          Guests see rewards in this order. A reward can be bought with {label}, given by a full stamp card, or given by staff.
        </p>
        {canManage && <button type="button" className={primaryBtn} onClick={() => setEditing('new')} data-testid="loy-add-reward"><Plus className="w-4 h-4" /> Add a reward</button>}
      </div>
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {!rewards.length ? (
        <div className="rounded-xl border bg-background p-6 text-center text-sm text-muted-foreground">No rewards yet. Add a few: a free coffee, £5 off, 10% off.</div>
      ) : (
        <SortableRows items={rewards} locked={!canManage} onReorder={ids => reorder.mutate(ids)} renderItem={r => (
          <div className="flex flex-wrap items-center gap-2 py-1" data-testid={'loy-reward-' + r.id}>
            {r.image_url ? <img src={r.image_url} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" /> : <span className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center shrink-0"><Gift className="w-5 h-5 text-muted-foreground" /></span>}
            <button type="button" onClick={() => setEditing(r)} className="flex-1 min-w-[10rem] text-left min-h-[44px] touch-manipulation">
              <div className="text-sm font-medium">{r.name}</div>
              <div className="text-xs text-muted-foreground">{r.summary}{r.points_cost ? ' · ' + r.points_cost.toLocaleString() + ' ' + label : ' · not for ' + label}</div>
              {r.problems.length > 0 && <div className="text-xs text-amber-700">{r.problems.join('; ')}</div>}
            </button>
            <span className={cn('text-xs rounded-full px-2 py-0.5', r.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground')}>{r.is_active ? 'On' : 'Off'}</span>
            {canManage && <ConfirmDelete label={'Delete ' + r.name} onConfirm={() => remove.mutate(r.id)} />}
          </div>
        )} />
      )}
      {editing && (
        <RewardModal reward={editing === 'new' ? null : editing} catalog={catalog} label={label} canManage={canManage}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />
      )}
    </div>
  )
}

function RewardModal({ reward, catalog, label, canManage, onClose, onSaved }) {
  const api = useApi()
  const [r, setR] = useState(() => normaliseReward(reward || { name: '', kind: 'amount_off', value: 500 }))
  const set = patch => setR(x => normaliseReward({ ...x, ...patch, name: patch.name ?? x.name }))
  const [name, setName] = useState(reward?.name || '')
  const save = useMutation({
    mutationFn: () => {
      const body = { ...r, name: name.trim() || 'Reward' }
      return reward ? api.put('/loyalty/rewards/' + reward.id, body) : api.post('/loyalty/rewards', body)
    },
    onSuccess: onSaved,
  })
  const problems = rewardProblems(r)
  return (
    <Modal title={reward ? 'Reward' : 'New reward'} onClose={onClose} footer={canManage && (
      <>
        <button type="button" className={primaryBtn} disabled={save.isPending || !name.trim()} onClick={() => save.mutate()} data-testid="loy-reward-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
      </>
    )}>
      <ReadOnlyFieldset disabled={!canManage} className="space-y-4">
        <Field label="Name">
          <input value={name} onChange={e => setName(e.target.value.slice(0, 80))} className={inputCls} placeholder="e.g. Free coffee" data-testid="loy-reward-name" autoFocus />
        </Field>
        <Field label="Description (optional)">
          <textarea value={r.description} onChange={e => set({ description: e.target.value })} className={cn(inputCls, 'min-h-[64px] py-2')} />
        </Field>
        <Field label="What it gives" group>
          <Segmented value={r.kind} options={REWARD_KINDS.map(k => ({ value: k.key, label: k.label }))} onChange={v => set({ kind: v, value: null })} />
        </Field>
        {r.kind === 'amount_off' && (
          <Field label="Money off" hint="Off the whole check or order, never below £0.">
            <PriceInput pence={r.value} onChange={v => set({ value: v })} data-testid="loy-reward-amount" />
          </Field>
        )}
        {r.kind === 'percent_off' && (
          <Field label="Percent off">
            <div className="flex items-center gap-2"><IntInput value={r.value} min={1} max={100} onChange={v => set({ value: v })} className="w-24" aria-label="Percent off" data-testid="loy-reward-percent" /><span className="text-sm">%</span></div>
          </Field>
        )}
        {r.kind === 'free_item' && (
          <>
            <Field label="Which dishes can be free" group hint="The guest gets one of these free. A whole section covers dishes added to it later.">
              <DishPicker catalog={catalog} allowSections itemIds={r.item_ids} sectionIds={r.section_ids} title="Dishes that can be free"
                onChange={v => set(v)} />
            </Field>
            <Field label="Takes off at most (optional)" hint="Empty: the dish's own price.">
              <PriceInput pence={r.value} onChange={v => set({ value: v })} placeholder="The dish's price" />
            </Field>
          </>
        )}
        <Check checked={r.points_cost != null} onChange={on => set({ points_cost: on ? 100 : null })} testId="loy-reward-for-points"
          hint={'Off: only a full stamp card or staff give it.'}>{'Guests can buy it with ' + label}</Check>
        {r.points_cost != null && (
          <Field label="Price">
            <div className="flex items-center gap-2"><IntInput value={r.points_cost} min={1} max={10000000} onChange={v => set({ points_cost: v })} className="w-28" aria-label="Points price" data-testid="loy-reward-cost" /><span className="text-sm">{label}</span></div>
          </Field>
        )}
        <Field label="Smallest order it can go on">
          <PriceInput pence={r.min_spend_pence} onChange={v => set({ min_spend_pence: v ?? 0 })} placeholder="0.00" />
        </Field>
        <Field label="Where it can be used" group>
          <div className="flex flex-wrap gap-x-4">
            {LOYALTY_CHANNELS.map(c => (
              <Check key={c} checked={r.channels.includes(c)} testId={'loy-reward-ch-' + c}
                onChange={on => set({ channels: on ? [...r.channels, c] : r.channels.filter(x => x !== c) })}>{CHANNEL_LABELS[c]}</Check>
            ))}
          </div>
        </Field>
        <Field label="A held reward lasts" hint="Once bought or given. Empty = until used.">
          <div className="flex items-center gap-2"><IntInput value={r.valid_days} min={1} max={3650} allowEmpty onChange={v => set({ valid_days: v })} className="w-24" placeholder="Always" aria-label="Days" /><span className="text-sm">days</span></div>
        </Field>
        <Field label="Picture (optional)" group>
          <ImageField url={r.image_url} onChange={url => set({ image_url: url || null })} scope="loyalty" />
        </Field>
        <Check checked={r.is_active} onChange={v => set({ is_active: v })} hint="Off: hidden from guests; members who hold it can't use it.">On</Check>
        {problems.length > 0 && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{problems.join('. ')}.</p>}
        <ErrorNote error={save.error} />
      </ReadOnlyFieldset>
    </Modal>
  )
}

// ── Stamp cards ─────────────────────────────────────────────────────────────

function StampCardsTab({ data, catalog, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['loyalty'] })
  const remove = useMutation({
    mutationFn: id => api.delete('/loyalty/stamp-cards/' + id),
    onSuccess: () => { setError(null); refresh() },
    onError: e => setError(e.message),
  })
  const rewardName = id => data.rewards.find(r => r.id === id)?.name || 'No reward'
  const on = data.programme.settings.features.stamps
  return (
    <div className="space-y-4">
      {!canManage && <ReadOnlyNotice what="stamp cards" />}
      {!on && <p className="text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2">Stamp cards are switched off in Programme: guests don't collect stamps until they are on.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground flex-1 min-w-[200px]">Buy 9 coffees, the 10th is free: a card fills, gives its reward and starts again.</p>
        {canManage && <button type="button" className={primaryBtn} onClick={() => setEditing('new')} data-testid="loy-add-card"><Plus className="w-4 h-4" /> Add a stamp card</button>}
      </div>
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {!data.stamp_cards.length ? (
        <div className="rounded-xl border bg-background p-6 text-center text-sm text-muted-foreground">No stamp cards yet.</div>
      ) : (
        <div className="rounded-xl border bg-background divide-y">
          {data.stamp_cards.map(c => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid={'loy-card-' + c.id}>
              <Stamp className="w-5 h-5 text-muted-foreground shrink-0" />
              <button type="button" onClick={() => setEditing(c)} className="flex-1 min-w-[10rem] text-left min-h-[44px] touch-manipulation">
                <div className="text-sm font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.stamps_needed} stamps {c.earn.per === 'visit' ? 'for visits' : 'for dishes'} · gives {rewardName(c.reward_id)}</div>
                {c.problems.length > 0 && <div className="text-xs text-amber-700">{c.problems.join('; ')}</div>}
              </button>
              <span className={cn('text-xs rounded-full px-2 py-0.5', c.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground')}>{c.is_active ? 'On' : 'Off'}</span>
              {canManage && <ConfirmDelete label={'Delete ' + c.name} onConfirm={() => remove.mutate(c.id)} />}
            </div>
          ))}
        </div>
      )}
      {editing && (
        <StampCardModal card={editing === 'new' ? null : editing} catalog={catalog} rewards={data.rewards} canManage={canManage}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />
      )}
    </div>
  )
}

function StampCardModal({ card, catalog, rewards, canManage, onClose, onSaved }) {
  const api = useApi()
  const [c, setC] = useState(() => normaliseStampCard(card || { stamps_needed: 8 }))
  const [name, setName] = useState(card?.name || '')
  const set = patch => setC(x => normaliseStampCard({ ...x, ...patch }))
  const setEarn = patch => set({ earn: { ...c.earn, ...patch } })
  const save = useMutation({
    mutationFn: () => {
      const body = { ...c, name: name.trim() || 'Stamp card' }
      return card ? api.put('/loyalty/stamp-cards/' + card.id, body) : api.post('/loyalty/stamp-cards', body)
    },
    onSuccess: onSaved,
  })
  const problems = stampCardProblems(c)
  return (
    <Modal title={card ? 'Stamp card' : 'New stamp card'} onClose={onClose} footer={canManage && (
      <>
        <button type="button" className={primaryBtn} disabled={save.isPending || !name.trim()} onClick={() => save.mutate()} data-testid="loy-card-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
      </>
    )}>
      <ReadOnlyFieldset disabled={!canManage} className="space-y-4">
        <Field label="Name"><input value={name} onChange={e => setName(e.target.value.slice(0, 80))} className={inputCls} placeholder="e.g. Coffee card" data-testid="loy-card-name" autoFocus /></Field>
        <Field label="Description (optional)"><input value={c.description} onChange={e => set({ description: e.target.value })} className={inputCls} placeholder="e.g. Buy 9 coffees, the 10th is on us" /></Field>
        <Field label="Stamps to fill it">
          <IntInput value={c.stamps_needed} min={2} max={50} onChange={v => set({ stamps_needed: v })} className="w-24" aria-label="Stamps to fill" data-testid="loy-card-needed" />
        </Field>
        <Field label="Stamps come from" group>
          <Segmented value={c.earn.per} options={STAMP_PER.map(p => ({ value: p.key, label: p.label }))} onChange={v => setEarn({ per: v })} />
        </Field>
        {c.earn.per === 'item' && (
          <Field label="Dishes that earn a stamp" group hint="One stamp for each one bought. Meal deals count their parts.">
            <DishPicker catalog={catalog} allowSections itemIds={c.earn.item_ids} sectionIds={c.earn.section_ids} title="Dishes that earn a stamp"
              onChange={v => setEarn(v)} />
          </Field>
        )}
        <Field label="Smallest spend that earns">
          <PriceInput pence={c.earn.min_spend_pence} onChange={v => setEarn({ min_spend_pence: v ?? 0 })} placeholder="0.00" />
        </Field>
        <Field label="Most stamps from one order" hint="Empty = no limit.">
          <IntInput value={c.earn.max_per_sale} min={1} max={50} allowEmpty onChange={v => setEarn({ max_per_sale: v })} className="w-24" placeholder="No limit" aria-label="Most stamps per order" />
        </Field>
        <Field label="A full card gives">
          <select value={c.reward_id || ''} onChange={e => set({ reward_id: e.target.value || null })} className={inputCls} data-testid="loy-card-reward">
            <option value="">Pick a reward</option>
            {rewards.map(r => <option key={r.id} value={r.id}>{r.name}{r.is_active ? '' : ' (off)'}</option>)}
          </select>
        </Field>
        <Check checked={c.is_active} onChange={v => set({ is_active: v })} hint="Off: no new stamps; stamps already collected are kept.">On</Check>
        {problems.length > 0 && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{problems.join('. ')}.</p>}
        <ErrorNote error={save.error} />
      </ReadOnlyFieldset>
    </Modal>
  )
}

// ── Members (basic CRM) ─────────────────────────────────────────────────────

const STATUS_LABEL = { active: 'Active', closed: 'Closed', erased: 'Erased' }
const SORTS = [
  { value: 'recent', label: 'Last seen' }, { value: 'joined', label: 'Newest' }, { value: 'points', label: 'Most points' },
  { value: 'visits', label: 'Most visits' }, { value: 'name', label: 'Name' },
]
const PAGE = 50

function MembersTab({ perm, onOpen, venues }) {
  const api = useApi()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('active')
  const [marketing, setMarketing] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState('recent')
  const [offset, setOffset] = useState(0)
  const [adding, setAdding] = useState(false)
  useEffect(() => { const t = setTimeout(() => { setSearch(q.trim()); setOffset(0) }, 300); return () => clearTimeout(t) }, [q])
  const query = new URLSearchParams({ status, sort, limit: String(PAGE), offset: String(offset), ...(search ? { q: search } : {}), ...(marketing ? { marketing } : {}), ...(tag ? { tag } : {}) }).toString()
  const { data, isLoading, error } = useQuery({ queryKey: ['loyalty', 'members', query], queryFn: () => api.get('/loyalty/members?' + query), placeholderData: p => p })
  const filter = (setter) => v => { setter(v); setOffset(0) }
  const download = useMutation({ mutationFn: () => api.download('/loyalty/members.csv?' + query, 'loyalty-members.csv') })
  const selectCls = 'h-11 rounded-lg border bg-background px-2 text-sm touch-manipulation'
  return (
    <div className="space-y-3">
      {!perm.canManage && <ReadOnlyNotice what="loyalty members" />}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 px-3 border rounded-lg bg-background flex-1 min-w-[14rem]">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, email, phone or member number" aria-label="Search members"
            className="flex-1 min-h-[44px] bg-transparent text-sm outline-none" data-testid="loy-member-search" />
        </label>
        <select value={status} onChange={e => filter(setStatus)(e.target.value)} className={selectCls} aria-label="Status" data-testid="loy-member-status">
          <option value="active">Active</option><option value="closed">Closed</option><option value="erased">Erased</option><option value="all">Everyone</option>
        </select>
        <select value={marketing} onChange={e => filter(setMarketing)(e.target.value)} className={selectCls} aria-label="Newsletter">
          <option value="">Newsletter: any</option><option value="1">Newsletter: yes</option><option value="0">Newsletter: no</option>
        </select>
        {(data?.tags?.length || 0) > 0 && (
          <select value={tag} onChange={e => filter(setTag)(e.target.value)} className={selectCls} aria-label="Tag">
            <option value="">Any tag</option>{data.tags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <select value={sort} onChange={e => filter(setSort)(e.target.value)} className={selectCls} aria-label="Sort">
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {perm.canManage && (
          <>
            <button type="button" className={btn} onClick={() => download.mutate()} disabled={download.isPending} data-testid="loy-members-csv"><Download className="w-4 h-4" /> CSV</button>
            <button type="button" className={primaryBtn} onClick={() => setAdding(true)} data-testid="loy-add-member"><Plus className="w-4 h-4" /> Add a member</button>
          </>
        )}
      </div>
      <ErrorNote error={error || download.error} />
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-6" /> : (
        <>
          <div className="text-xs text-muted-foreground" data-testid="loy-member-count">{data?.total || 0} {data?.total === 1 ? 'member' : 'members'}</div>
          {!data?.members?.length ? (
            <div className="rounded-xl border bg-background p-6 text-center text-sm text-muted-foreground">{search ? 'Nobody matches.' : 'No members yet.'}</div>
          ) : (
            <div className="rounded-xl border bg-background divide-y" data-testid="loy-member-list">
              {data.members.map(m => (
                <button key={m.id} type="button" onClick={() => onOpen(m.id)} data-testid={'loy-member-' + m.id}
                  className="w-full text-left px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-muted/40 touch-manipulation min-h-[56px]">
                  <div className="flex-1 min-w-[12rem]">
                    <div className="text-sm font-medium">{m.name || 'Erased member'}</div>
                    <div className="text-xs text-muted-foreground break-all">{m.email || '—'}{m.phone ? ' · ' + m.phone : ''}</div>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums w-28">{formatMemberNo(m.member_no)}</div>
                  <div className="text-sm tabular-nums w-20 text-right">{m.points.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground w-24">{m.visits} {m.visits === 1 ? 'visit' : 'visits'}</div>
                  <div className="text-xs text-muted-foreground w-28">{m.last_activity_at ? 'Seen ' + day(m.last_activity_at) : 'Joined ' + day(m.joined_at)}</div>
                  <div className="flex flex-wrap gap-1">
                    {m.status !== 'active' && <span className="text-[11px] rounded-full px-2 py-0.5 bg-muted text-muted-foreground">{STATUS_LABEL[m.status]}</span>}
                    {m.marketing_opt_in && <span className="text-[11px] rounded-full px-2 py-0.5 bg-sky-100 text-sky-800">Newsletter</span>}
                    {m.tags.map(t => <span key={t} className="text-[11px] rounded-full px-2 py-0.5 border">{t}</span>)}
                  </div>
                </button>
              ))}
            </div>
          )}
          {(data?.total || 0) > PAGE && (
            <div className="flex items-center gap-2">
              <button type="button" className={btn} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
              <span className="text-sm text-muted-foreground tabular-nums">{offset + 1}-{Math.min(offset + PAGE, data.total)} of {data.total}</span>
              <button type="button" className={btn} disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
            </div>
          )}
        </>
      )}
      {adding && <AddMemberModal venues={venues} onClose={() => setAdding(false)} onAdded={m => { setAdding(false); onOpen(m.id) }} />}
    </div>
  )
}

function AddMemberModal({ venues, onClose, onAdded }) {
  const api = useApi()
  const qc = useQueryClient()
  const [f, setF] = useState({ name: '', email: '', phone: '', marketing: false, agreed: false, venue_id: venues.length === 1 ? venues[0].id : '' })
  const set = patch => setF(x => ({ ...x, ...patch }))
  const add = useMutation({
    mutationFn: () => api.post('/loyalty/members', { ...f, phone: f.phone || null, venue_id: f.venue_id || null }),
    onSuccess: m => { qc.invalidateQueries({ queryKey: ['loyalty'] }); onAdded(m) },
  })
  return (
    <Modal title="Add a member" onClose={onClose} footer={(
      <>
        <button type="button" className={primaryBtn} disabled={!f.name.trim() || !f.email.trim() || !f.agreed || add.isPending} onClick={() => add.mutate()} data-testid="loy-member-add-save">
          {add.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Add
        </button>
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
      </>
    )}>
      <p className="text-sm text-muted-foreground">For a guest who asks to join in person. They get a welcome email with their card.</p>
      <Field label="Name"><input value={f.name} onChange={e => set({ name: e.target.value })} className={inputCls} data-testid="loy-member-add-name" /></Field>
      <Field label="Email"><input type="email" value={f.email} onChange={e => set({ email: e.target.value })} className={inputCls} data-testid="loy-member-add-email" /></Field>
      <Field label="Phone (optional)"><input type="tel" inputMode="tel" value={f.phone} onChange={e => set({ phone: e.target.value })} className={inputCls} /></Field>
      {venues.length > 1 && (
        <Field label="Joined at">
          <select value={f.venue_id} onChange={e => set({ venue_id: e.target.value })} className={inputCls}>
            <option value="">No venue</option>{venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
      )}
      <Check checked={f.agreed} onChange={v => set({ agreed: v })} testId="loy-member-add-agreed">The guest agreed to join (the words in Programme, Joining)</Check>
      <Check checked={f.marketing} onChange={v => set({ marketing: v })} hint="Only if they asked for it themselves.">They want the newsletter</Check>
      <ErrorNote error={add.error} />
    </Modal>
  )
}

const LEDGER_KIND = {
  earn: 'Earned', redeem: 'Spent on a reward', release: 'Reward put back', adjust: 'Changed by staff', welcome: 'Welcome gift',
  expire: 'Ran out', stamps: 'Stamps', card_full: 'Card filled',
}
const JOINED_WORD = { web: 'on the web app', till: 'at a till', kiosk: 'at a kiosk', online: 'when ordering online', staff: 'added by staff' }
const CHANNEL_WORD = { till: 'till', kiosk: 'kiosk', online: 'online', web: 'web app', staff: 'staff' }

function MemberDetail({ id, onBack, perm, data: programmeData }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['loyalty', 'member', id], queryFn: () => api.get('/loyalty/members/' + id) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['loyalty'] })
  const label = programmeData.programme.settings.points.label
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" />
  if (error) return <div className="space-y-3"><button type="button" className={btn} onClick={onBack}><ArrowLeft className="w-4 h-4" /> Members</button><ErrorNote error={error} /></div>
  const m = data.member
  const erased = m.status === 'erased'
  const canChange = perm.canManage && !erased
  return (
    <div className="space-y-4" data-testid="loy-member-detail">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={onBack}><ArrowLeft className="w-4 h-4" /> Members</button>
        <h2 className="text-lg font-semibold flex-1 min-w-[10rem] break-words">{m.name || 'Erased member'}</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{formatMemberNo(m.member_no)}</span>
        <span className={cn('text-xs rounded-full px-2 py-0.5', m.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground')}>{STATUS_LABEL[m.status]}</span>
      </div>
      {!perm.canManage && <ReadOnlyNotice what="loyalty members" />}
      {erased && <p className="text-sm rounded-lg border bg-muted/40 px-3 py-2">Erased on {day(m.erased_at)}: their details are gone. What they bought stays in the figures without their name.</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          [label[0].toUpperCase() + label.slice(1), m.points.toLocaleString()],
          ['Visits', m.visits], ['Spent', money(m.spend_pence)], ['Joined', day(m.joined_at)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl border bg-background p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-xl font-semibold tabular-nums" data-testid={'loy-m-' + l.toLowerCase()}>{v}</div></div>
        ))}
      </div>
      {!erased && <MemberProfile m={m} canChange={canChange} onSaved={refresh} />}
      {!erased && data.summary && (
        <div className="grid md:grid-cols-2 gap-4">
          <PointsCard m={m} label={label} canChange={canChange} onDone={refresh} />
          <RewardsCard m={m} data={data} rewards={programmeData.rewards} canChange={canChange} onDone={refresh} />
        </div>
      )}
      {!erased && data.summary?.stamps?.length > 0 && (
        <Card title="Stamp cards" icon={Stamp}>
          {data.summary.stamps.map(s => (
            <div key={s.card_id} className="space-y-1">
              <div className="flex items-center justify-between text-sm"><span>{s.name}</span><span className="tabular-nums">{s.count} / {s.needed}</span></div>
              <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: Math.min(100, (s.count / s.needed) * 100) + '%' }} /></div>
            </div>
          ))}
        </Card>
      )}
      <RedemptionsCard m={m} rows={data.redemptions} canChange={canChange} onDone={refresh} />
      <Card title="History" testId="loy-ledger">
        {!data.ledger.length ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
          <div className="overflow-x-auto -mx-4">
            <table className="w-full text-sm min-w-[560px]">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-4 py-1 font-medium">When</th><th className="px-2 py-1 font-medium">What</th><th className="px-2 py-1 font-medium text-right">{label}</th><th className="px-2 py-1 font-medium">Where</th><th className="px-4 py-1 font-medium">Note</th></tr></thead>
              <tbody>
                {data.ledger.map(l => (
                  <tr key={l.id} className="border-t">
                    <td className="px-4 py-1.5 whitespace-nowrap text-xs">{dayTime(l.created_at)}</td>
                    <td className="px-2 py-1.5">{LEDGER_KIND[l.kind] || l.kind}{l.card_name ? ': ' + l.card_name : ''}{l.stamps ? ' (' + (l.stamps > 0 ? '+' : '') + l.stamps + ' stamps)' : ''}</td>
                    <td className={cn('px-2 py-1.5 text-right tabular-nums', l.points < 0 && 'text-red-700')}>{l.points ? (l.points > 0 ? '+' : '') + l.points : ''}</td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">{[l.venue_name, CHANNEL_WORD[l.channel]].filter(Boolean).join(', ')}</td>
                    <td className="px-4 py-1.5 text-xs text-muted-foreground">{l.note}{l.spend_pence ? (l.note ? ' · ' : '') + money(l.spend_pence) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {perm.canManage && <PrivacyCard m={m} isOwnerOrAdmin={perm.isOwnerOrAdmin} onDone={refresh} />}
    </div>
  )
}

function MemberProfile({ m, canChange, onSaved }) {
  const api = useApi()
  const start = useMemo(() => ({ name: m.name || '', email: m.email || '', phone: m.phone || '', notes: m.notes || '', tags: (m.tags || []).join(', ') }), [m])
  const [f, setF] = useState(start)
  useEffect(() => setF(start), [start])
  const dirty = JSON.stringify(f) !== JSON.stringify(start)
  const [confirm, setConfirm] = useState(null)   // 'newsletter' | 'close'
  const save = useMutation({
    mutationFn: () => api.patch('/loyalty/members/' + m.id, {
      name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() || null, notes: f.notes.trim() || null,
      tags: f.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20),
    }),
    onSuccess: onSaved,
  })
  const patch = useMutation({ mutationFn: body => api.patch('/loyalty/members/' + m.id, body), onSuccess: () => { setConfirm(null); onSaved() } })
  return (
    <Card title="Details" testId="loy-member-profile">
      <ReadOnlyFieldset disabled={!canChange} className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className={inputCls} data-testid="loy-m-name" /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} className={inputCls} /></Field>
          <Field label="Phone"><input type="tel" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className={inputCls} /></Field>
          <Field label="Tags" hint="Comma between tags, e.g. regular, vip"><input value={f.tags} onChange={e => setF({ ...f, tags: e.target.value })} className={inputCls} data-testid="loy-m-tags" /></Field>
        </div>
        <Field label="Notes (staff only)"><textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} className={cn(inputCls, 'min-h-[64px] py-2')} /></Field>
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div>Joined {dayTime(m.joined_at)} {JOINED_WORD[m.joined_channel] || ''}.{m.consent?.terms?.at ? ' Agreed to join on ' + day(m.consent.terms.at) + '.' : ''}</div>
          <div>Newsletter: {m.marketing_opt_in ? 'yes' + (m.consent?.marketing?.at ? ', said yes on ' + day(m.consent.marketing.at) : '') : 'no'}.</div>
          {(m.apple_saved_at || m.google_saved_at) && <div>Card in {[m.apple_saved_at && 'Apple Wallet', m.google_saved_at && 'Google Wallet'].filter(Boolean).join(' and ')}.</div>}
        </div>
        {canChange && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primaryBtn} disabled={!dirty || !f.name.trim() || save.isPending} onClick={() => save.mutate()} data-testid="loy-m-save">Save</button>
            {dirty && <button type="button" className={btn} onClick={() => setF(start)}>Discard</button>}
            {m.marketing_opt_in && (confirm === 'newsletter' ? (
              <>
                <button type="button" className={btn} onClick={() => patch.mutate({ marketing_opt_in: false })} data-testid="loy-m-unsub-yes">Yes, take them off</button>
                <button type="button" className={btn} onClick={() => setConfirm(null)}>Keep</button>
              </>
            ) : <button type="button" className={btn} onClick={() => setConfirm('newsletter')} data-testid="loy-m-unsub">Take off the newsletter</button>)}
            {m.status === 'active' ? (confirm === 'close' ? (
              <>
                <button type="button" className={cn(btn, 'text-destructive')} onClick={() => patch.mutate({ status: 'closed' })} data-testid="loy-m-close-yes">Yes, close it</button>
                <button type="button" className={btn} onClick={() => setConfirm(null)}>Keep</button>
              </>
            ) : <button type="button" className={btn} onClick={() => setConfirm('close')} data-testid="loy-m-close">Close membership</button>)
              : <button type="button" className={btn} onClick={() => patch.mutate({ status: 'active' })} data-testid="loy-m-reopen">Open again</button>}
            {confirm === 'close' && <span className="w-full text-xs text-muted-foreground">Closed: the card stops working everywhere and they are signed out. Points are kept if it is opened again.</span>}
          </div>
        )}
        <ErrorNote error={save.error || patch.error} />
      </ReadOnlyFieldset>
    </Card>
  )
}

function PointsCard({ m, label, canChange, onDone }) {
  const api = useApi()
  const [way, setWay] = useState('add')
  const [n, setN] = useState(null)
  const [note, setNote] = useState('')
  const adjust = useMutation({
    mutationFn: () => api.post('/loyalty/members/' + m.id + '/adjust', { points: way === 'add' ? n : -n, note: note.trim() }),
    onSuccess: () => { setN(null); setNote(''); onDone() },
  })
  return (
    <Card title={'Change ' + label}>
      {!canChange ? <p className="text-sm text-muted-foreground">Balance {m.points.toLocaleString()} {label}.</p> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={way} options={[{ value: 'add', label: 'Add' }, { value: 'take', label: 'Take off' }]} onChange={setWay} />
            <IntInput value={n} min={1} max={1000000} allowEmpty onChange={setN} className="w-28" placeholder="0" aria-label={label} data-testid="loy-adjust-n" />
            <span className="text-sm">{label}</span>
          </div>
          <Field label="Why" hint="Kept in the history."><input value={note} onChange={e => setNote(e.target.value)} className={inputCls} placeholder="e.g. Missed points on 12 Oct" data-testid="loy-adjust-note" /></Field>
          <button type="button" className={primaryBtn} disabled={!n || !note.trim() || adjust.isPending} onClick={() => adjust.mutate()} data-testid="loy-adjust-save">
            {way === 'add' ? 'Add ' : 'Take off '}{n || ''} {label}
          </button>
          <ErrorNote error={adjust.error} />
        </div>
      )}
    </Card>
  )
}

function RewardsCard({ m, data, rewards, canChange, onDone }) {
  const api = useApi()
  const [rewardId, setRewardId] = useState('')
  const [note, setNote] = useState('')
  const give = useMutation({
    mutationFn: () => api.post('/loyalty/members/' + m.id + '/rewards', { reward_id: rewardId, note: note.trim() || null }),
    onSuccess: () => { setRewardId(''); setNote(''); onDone() },
  })
  const takeBack = useMutation({ mutationFn: rid => api.delete('/loyalty/members/' + m.id + '/rewards/' + rid), onSuccess: onDone })
  const held = data.rewards.filter(r => r.status === 'available' || r.status === 'reserved')
  return (
    <Card title="Rewards they hold" icon={Gift} testId="loy-member-rewards">
      {!held.length ? <p className="text-sm text-muted-foreground">None right now.</p> : (
        <ul className="divide-y">
          {held.map(r => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm">{r.name}</div>
                <div className="text-xs text-muted-foreground">
                  {r.source === 'stamp_card' ? 'From a stamp card' : r.source === 'staff' ? 'Given by staff' : 'Bought'} {day(r.issued_at)}
                  {r.expires_at ? ' · until ' + day(r.expires_at) : ''}{r.status === 'reserved' ? ' · being used now' : ''}{r.note ? ' · ' + r.note : ''}
                </div>
              </div>
              {canChange && r.status === 'available' && <ConfirmDelete label={'Take back ' + r.name} confirmLabel="Take it back" onConfirm={() => takeBack.mutate(r.id)} />}
            </li>
          ))}
        </ul>
      )}
      {canChange && rewards.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <div className="text-sm font-medium">Give a reward</div>
          <select value={rewardId} onChange={e => setRewardId(e.target.value)} className={inputCls} data-testid="loy-give-reward">
            <option value="">Pick a reward</option>{rewards.filter(r => r.is_active).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input value={note} onChange={e => setNote(e.target.value)} className={inputCls} placeholder="Why (optional), e.g. Sorry for the wait" />
          <button type="button" className={primaryBtn} disabled={!rewardId || give.isPending} onClick={() => give.mutate()} data-testid="loy-give-save">Give it</button>
        </div>
      )}
      <ErrorNote error={give.error || takeBack.error} />
    </Card>
  )
}

const REDEMPTION_STATUS = { reserved: 'Waiting to be used', used: 'Used', released: 'Put back' }

function RedemptionsCard({ m, rows, canChange, onDone }) {
  const api = useApi()
  const release = useMutation({ mutationFn: rid => api.post('/loyalty/members/' + m.id + '/redemptions/' + rid + '/release', {}), onSuccess: onDone })
  if (!rows.length) return null
  return (
    <Card title="Rewards used" testId="loy-redemptions">
      <ul className="divide-y">
        {rows.map(r => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <div className="flex-1 min-w-0">
              <div className="text-sm">{r.name}{r.discount_pence ? ' · ' + money(r.discount_pence) + ' off' : ''}</div>
              <div className="text-xs text-muted-foreground">
                {REDEMPTION_STATUS[r.status]} · {CHANNEL_WORD[r.channel] || r.channel} · {dayTime(r.used_at || r.released_at || r.reserved_at)}
                {r.points ? ' · ' + r.points + ' points' : ''}{r.release_reason ? ' · ' + r.release_reason : ''}
              </div>
            </div>
            {canChange && r.status === 'reserved' && (
              <button type="button" className={btn} onClick={() => release.mutate(r.id)} disabled={release.isPending} data-testid={'loy-release-' + r.id}>Put it back</button>
            )}
          </li>
        ))}
      </ul>
      <ErrorNote error={release.error} />
    </Card>
  )
}

function PrivacyCard({ m, isOwnerOrAdmin, onDone }) {
  const api = useApi()
  const [newCard, setNewCard] = useState(false)
  const [erasing, setErasing] = useState(false)
  const [typed, setTyped] = useState('')
  const exportData = useMutation({ mutationFn: () => api.download('/loyalty/members/' + m.id + '/export', 'loyalty-member-' + m.member_no + '.json') })
  const card = useMutation({ mutationFn: () => api.post('/loyalty/members/' + m.id + '/new-card', {}), onSuccess: () => { setNewCard(false); onDone() } })
  const erase = useMutation({ mutationFn: () => api.post('/loyalty/members/' + m.id + '/erase', { confirm: typed }), onSuccess: () => { setErasing(false); setTyped(''); onDone() } })
  const active = m.status === 'active'
  return (
    <Card title="Privacy (GDPR)" testId="loy-privacy">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => exportData.mutate()} disabled={exportData.isPending} data-testid="loy-export"><Download className="w-4 h-4" /> Download their data</button>
        {active && (newCard ? (
          <>
            <button type="button" className={btn} onClick={() => card.mutate()} data-testid="loy-new-card-yes">Yes, a new card code</button>
            <button type="button" className={btn} onClick={() => setNewCard(false)}>Keep</button>
          </>
        ) : <button type="button" className={btn} onClick={() => setNewCard(true)} data-testid="loy-new-card">New card code</button>)}
        {m.status !== 'erased' && isOwnerOrAdmin && !erasing && (
          <button type="button" className={cn(btn, 'text-destructive')} onClick={() => setErasing(true)} data-testid="loy-erase">Erase this member</button>
        )}
      </div>
      {newCard && <p className="text-xs text-muted-foreground">For a lost phone or a card someone else saw: the old QR code and wallet cards stop working; the member sees the new one when they sign in.</p>}
      {erasing && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
          <p className="text-sm text-red-900">Erasing removes their name, email, phone, notes, card and sign-ins for good, and cancels their points and rewards. It can't be undone. Their past orders stay in the figures without their name.</p>
          <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Type ERASE" className={inputCls} data-testid="loy-erase-text" aria-label="Type ERASE to confirm" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="min-h-[44px] px-4 rounded-lg bg-destructive text-destructive-foreground text-sm touch-manipulation disabled:opacity-40"
              disabled={typed !== 'ERASE' || erase.isPending} onClick={() => erase.mutate()} data-testid="loy-erase-go">Erase</button>
            <button type="button" className={btn} onClick={() => { setErasing(false); setTyped('') }}>Cancel</button>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Members can also download their data and delete their account themselves in the web app.</p>
      <ErrorNote error={exportData.error || card.error || erase.error} />
    </Card>
  )
}

// ── Wallet ──────────────────────────────────────────────────────────────────

function WalletTab({ data, canManage }) {
  const s = data.programme.settings
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Members can add their card to Apple Wallet or Google Wallet; the points and stamps on it update by themselves.
        The cards use Macaroonie's accounts unless you add your own (your own Apple Pass Type ID or Google issuer).
      </p>
      {!canManage && <ReadOnlyNotice what="the wallet accounts (owners and admins with Loyalty manage can change them)" />}
      <WalletSide kind="apple" label="Apple Wallet" on={s.features.wallet_apple} status={data.wallet.apple} canManage={canManage} Form={AppleWalletForm} />
      <WalletSide kind="google" label="Google Wallet" on={s.features.wallet_google} status={data.wallet.google} canManage={canManage} Form={GoogleWalletForm} />
    </div>
  )
}

function WalletSide({ kind, label, on, status, canManage, Form }) {
  const api = useApi()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const save = useMutation({
    mutationFn: body => api.put('/loyalty/wallet/' + kind, body),
    onSuccess: () => { setEditing(false); setConfirm(false); qc.invalidateQueries({ queryKey: ['loyalty'] }) },
  })
  const where = status.source === 'own' ? 'Your own account: ' + status.own.hint
    : status.source === 'platform' ? "Macaroonie's account, in your colours and name"
    : 'No account yet: Macaroonie hasn\'t set this wallet up. Add your own to offer it now.'
  return (
    <Card title={label} icon={Wallet} testId={'loy-wallet-' + kind}
      actions={<span className={cn('text-xs rounded-full px-2 py-0.5', on ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground')}>{on ? 'On' : 'Off in Programme'}</span>}>
      <p className="text-sm" data-testid={'loy-wallet-' + kind + '-source'}>{where}</p>
      {canManage && !editing && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => setEditing(true)} data-testid={'loy-wallet-' + kind + '-own'}>{status.source === 'own' ? 'Replace our account' : 'Use our own account'}</button>
          {status.source === 'own' && (confirm ? (
            <>
              <button type="button" className={btn} onClick={() => save.mutate({ own: false })} data-testid={'loy-wallet-' + kind + '-back-yes'}>Yes, go back</button>
              <button type="button" className={btn} onClick={() => setConfirm(false)}>Keep ours</button>
            </>
          ) : <button type="button" className={btn} onClick={() => setConfirm(true)}>{status.platform ? "Go back to Macaroonie's" : 'Stop using ours'}</button>)}
        </div>
      )}
      {confirm && <p className="text-xs text-muted-foreground">Cards already in wallets keep working until they next update; new cards use {status.platform ? "Macaroonie's account" : 'nothing (the wallet buttons go)'}.</p>}
      {editing && (
        <div className="rounded-lg border p-3 space-y-2">
          <Form onSave={body => save.mutate(body)} saving={save.isPending} error={save.error?.message} testPrefix={'loy-wallet-' + kind} />
          <button type="button" className={btn} onClick={() => { setEditing(false); save.reset() }}>Cancel</button>
        </div>
      )}
      {!editing && <ErrorNote error={save.error} />}
    </Card>
  )
}
