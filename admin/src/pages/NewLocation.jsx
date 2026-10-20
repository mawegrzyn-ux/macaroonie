// src/pages/NewLocation.jsx — /new-location and /new-location/:id
//
// The venue setup wizard (routes/storeOpenings.js, shared/storeOpening.js).
// Start from scratch or like another venue, then step by step: the venue,
// the brand and theme (the group's, and optionally this venue's own web
// look), the menu (read from photos or a PDF, or the group's menus), opening
// hours, tables and booking rules, everything else (copy, set up here or
// later; devices), then check and create it in one go. Pepper is optional: a
// description fills in what the person hasn't set, and its questions show on
// top. After creating, the page shows what was done and a tickable list of
// what is left. The steps live in components/venueSetup/steps.jsx.

import { useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Store, Plus, ArrowLeft, Loader2, Check, Trash2, ChevronDown, ChevronRight, Printer, Palette, ChefHat, Clock, Table2,
  LayoutGrid, ClipboardCheck, MessageSquareText, Copy,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { useAiStatus } from '@/components/ai/ChatView'
import { printHtml } from '@/components/purchasing/shared'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import { areaLabel } from '@shared/storeOpening.js'
import { Card, ErrorLine, Working, primary, outline, btn } from '@/components/venueSetup/ui'
import {
  VenueStep, BrandStep, MenuStep, HoursStep, TablesStep, RestStep, CheckStep, CreatedCard, AreaGrid,
} from '@/components/venueSetup/steps'
import { QuestionsCard } from '@/components/venueSetup/questions'

const BASE = '/ai/store-openings'
const STEPS = [
  { key: 'venue', label: 'The venue', icon: Store },
  { key: 'brand', label: 'Brand & theme', icon: Palette },
  { key: 'menu', label: 'Menu', icon: ChefHat },
  { key: 'hours', label: 'Opening hours', icon: Clock },
  { key: 'tables', label: 'Tables and bookings', icon: Table2 },
  { key: 'rest', label: 'Everything else', icon: LayoutGrid },
  { key: 'check', label: 'Check and create', icon: ClipboardCheck },
]
const STATUS = {
  draft:     { label: 'Being set up', cls: 'bg-muted text-muted-foreground' },
  questions: { label: 'Questions',    cls: 'bg-amber-100 text-amber-900' },
  ready:     { label: 'Ready',        cls: 'bg-sky-100 text-sky-900' },
  created:   { label: 'Created',      cls: 'bg-emerald-100 text-emerald-900' },
}

// ── The list ────────────────────────────────────────────────────

function OpeningList({ openings, current, onNew, canManage }) {
  return (
    <aside className="lg:w-64 shrink-0 space-y-2" data-testid="nl-list">
      {canManage && (
        <button className={cn(primary, 'w-full')} onClick={onNew} data-testid="nl-new">
          <Plus className="w-4 h-4" />New venue
        </button>
      )}
      {openings.length === 0 && <p className="text-sm text-muted-foreground px-1">Nothing set up yet.</p>}
      {openings.map(o => (
        <Link key={o.id} to={'/new-location/' + o.id} data-testid="nl-list-item"
          className={cn('block rounded-lg border bg-background px-3 py-2.5 touch-manipulation', current === o.id && 'ring-2 ring-primary')}>
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="font-medium text-sm truncate flex-1">{o.venue_name || o.title}</span>
            {o.busy && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('text-[11px] px-1.5 py-0.5 rounded', STATUS[o.status]?.cls)}>{STATUS[o.status]?.label}</span>
            <span className="text-[11px] text-muted-foreground truncate">{new Date(o.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
          </div>
        </Link>
      ))}
    </aside>
  )
}

// ── Starting ────────────────────────────────────────────────────

function StartCard({ venues, readOnly }) {
  const api = useApi()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [template, setTemplate] = useState('')
  const start = useMutation({
    mutationFn: () => api.post(BASE + '/wizard', { template_venue_id: template || null }),
    onSuccess: o => {
      qc.setQueryData(['store-opening', o.id], o)
      qc.invalidateQueries({ queryKey: ['store-openings'] })
      nav('/new-location/' + o.id)
    },
  })
  const first = venues.length === 0
  return (
    <div className="space-y-4">
      <Card title={first ? 'Set up your first venue' : 'Set up a new venue'} icon={Store}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Step by step: the venue, {first ? 'your brand and theme' : 'its look'}, the menu (from photos or a PDF), opening hours,
            tables, and the rest. Nothing is made until you check it and press Create, and you can stop and come back.
          </p>
          {!first && (
            <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Start from">
              <button type="button" role="radio" aria-checked={template === ''} disabled={readOnly} onClick={() => setTemplate('')} data-testid="nl-scratch"
                className={cn('rounded-xl border p-4 text-left touch-manipulation min-h-[88px]', template === '' ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'bg-background')}>
                <p className="font-medium text-sm flex items-center gap-1.5"><Plus className="w-4 h-4" />From scratch</p>
                <p className="text-xs text-muted-foreground mt-1">Set each area up here, with sensible defaults.</p>
              </button>
              <div className={cn('rounded-xl border p-4 min-h-[88px]', template ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'bg-background')}>
                <p className="font-medium text-sm flex items-center gap-1.5"><Copy className="w-4 h-4" />Like a venue you have</p>
                <p className="text-xs text-muted-foreground mt-1 mb-2">Copy its setup, then change what&apos;s different.</p>
                <select value={template} onChange={e => setTemplate(e.target.value)} disabled={readOnly} data-testid="nl-template"
                  className="w-full min-h-[44px] border rounded-lg px-3 text-sm bg-background">
                  <option value="">Pick a venue</option>
                  {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            </div>
          )}
          <ErrorLine error={start.error} />
          <button className={primary} disabled={readOnly || start.isPending} onClick={() => start.mutate()} data-testid="nl-start">
            {start.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}Start
          </button>
        </div>
      </Card>
    </div>
  )
}

// ── Print ───────────────────────────────────────────────────────

function summaryHtml(o) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const p = o.plan
  const addr = [p.location.address_line1, p.location.address_line2, p.location.city, p.location.postcode, p.location.country].filter(Boolean).join(', ')
  const created = o.status === 'created'
  const rows = o.areas.map(a => '<tr><th>' + esc(a.label) + '</th><td>' + esc(created && a.result
    ? (a.result.lines?.length ? a.result.lines.join('. ') + '.' : 'Left for later.')
    : a.preview) + '</td></tr>').join('')
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(p.venue.name) + '</title><style>'
    + 'body{font:13px/1.5 system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#111;margin:18mm}h1{font-size:22px;margin:0 0 4px}'
    + 'h2{font-size:14px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.04em;color:#555}.meta{color:#555;margin:0 0 12px}'
    + 'table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid #ddd}th{width:30%;font-weight:600}'
    + 'ul{margin:0;padding-left:18px}li{margin:2px 0}.done{color:#555}@page{margin:12mm}</style></head><body>'
    + '<h1>' + esc(p.venue.name) + '</h1>'
    + '<p class="meta">' + esc([addr, p.opening_date ? 'Opens ' + p.opening_date : '', o.template ? 'Like ' + o.template.name : ''].filter(Boolean).join(' · ')) + '</p>'
    + (o.brief?.summary ? '<p>' + esc(o.brief.summary) + '</p>' : '')
    + '<h2>' + (created ? 'What was set up' : 'What will be set up') + '</h2><table>' + rows + '</table>'
    + (created && o.followups?.length
      ? '<h2>Still to do</h2><ul>' + o.followups.map(f => '<li class="' + (f.done ? 'done' : '') + '">' + (f.done ? '&#10003; ' : '') + esc(f.text) + '</li>').join('') + '</ul>' : '')
    + '<p class="meta" style="margin-top:20px">Printed on ' + new Date().toLocaleDateString('en-GB') + '</p>'
    + '</body></html>'
}

// ── The wizard ──────────────────────────────────────────────────

function StepList({ step, onGo, created }) {
  return (
    <ol className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0" aria-label="Steps" data-testid="wz-steps">
      {STEPS.map((s, i) => {
        const on = s.key === step
        const Icon = s.icon
        return (
          <li key={s.key} className="shrink-0">
            <button type="button" onClick={() => onGo(s.key)} disabled={created} aria-current={on ? 'step' : undefined} data-step={s.key}
              className={cn('w-full flex items-center gap-2 min-h-[44px] px-3 rounded-lg text-sm text-left touch-manipulation whitespace-nowrap',
                on ? 'bg-primary text-primary-foreground' : 'bg-background border hover:bg-muted')}>
              <span className={cn('inline-flex w-5 h-5 items-center justify-center rounded-full text-[11px] font-semibold shrink-0', on ? 'bg-primary-foreground text-primary' : 'bg-muted')}>{i + 1}</span>
              <Icon className="w-4 h-4 shrink-0 hidden sm:block" />
              {s.label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function WizardView({ id, venues, readOnly }) {
  const api = useApi()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const step = STEPS.some(s => s.key === params.get('step')) ? params.get('step') : 'venue'
  const guard = useRef(null)
  const [pending, setPending] = useState(null)
  const [savingAway, setSavingAway] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { data: ai } = useAiStatus()

  const { data: o, error, isLoading } = useQuery({
    queryKey: ['store-opening', id],
    queryFn: () => api.get(`${BASE}/${id}`),
    refetchInterval: q => (q.state.data?.busy ? 3000 : false),
  })
  const done = data => {
    qc.setQueryData(['store-opening', id], data)
    qc.invalidateQueries({ queryKey: ['store-openings'] })
    return data
  }
  const patch = body => api.patch(`${BASE}/${id}`, body).then(done)
  const aiStep = useMutation({ mutationFn: ({ path, body }) => api.post(`${BASE}/${id}/${path}`, body), onSuccess: done })
  const create = useMutation({
    mutationFn: () => api.post(`${BASE}/${id}/create`, {}),
    onSuccess: d => { done(d); qc.invalidateQueries({ queryKey: ['venues'] }); qc.invalidateQueries({ queryKey: ['me'] }) },
  })
  const tick = useMutation({ mutationFn: ({ key, value }) => api.patch(`${BASE}/${id}/followups/${encodeURIComponent(key)}`, { done: value }), onSuccess: done })
  const remove = useMutation({
    mutationFn: () => api.delete(`${BASE}/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['store-openings'] }); nav('/new-location') },
  })

  const setStep = key => {
    setPending(null)
    setParams(p => { const n = new URLSearchParams(p); n.set('step', key); return n }, { replace: false })
    requestAnimationFrame(() => document.querySelector('[data-testid="wz-main"]')?.scrollIntoView({ block: 'start' }))
  }
  const go = key => {
    if (key === step) return
    if (guard.current?.dirty && !readOnly) setPending(key)
    else setStep(key)
  }
  const index = STEPS.findIndex(s => s.key === step)
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, index + 1)].key)
  const back = index > 0 ? () => go(STEPS[index - 1].key) : null

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
  if (error) return <ErrorLine error={error} />
  if (!o) return null
  const created = o.status === 'created'
  const working = aiStep.isPending || o.busy
  const props = { o, venues, readOnly: readOnly || working, patch, guard, onNext: next, onBack: back }

  return (
    <div className="space-y-4 min-w-0" data-testid="nl-opening" data-status={o.status}>
      <div className="rounded-xl border bg-background p-4 flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold" data-testid="nl-title">{created ? o.venue?.name || o.plan.venue.name : o.plan.venue.name === 'New location' ? 'New venue' : o.plan.venue.name}</h2>
          <p className="text-xs text-muted-foreground">
            {o.template ? 'Like ' + o.template.name : 'From scratch'}{o.created_by_email ? ' · started by ' + o.created_by_email : ''}
          </p>
        </div>
        <span className={cn('text-xs px-2 py-1 rounded', STATUS[o.status]?.cls)}>{STATUS[o.status]?.label}</span>
        <button type="button" className={cn(outline, 'min-h-[36px] px-3')} onClick={() => printHtml(summaryHtml(o))} data-testid="nl-print"><Printer className="w-4 h-4" />Print</button>
      </div>

      {created ? (
        <>
          <CreatedCard opening={o} readOnly={readOnly} onTick={(key, value) => tick.mutate({ key, value })} />
          <Card title="What was set up" icon={LayoutGrid}>
            <AreaGrid o={o} areas={o.areas} created readOnly />
          </Card>
        </>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
          <div className="lg:w-56 shrink-0 lg:sticky lg:top-0"><StepList step={step} onGo={go} /></div>
          <div className="flex-1 min-w-0 space-y-4" data-testid="wz-main">
            {pending && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm flex flex-wrap items-center gap-2" data-testid="wz-pending">
                <span className="flex-1 min-w-[200px]">This step has changes that aren&apos;t saved.</span>
                <button type="button" className={primary} disabled={savingAway} data-testid="wz-pending-save"
                  onClick={async () => { setSavingAway(true); const ok = await guard.current?.save(); setSavingAway(false); if (ok !== false) setStep(pending) }}>
                  {savingAway && <Loader2 className="w-4 h-4 animate-spin" />}Save and go
                </button>
                <button type="button" className={outline} onClick={() => setStep(pending)} data-testid="wz-pending-discard">Don&apos;t save</button>
                <button type="button" className={outline} onClick={() => setPending(null)}>Stay here</button>
              </div>
            )}
            <ErrorLine error={aiStep.error} />
            {working && <Working what={aiStep.variables?.path === 'deep-dive' ? ASSISTANT_NAME + ' is taking a closer look' : ASSISTANT_NAME + ' is filling in the steps'} />}
            {!working && o.status === 'questions' && (
              <QuestionsCard opening={o} readOnly={readOnly} onAnswer={answers => aiStep.mutate({ path: 'answers', body: { answers } })} />
            )}
            {step === 'venue' && <VenueStep key={'v' + o.updated_at} {...props} onBack={null} ai={ai}
              describing={working} onDescribe={input => aiStep.mutate({ path: 'describe', body: { input } })} />}
            {step === 'brand' && <BrandStep {...props} />}
            {step === 'menu' && <MenuStep {...props} />}
            {step === 'hours' && <HoursStep key={'h' + o.updated_at} {...props} />}
            {step === 'tables' && <TablesStep key={'t' + o.updated_at} {...props} />}
            {step === 'rest' && <RestStep key={'r' + o.updated_at} {...props} onDeepDive={area => aiStep.mutate({ path: 'deep-dive', body: { area } })} />}
            {step === 'check' && <CheckStep o={o} readOnly={readOnly} onBack={back} onGo={setStep}
              creating={create.isPending} error={create.error} onCreate={() => create.mutate()} />}
          </div>
        </div>
      )}

      {o.history?.length > 0 && <HistoryCard opening={o} />}

      {!created && !readOnly && (
        <div className="flex justify-end">
          {!confirmDelete ? (
            <button className={cn(outline, 'text-red-700')} onClick={() => setConfirmDelete(true)} data-testid="nl-delete"><Trash2 className="w-4 h-4" />Delete this draft</button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
              <span>Delete this draft? Nothing has been created yet.</span>
              <button className={cn(btn, 'bg-red-600 text-white')} onClick={() => remove.mutate()} data-testid="nl-delete-yes">Delete</button>
              <button className={outline} onClick={() => setConfirmDelete(false)}>Keep it</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HistoryCard({ opening }) {
  const [open, setOpen] = useState(false)
  const qText = new Map(opening.history.flatMap(h => h.questions.map(q => [q.id, q.text])))
  const KIND = { scope: 'First look', answers: 'Answers', deep_dive: 'Closer look', change: 'Change asked for' }
  return (
    <section className="rounded-xl border bg-background">
      <button type="button" onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-4 min-h-[48px] text-sm font-medium touch-manipulation" aria-expanded={open}>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}<MessageSquareText className="w-4 h-4" />{ASSISTANT_NAME}&apos;s help
        <span className="text-xs text-muted-foreground font-normal">({opening.history.length} {opening.history.length === 1 ? 'step' : 'steps'})</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 text-sm">
          {opening.input && <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground mb-1">The description</p><p className="whitespace-pre-wrap">{opening.input}</p></div>}
          {opening.history.map((h, i) => (
            <div key={i} className="border-l-2 pl-3">
              <p className="text-xs text-muted-foreground">{KIND[h.kind] || h.kind}{h.area ? ': ' + areaLabel(h.area) : ''} · {new Date(h.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{h.by ? ' · ' + h.by : ''}</p>
              {h.request && <p>&quot;{h.request}&quot;</p>}
              {h.answers && Object.entries(h.answers).map(([qid, v]) => <p key={qid}><span className="text-muted-foreground">{qText.get(qid) || qid}</span> {v || <em>left to {ASSISTANT_NAME}</em>}</p>)}
              {h.summary && <p className="text-muted-foreground italic">{h.summary}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── The page ────────────────────────────────────────────────────

export default function NewLocation() {
  const api = useApi()
  const nav = useNavigate()
  const { id } = useParams()
  const { canManage, loaded } = usePermission('venues')
  const { data: openings = [] } = useQuery({ queryKey: ['store-openings'], queryFn: () => api.get(BASE) })
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const readOnly = loaded && !canManage
  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="new-location">
      <div className="flex items-center gap-3 px-4 lg:px-6 h-14 border-b shrink-0 bg-background max-lg:notouch:pl-14">
        {id && <button type="button" onClick={() => nav('/new-location')} className="p-2 -ml-2 rounded-lg touch-manipulation lg:hidden" aria-label="All venue setups"><ArrowLeft className="w-5 h-5" /></button>}
        <Store className="w-5 h-5 text-primary" />
        <h1 className="font-semibold truncate">New venue</h1>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 lg:p-6 flex flex-col lg:flex-row gap-4 lg:gap-6 max-w-[1400px]">
          <div className={cn(id && 'hidden xl:block')}>
            <OpeningList openings={openings} current={id} canManage={canManage} onNew={() => nav('/new-location')} />
          </div>
          <main className="flex-1 min-w-0 space-y-4">
            {readOnly && <ReadOnlyNotice what="new venues" />}
            {id ? <WizardView key={id} id={id} venues={venues} readOnly={readOnly} /> : <StartCard venues={venues} readOnly={readOnly} />}
          </main>
        </div>
      </div>
    </div>
  )
}
