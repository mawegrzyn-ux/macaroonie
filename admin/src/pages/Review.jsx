// src/pages/Review.jsx
//
// For review (/review, Pepper-first step 5c; reports/AI first back office
// strategy.md "For review"): two tabs.
//
//   Waiting          everything the person has to look at before it takes
//                    effect (GET /api/ai/review): Pepper's Confirm cards left
//                    unanswered (they wait WAIT_DAYS now), supplier orders
//                    waiting for their approval, invoices Pepper read for a
//                    delivery not booked in. Each shows what it is, where it
//                    came from, the change (before and after), and Approve /
//                    Edit / Reject:
//                      a card     Approve = its own Confirm (the typed word
//                                 for a destructive one), Edit = open its chat,
//                                 Reject = its Cancel
//                      an order   Approve and Edit open its approval on the
//                                 Purchasing page; Reject sends it back with a
//                                 note (its own route)
//                      an invoice Open books the delivery in on its page
//                      a capture  a photo, a voice note or a line kept on the
//                                 phone (migration 281): Open in Pepper (a new
//                                 chat with it attached), or Dismiss
//                    Cards of one kind that can be undone (class reversible)
//                    can be approved together: one Confirm each, never money,
//                    pay, allergens or a deletion (those are never reversible).
//   Done by Pepper   the existing log (pages/PepperDone.jsx, embedded).
//
// Loaded on demand (rule 24): admin/src/routes/pepper.jsx.

import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { Inbox, Loader2, Check, X, Pencil, ExternalLink, Sparkles, Truck, FileText, CircleAlert, Camera, Mic, Type } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { BeforeAfter } from '@/components/ai/ActionCard'
import { useAsk } from '@/components/layout/AskBar'
import { ASSISTANT_NAME } from '@shared/assistant.js'

const PepperDone = React.lazy(() => import('@/pages/PepperDone'))

const CHAT_KEY = 'maca_ai_conversation'   // the chat the Pepper page opens (AssistantDrawer.jsx)
const BTN = 'inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-md text-sm font-medium touch-manipulation disabled:opacity-50'
const KIND_ICON = { card: Sparkles, supplier_order: Truck, invoice: FileText, capture: Camera }
const CAPTURE_ICON = { photo: Camera, voice: Mic, text: Type }
const CLASS_TEXT = {
  reversible:    { label: 'Can be undone', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  consequential: { label: 'Check before it runs', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
  destructive:   { label: 'Needs its word typed', tone: 'bg-rose-50 text-rose-800 border-rose-200' },
}
const PART_NAMES = { cards: ASSISTANT_NAME + '\'s cards', supplier_orders: 'supplier orders to approve', invoices: 'invoices to book in', captures: 'captures' }

export default function Review() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'done' ? 'done' : 'waiting'
  const api = useApi()
  const waiting = useQuery({ queryKey: ['ai-review'], queryFn: () => api.get('/ai/review'), refetchInterval: 60_000 })
  const count = waiting.data?.count ?? 0
  const pick = t => setParams(t === 'waiting' ? {} : { tab: t }, { replace: true })

  return (
    <div className="h-full overflow-y-auto bg-page" data-testid="review">
      <div className="flex items-center gap-3 px-4 sm:px-6 min-h-14 py-2 border-b bg-background max-lg:notouch:pl-14">
        <Inbox className="w-5 h-5 text-primary shrink-0" />
        <div className="min-w-0">
          <h1 className="font-semibold">For review</h1>
          <p className="text-xs text-muted-foreground truncate">What waits for you before it takes effect, and what {ASSISTANT_NAME} changed</p>
        </div>
      </div>
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex gap-1 rounded-lg border bg-background p-1" role="tablist">
          {[['waiting', 'Waiting' + (count ? ' (' + count + ')' : '')], ['done', 'Done by ' + ASSISTANT_NAME]].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => pick(k)} data-testid={'review-tab-' + k}
              className={cn(BTN, 'flex-1', tab === k ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'waiting' ? <Waiting q={waiting} /> : (
          <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}>
            <PepperDone embedded />
          </React.Suspense>
        )}
      </div>
    </div>
  )
}

function Waiting({ q }) {
  const d = q.data
  const items = d?.items || []
  // Cards that can be approved together: reversible ones of one kind, two or more.
  const groups = useMemo(() => {
    const by = new Map()
    for (const i of items) if (i.kind === 'card' && i.together) by.set(i.tool, [...(by.get(i.tool) || []), i])
    return [...by.values()].filter(g => g.length > 1)
  }, [items])
  if (q.isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading</div>
  if (q.error) return <p className="rounded-lg border bg-red-50 border-red-300 text-red-900 px-4 py-3 text-sm">Couldn&apos;t load what is waiting: {q.error.message}</p>
  return (
    <div className="space-y-4" data-testid="review-waiting">
      {groups.map(g => <Together key={g[0].tool} group={g} />)}
      <section className="rounded-lg border bg-background overflow-hidden">
        <div className="section-head px-4 py-2.5 flex items-center gap-2">
          <Inbox className="w-4 h-4 shrink-0" />
          <h2 className="font-semibold">Waiting</h2>
          <span className="text-sm opacity-80">{items.length}</span>
          <span className="ml-auto text-xs opacity-80 hidden sm:inline">{ASSISTANT_NAME}&apos;s cards wait {d?.wait_days ?? 7} days</span>
        </div>
        {!items.length ? (
          <p className="p-6 text-sm text-muted-foreground flex items-center gap-2" data-testid="review-empty">
            <Check className="w-4 h-4" /> Nothing waiting for you.
          </p>
        ) : (
          <ul className="divide-y" data-testid="review-list">
            {items.map(i => <Item key={i.kind + i.id} item={i} />)}
          </ul>
        )}
      </section>
      {(d?.not_included?.length > 0 || d?.errors?.length > 0) && (
        <p className="text-xs text-muted-foreground px-1" data-testid="review-not-included">
          {d.not_included?.length > 0 && <>Not shown, as your role can&apos;t act on them: {d.not_included.map(p => PART_NAMES[p] || p).join(', ')}. </>}
          {d.errors?.length > 0 && <>Couldn&apos;t load {d.errors.map(e => PART_NAMES[e.part] || e.part).join(', ')} just now.</>}
        </p>
      )}
      <p className="text-xs text-muted-foreground px-1">
        Price lists and menus read from a photo aren&apos;t kept as drafts yet: they are checked on their own pages as they are read.
      </p>
    </div>
  )
}

/** One Confirm call per card (a card is its own idempotency key); refreshes what depends on it. */
function useAnswer() {
  const api = useApi()
  const qc = useQueryClient()
  return async (path, body = {}) => {
    try {
      return await api.post(path, body)
    } finally {
      qc.invalidateQueries({ queryKey: ['ai-review'] })
      qc.invalidateQueries({ queryKey: ['ai-review-count'] })
      qc.invalidateQueries({ queryKey: ['pepper-done'] })
      qc.invalidateQueries({ queryKey: ['ai-conversation'] })
      qc.invalidateQueries({ queryKey: ['ops-today'] })
    }
  }
}

function Together({ group }) {
  const answer = useAnswer()
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  async function approveAll() {
    setBusy(true)
    let done = 0
    const failed = []
    for (const c of group) {
      try { await answer(`/ai/actions/${c.id}/confirm`, {}); done++ } catch (e) { failed.push(c.title + ': ' + (e?.message || 'failed')) }
    }
    setBusy(false); setSure(false)
    setResult({ done, failed })
  }
  return (
    <section className="rounded-lg border bg-background p-4 space-y-2" data-testid="review-together">
      <p className="text-sm">
        <span className="font-semibold">{group.length} cards: {group[0].label}.</span>{' '}
        <span className="text-muted-foreground">Each can be undone, so they can be approved together (one at a time, each through its own Confirm).</span>
      </p>
      {!sure ? (
        <button type="button" onClick={() => setSure(true)} className={cn(BTN, 'border hover:bg-accent')} data-testid="review-together-start">
          <Check className="w-4 h-4" /> Approve all {group.length}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Approve all {group.length}?</span>
          <button type="button" disabled={busy} onClick={approveAll} className={cn(BTN, 'bg-primary text-primary-foreground')} data-testid="review-together-yes">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Yes, approve them
          </button>
          <button type="button" disabled={busy} onClick={() => setSure(false)} className={cn(BTN, 'border hover:bg-accent')}>No</button>
        </div>
      )}
      {result && (
        <p className={cn('text-sm', result.failed.length ? 'text-red-700' : 'text-emerald-700')}>
          {result.done} approved{result.failed.length ? '. Not done: ' + result.failed.join('; ') : '.'}
        </p>
      )}
    </section>
  )
}

function Item({ item }) {
  const Icon = (item.kind === 'capture' && CAPTURE_ICON[item.capture]) || KIND_ICON[item.kind] || Inbox
  const cls = item.class && CLASS_TEXT[item.class]
  return (
    <li className="px-4 py-3 space-y-2" data-testid="review-item" data-kind={item.kind}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{item.title}</span>
            <span className="text-xs rounded-full border px-2 py-0.5 text-muted-foreground">{item.label}</span>
            {cls && <span className={cn('text-xs rounded-full border px-2 py-0.5', cls.tone)}>{cls.label}</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            {item.source}{item.at ? ' · ' + formatDistanceToNow(parseISO(item.at), { addSuffix: true }) : ''}
          </p>
        </div>
      </div>
      {item.lines?.length > 0 && <div className="text-sm text-muted-foreground space-y-0.5 pl-[3.25rem]">{item.lines.map((l, n) => <div key={n} className="break-words">{l}</div>)}</div>}
      <BeforeAfter before={item.before} after={item.after} className="pl-[3.25rem]" />
      {item.warnings?.length > 0 && (
        <div className="pl-[3.25rem] text-sm text-amber-800 flex gap-1.5"><CircleAlert className="w-4 h-4 shrink-0 mt-0.5" /><div>{item.warnings.join(' ')}</div></div>
      )}
      <div className="pl-[3.25rem]">
        {item.kind === 'card' ? <CardAnswers item={item} /> : item.kind === 'supplier_order' ? <OrderAnswers item={item} />
          : item.kind === 'capture' ? <CaptureAnswers item={item} /> : (
          <Link to={item.open} className={cn(BTN, 'bg-primary text-primary-foreground hover:opacity-90')} data-testid="review-open">
            Book the delivery in <ExternalLink className="w-4 h-4" />
          </Link>
        )}
      </div>
    </li>
  )
}

function CardAnswers({ item }) {
  const answer = useAnswer()
  const navigate = useNavigate()
  const [word, setWord] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const needsWord = item.class === 'destructive'
  async function go(path, body) {
    setBusy(true); setError(null)
    try { await answer(path, body) } catch (e) { setError(e?.message || 'Couldn\'t do that') } finally { setBusy(false) }
  }
  function edit() {
    try { localStorage.setItem(CHAT_KEY, item.conversation_id) } catch {}
    navigate('/ai')
  }
  return (
    <div className="space-y-2">
      {needsWord && (
        <label className="block text-sm">
          Type <span className="font-semibold">{item.confirm_word}</span> to approve this one
          <input value={word} onChange={e => setWord(e.target.value)} data-testid="review-word" autoComplete="off"
            className="mt-1 block w-full max-w-xs h-12 rounded-md border bg-background px-3 text-sm touch-manipulation" />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || (needsWord && !word.trim())} onClick={() => go(`/ai/actions/${item.id}/confirm`, needsWord ? { word } : {})}
          className={cn(BTN, 'bg-primary text-primary-foreground hover:opacity-90')} data-testid="review-approve">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {item.confirm_label || 'Approve'}
        </button>
        <button type="button" onClick={edit} className={cn(BTN, 'border hover:bg-accent')} data-testid="review-edit">
          <Pencil className="w-4 h-4" /> Edit in the chat
        </button>
        {!rejecting ? (
          <button type="button" onClick={() => setRejecting(true)} className={cn(BTN, 'border hover:bg-accent')} data-testid="review-reject">
            <X className="w-4 h-4" /> Reject
          </button>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="text-sm">Reject it? Nothing changes.</span>
            <button type="button" disabled={busy} onClick={() => go(`/ai/actions/${item.id}/cancel`)} className={cn(BTN, 'border border-red-300 text-red-800 hover:bg-red-50')} data-testid="review-reject-yes">Yes, reject</button>
            <button type="button" onClick={() => setRejecting(false)} className={cn(BTN, 'border hover:bg-accent')}>No</button>
          </span>
        )}
      </div>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </div>
  )
}

/** A capture (migration 281): its photo, Open in Pepper (a new chat with it), Dismiss. */
function CaptureAnswers({ item }) {
  const api = useApi()
  const answer = useAnswer()
  const ask = useAsk()
  const navigate = useNavigate()
  const [src, setSrc] = useState(null)
  const [dismissing, setDismissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!item.photo) return
    let url = null
    api.blob(item.photo).then(b => { url = URL.createObjectURL(b); setSrc(url) }).catch(() => {})
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [item.photo])   // eslint-disable-line react-hooks/exhaustive-deps
  async function open() {
    setBusy(true); setError(null)
    try {
      const r = await answer(`/ai/captures/${item.id}/open`)
      if (ask?.askPepper) ask.askPepper(r.text, { files: r.files, fresh: true })
      else navigate('/mobile/assistant', { state: { ask: { text: r.text, files: r.files, fresh: true } } })
    } catch (e) { setError(e?.message || 'Couldn\'t open it') } finally { setBusy(false) }
  }
  async function dismiss() {
    setBusy(true); setError(null)
    try { await answer(`/ai/captures/${item.id}/dismiss`) } catch (e) { setError(e?.message || 'Couldn\'t dismiss it') } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2">
      {item.photo && (src
        ? <img src={src} alt="The photo kept" className="max-h-56 max-w-full rounded-md border object-contain" data-testid="review-capture-photo" />
        : <div className="h-24 w-32 rounded-md border bg-muted animate-pulse" />)}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={open} className={cn(BTN, 'bg-primary text-primary-foreground hover:opacity-90')} data-testid="review-capture-open">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Open in {ASSISTANT_NAME}
        </button>
        {!dismissing ? (
          <button type="button" onClick={() => setDismissing(true)} className={cn(BTN, 'border hover:bg-accent')} data-testid="review-capture-dismiss">
            <X className="w-4 h-4" /> Dismiss
          </button>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="text-sm">Take it off the list?</span>
            <button type="button" disabled={busy} onClick={dismiss} className={cn(BTN, 'border border-red-300 text-red-800 hover:bg-red-50')} data-testid="review-capture-dismiss-yes">Yes, dismiss</button>
            <button type="button" onClick={() => setDismissing(false)} className={cn(BTN, 'border hover:bg-accent')}>No</button>
          </span>
        )}
      </div>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </div>
  )
}

function OrderAnswers({ item }) {
  const answer = useAnswer()
  const [note, setNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function sendBack() {
    setBusy(true); setError(null)
    try { await answer(`/purchasing/orders/${item.id}/return`, { note: note.trim() }) } catch (e) { setError(e?.message || 'Couldn\'t send it back') } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Link to={item.open} className={cn(BTN, 'bg-primary text-primary-foreground hover:opacity-90')} data-testid="review-open">
          <Check className="w-4 h-4" /> Approve on its page
        </Link>
        <Link to={item.open} className={cn(BTN, 'border hover:bg-accent')}><Pencil className="w-4 h-4" /> Edit</Link>
        <button type="button" onClick={() => setRejecting(!rejecting)} className={cn(BTN, 'border hover:bg-accent')} data-testid="review-reject">
          <X className="w-4 h-4" /> Send back
        </button>
      </div>
      {rejecting && (
        <div className="space-y-2 max-w-lg">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="Say why it is going back"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm touch-manipulation" data-testid="review-note" />
          <button type="button" disabled={busy || !note.trim()} onClick={sendBack} className={cn(BTN, 'border border-red-300 text-red-800 hover:bg-red-50')} data-testid="review-send-back">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Send it back
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </div>
  )
}
