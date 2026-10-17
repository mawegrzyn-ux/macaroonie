// src/components/menus/MenuPublish.jsx
//
// Menu publishing (migration 165). The menu tables are the draft the Menus
// page edits; guests, the till, Deliveroo, cooking checks and the allergen
// lookup see the live version, which only changes when a menu is published
// (now or at a set time).
//
//   PublishButton    the menu editor's Publish button, next to Save: a small
//                    badge with the number of saved changes not live yet (a
//                    dot when never published, a clock when a publish is
//                    scheduled); it opens the Publishing window: what is
//                    live, the changes waiting, Publish now / Schedule,
//                    scheduled publishes (cancel), earlier publishes (copy
//                    back into the editor), Discard changes.
//   PublishBadges    status chips for the Menus list (GET /menus?status=1).
//   useOpenPreview() opens the print page for the saved draft or a given
//                    publish through an hour-long preview link.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  Loader2, Send, CalendarClock, Undo2, ChevronDown, ChevronRight, Printer, X, CheckCircle2, AlertTriangle, Upload,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DateButton } from '@/components/purchasing/shared'

const when = iso => (iso ? format(typeof iso === 'string' ? parseISO(iso) : iso, 'EEE d MMM yyyy, HH:mm') : '')
const short = iso => (iso ? format(typeof iso === 'string' ? parseISO(iso) : iso, 'd MMM, HH:mm') : '')
const errText = e => e?.body?.error || e?.message || 'Something went wrong'

const KIND_STYLE = {
  price:   'text-amber-800 bg-amber-50 border-amber-200',
  options: 'text-amber-800 bg-amber-50 border-amber-200',
  added:   'text-emerald-800 bg-emerald-50 border-emerald-200',
  removed: 'text-red-800 bg-red-50 border-red-200',
}
const KIND_LABEL = { price: 'Price', options: 'Options', added: 'Added', removed: 'Removed', section: 'Section', menu: 'Menu', dish: 'Dish', notes: 'Notes' }

/** Opens the print page (or the dietary list) for the saved draft or a publish. */
export function useOpenPreview() {
  const api = useApi()
  return async (menuId, { releaseId = null, view = null, design = null } = {}) => {
    // Open the tab now: a tab opened after the request returns is a pop-up
    // most browsers block.
    const tab = window.open('', '_blank')
    try {
      const r = await api.post(`/menus/${menuId}/preview-link`, { release_id: releaseId })
      const url = r.path + (view ? '&view=' + view : '') + (design ? '&design=' + design : '')
      if (tab) tab.location.href = url
      else window.location.href = url
    } catch (e) {
      tab?.close()
      console.error('Preview link failed', e)
    }
  }
}

/** Chips for the Menus list. */
export function PublishBadges({ menu }) {
  const p = menu.publish
  if (!p) return null
  return (
    <>
      {!p.live_at
        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">NOT PUBLISHED</span>
        : p.changed
          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium" title="The menu has changes that aren't live yet">LIVE · CHANGES NOT PUBLISHED</span>
          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">LIVE</span>}
      {p.scheduled_at && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium" title="A publish is scheduled">
          GOES LIVE {short(p.scheduled_at).toUpperCase()}
        </span>
      )}
      {!menu.is_published && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium" title="Shown to guests is off">HIDDEN FROM GUESTS</span>
      )}
    </>
  )
}

/** Inline "are you sure" row (Standard Design Rule 6). */
function Confirm({ text, yes, onYes, onNo, busy, tone = 'primary' }) {
  return (
    <div className={cn('rounded-lg border p-3 space-y-2', tone === 'destructive' ? 'border-destructive/40 bg-destructive/5' : 'border-primary/30 bg-primary/5')}>
      <p className="text-sm">{text}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onYes} disabled={busy}
          className={cn('inline-flex items-center gap-1.5 rounded-md px-4 min-h-[44px] text-sm font-medium touch-manipulation disabled:opacity-50',
            tone === 'destructive' ? 'bg-destructive text-white' : 'bg-primary text-primary-foreground')}>
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{yes}
        </button>
        <button type="button" onClick={onNo} disabled={busy}
          className="rounded-md px-4 min-h-[44px] text-sm border bg-background touch-manipulation">Cancel</button>
      </div>
    </div>
  )
}

const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)

/** The publishing status of a menu (shared by the button and its window). */
function usePublishStatus(menuId) {
  const api = useApi()
  return useQuery({
    queryKey: ['menu-publish', menuId],
    queryFn: () => api.get(`/menus/${menuId}/publish`),
  })
}

/** What the status says in a few words, with its colour. */
function statusLine(st) {
  if (!st) return null
  const n = (st.changes || []).length
  if (!st.live) return { tone: 'muted', text: 'Not published yet' }
  if (!st.in_sync) return { tone: 'amber', text: `${n} change${n === 1 ? '' : 's'} not live` }
  return { tone: 'green', text: 'Live, nothing waiting' }
}

function StatusChip({ st }) {
  const line = statusLine(st)
  if (!line) return null
  return line.tone === 'green'
    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="w-4 h-4" /> {line.text}</span>
    : line.tone === 'amber'
      ? <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><AlertTriangle className="w-4 h-4" /> {line.text}</span>
      : <span className="text-xs font-medium text-muted-foreground">{line.text}</span>
}

/**
 * The editor's Publish button (next to Save) and its Publishing window.
 * The badge counts the saved changes that aren't live yet; a dot means the
 * menu was never published; a clock means a publish is scheduled. dirty =
 * the editor has unsaved changes: publishing uses the saved menu, so the
 * window asks for a save first.
 */
export function PublishButton({ menuId, dirty, canManage }) {
  const { data: st } = usePublishStatus(menuId)
  const [open, setOpen] = useState(false)
  const changes = (st?.changes || []).length
  const waiting = !!st && !st.in_sync
  const scheduled = (st?.scheduled || [])[0]
  const callToAction = canManage && waiting && !dirty
  const label = canManage ? 'Publish' : 'Publishing'
  const title = !st ? label
    : [statusLine(st).text, scheduled && 'goes live ' + when(scheduled.goes_live_at)].filter(Boolean).join(' · ')

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={title} data-testid="publish-button"
        className={cn('relative inline-flex items-center gap-1.5 text-sm px-3 min-h-[44px] rounded-md touch-manipulation',
          callToAction ? 'bg-primary text-primary-foreground font-medium hover:bg-primary/90'
            : 'text-muted-foreground hover:text-foreground')}>
        <Upload className="w-3.5 h-3.5" /> {label}
        {scheduled && <CalendarClock className={cn('w-3.5 h-3.5', callToAction ? '' : 'text-blue-600')} aria-label="A publish is scheduled" />}
        {st && !st.live
          ? <span className="w-2 h-2 rounded-full bg-amber-500" aria-label="Not published yet" data-testid="publish-indicator" />
          : waiting && changes > 0 && (
            <span data-testid="publish-indicator" aria-label={`${changes} change${changes === 1 ? '' : 's'} not live`}
              className={cn('min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold leading-[18px] text-center',
                callToAction ? 'bg-background text-primary' : 'bg-amber-500 text-white')}>
              {changes > 99 ? '99+' : changes}
            </span>
          )}
      </button>
      {open && <PublishWindow menuId={menuId} dirty={dirty} canManage={canManage} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * The Publishing window (Standard Design Rule 9: scrolls inside 85vh). It
 * goes into document.body: the button sits in the editor's sticky top bar,
 * whose backdrop blur would make a position: fixed window fixed to the bar
 * instead of the screen.
 */
function PublishWindow({ menuId, dirty, canManage, onClose }) {
  const { data: st } = usePublishStatus(menuId)
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      role="dialog" aria-modal="true" aria-label="Publishing"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full sm:max-w-2xl bg-background rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b section-head rounded-t-2xl">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Publishing</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Changes you save are a draft. Guests, the till and Deliveroo see the menu once it is published.
            </p>
            <div className="mt-1"><StatusChip st={st} /></div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="shrink-0 h-11 w-11 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <PublishContent menuId={menuId} dirty={dirty} canManage={canManage} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The window's contents: status, changes, actions, scheduled, history. */
function PublishContent({ menuId, dirty, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const openPreview = useOpenPreview()
  const { data: st, isLoading, error } = usePublishStatus(menuId)
  const [mode, setMode] = useState(null)      // null | 'now' | 'schedule' | 'discard' | { cancel: id } | { restore: id }
  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [showAll, setShowAll] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const refresh = (restored = false) => {
    qc.invalidateQueries({ queryKey: ['menu-publish', menuId] })
    qc.invalidateQueries({ queryKey: ['menus'] })
    qc.invalidateQueries({ queryKey: ['allergen-matrix', menuId] })
    if (restored) qc.invalidateQueries({ queryKey: ['menu', menuId] })
  }
  const publish = useMutation({
    mutationFn: (body) => api.post(`/menus/${menuId}/publish`, body),
    onSuccess: () => { setMode(null); setNote(''); refresh() },
  })
  const cancel = useMutation({
    mutationFn: (releaseId) => api.delete(`/menus/${menuId}/releases/${releaseId}`),
    onSuccess: () => { setMode(null); refresh() },
  })
  const restore = useMutation({
    mutationFn: (releaseId) => api.post(`/menus/${menuId}/releases/${releaseId}/restore`),
    onSuccess: (m) => { setMode(null); qc.setQueryData(['menu', menuId], m); refresh(true) },
  })
  const busy = publish.isPending || cancel.isPending || restore.isPending
  const failed = publish.error || cancel.error || restore.error

  if (isLoading) {
    return <div className="p-5 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /></div>
  }
  if (error || !st) {
    return <div className="p-5 text-sm text-destructive">Couldn't load the publishing status: {errText(error)}</div>
  }

  const live = st.live
  const changes = st.changes || []
  const waiting = !st.in_sync
  const scheduled = st.scheduled || []
  const history = (st.history || []).filter(h => h.state !== 'scheduled')
  const shown = showAll ? changes : changes.slice(0, 8)
  const priceChanges = changes.filter(c => c.kind === 'price' || c.kind === 'options').length
  const nextScheduled = scheduled[0]
  const scheduleAt = date && time ? new Date(`${date}T${time}:00`) : null
  const scheduleInPast = scheduleAt && scheduleAt <= new Date()
  const today = format(new Date(), 'yyyy-MM-dd')

  function startSchedule() {
    setMode('schedule')
    if (!date) setDate(format(new Date(Date.now() + 86_400_000), 'yyyy-MM-dd'))
  }

  return (
    <div data-testid="publish-panel">
      <div className="p-5 space-y-4">
        <p className="text-sm">
          {live
            ? <>Live version published {when(live.goes_live_at)}.{!live.is_published && ' It is set to hidden from guests.'}</>
            : <>Never published: this menu isn't on the website, online ordering, the till or Deliveroo yet.</>}
        </p>

        {waiting && changes.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {live ? 'Waiting to go live' : 'What goes live'}
            </p>
            <ul className="space-y-1.5" data-testid="publish-changes">
              {shown.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className={cn('shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border',
                    KIND_STYLE[c.kind] || 'text-muted-foreground bg-muted border-transparent')}>{KIND_LABEL[c.kind] || c.kind}</span>
                  <span className="min-w-0 break-words">{c.text}</span>
                </li>
              ))}
            </ul>
            {changes.length > 8 && (
              <button type="button" onClick={() => setShowAll(x => !x)}
                className="text-xs text-primary underline min-h-[36px] touch-manipulation">
                {showAll ? 'Show fewer' : `Show all ${changes.length}`}
              </button>
            )}
          </div>
        )}

        {canManage && dirty && (
          <p className="text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2">
            You have unsaved changes. Save them first: publishing uses the saved menu.
          </p>
        )}

        {canManage && waiting && !dirty && (
          <div className="space-y-3">
            {mode === 'now' ? (
              <Confirm busy={busy}
                text={<>
                  Publish {live ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'this menu'} now? The website, online ordering, the till and Deliveroo switch straight away.
                  {priceChanges > 0 && <> {priceChanges} price change{priceChanges === 1 ? '' : 's'}.</>}
                  {nextScheduled && <><br /><strong>A publish is scheduled for {when(nextScheduled.goes_live_at)}.</strong> It still goes live then and replaces this one.</>}
                </>}
                yes="Yes, publish now"
                onYes={() => publish.mutate({ note: note.trim() || null })}
                onNo={() => setMode(null)} />
            ) : mode === 'schedule' ? (
              <div className="rounded-lg border p-3 space-y-3">
                <p className="text-sm font-medium">Go live at</p>
                <div className="flex flex-wrap items-center gap-2">
                  <DateButton value={date} onChange={setDate} min={today} label="Publish date" />
                  <select value={time} onChange={e => setTime(e.target.value)} aria-label="Publish time"
                    className="h-11 px-3 rounded-lg border bg-background text-sm touch-manipulation">
                    {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <p className="text-xs text-muted-foreground">
                  The live menu stays as it is until then. Changes you save after scheduling aren't included unless you publish again.
                </p>
                {scheduleInPast && <p className="text-xs text-destructive">That time has passed.</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy || !scheduleAt || scheduleInPast}
                    onClick={() => publish.mutate({ at: scheduleAt.toISOString(), note: note.trim() || null })}
                    className="inline-flex items-center gap-1.5 rounded-md px-4 min-h-[44px] text-sm font-medium bg-primary text-primary-foreground touch-manipulation disabled:opacity-50">
                    {publish.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Schedule for {scheduleAt && !scheduleInPast ? when(scheduleAt) : '...'}
                  </button>
                  <button type="button" onClick={() => setMode(null)} disabled={busy}
                    className="rounded-md px-4 min-h-[44px] text-sm border bg-background touch-manipulation">Cancel</button>
                </div>
              </div>
            ) : mode === 'discard' ? (
              <Confirm busy={busy} tone="destructive"
                text="Put the live menu back into the editor? The changes listed above are lost."
                yes="Yes, discard changes"
                onYes={() => restore.mutate(live.release_id)}
                onNo={() => setMode(null)} />
            ) : (
              <>
                <input value={note} onChange={e => setNote(e.target.value)} maxLength={200}
                  placeholder="Note (optional), e.g. New prices from April"
                  className="w-full text-sm border rounded-md px-3 min-h-[44px] bg-background touch-manipulation" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setMode('now')}
                    className="inline-flex items-center gap-1.5 rounded-md px-4 min-h-[44px] text-sm font-medium bg-primary text-primary-foreground touch-manipulation">
                    <Send className="w-4 h-4" /> Publish now
                  </button>
                  <button type="button" onClick={startSchedule}
                    className="inline-flex items-center gap-1.5 rounded-md px-4 min-h-[44px] text-sm border bg-background touch-manipulation">
                    <CalendarClock className="w-4 h-4" /> Schedule
                  </button>
                  <button type="button" onClick={() => openPreview(menuId)}
                    className="inline-flex items-center gap-1.5 rounded-md px-4 min-h-[44px] text-sm border bg-background touch-manipulation">
                    <Printer className="w-4 h-4" /> Preview print
                  </button>
                  {live && (
                    <button type="button" onClick={() => setMode('discard')}
                      className="inline-flex items-center gap-1.5 rounded-md px-4 min-h-[44px] text-sm text-destructive border border-destructive/30 bg-background touch-manipulation">
                      <Undo2 className="w-4 h-4" /> Discard changes
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {failed && <p className="text-sm text-destructive">{errText(failed)}</p>}

        {scheduled.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Scheduled</p>
            {scheduled.map(s => (
              <div key={s.id} className="rounded-lg border px-3 py-2 space-y-2" data-testid="publish-scheduled">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium flex items-center gap-1.5"><CalendarClock className="w-4 h-4 text-blue-600" /> Goes live {when(s.goes_live_at)}</p>
                    <p className="text-xs text-muted-foreground">{[s.note, s.published_by && 'by ' + s.published_by].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => openPreview(menuId, { releaseId: s.id })}
                      className="inline-flex items-center gap-1 px-3 min-h-[44px] text-sm rounded-md border bg-background touch-manipulation">
                      <Printer className="w-4 h-4" /> Preview
                    </button>
                    {canManage && (
                      <button type="button" onClick={() => setMode({ cancel: s.id })}
                        className="inline-flex items-center gap-1 px-3 min-h-[44px] text-sm rounded-md border border-destructive/30 text-destructive bg-background touch-manipulation">
                        <X className="w-4 h-4" /> Cancel
                      </button>
                    )}
                  </div>
                </div>
                {mode?.cancel === s.id && (
                  <Confirm busy={busy} tone="destructive"
                    text={`Cancel the publish on ${when(s.goes_live_at)}? The live menu stays as it is; the draft isn't changed.`}
                    yes="Yes, cancel it" onYes={() => cancel.mutate(s.id)} onNo={() => setMode(null)} />
                )}
              </div>
            ))}
          </div>
        )}

        {history.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowHistory(x => !x)}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground min-h-[44px] touch-manipulation">
              {showHistory ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Publish history ({history.length})
            </button>
            {showHistory && (
              <ul className="divide-y border rounded-lg" data-testid="publish-history">
                {history.map(h => (
                  <li key={h.id} className="px-3 py-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <div className="min-w-0 text-sm">
                        <p>
                          <span className={cn('text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded mr-2',
                            h.state === 'live' ? 'bg-emerald-100 text-emerald-700'
                              : h.state === 'cancelled' ? 'bg-muted text-muted-foreground line-through' : 'bg-muted text-muted-foreground')}>
                            {h.state === 'live' ? 'Live' : h.state === 'cancelled' ? 'Cancelled' : 'Earlier'}
                          </span>
                          {when(h.goes_live_at)}
                        </p>
                        <p className="text-xs text-muted-foreground">{[h.note, h.published_by && 'by ' + h.published_by].filter(Boolean).join(' · ')}</p>
                      </div>
                      {h.state !== 'cancelled' && (
                        <div className="flex gap-1">
                          <button type="button" onClick={() => openPreview(menuId, { releaseId: h.id })}
                            className="inline-flex items-center gap-1 px-3 min-h-[44px] text-sm rounded-md border bg-background touch-manipulation">
                            <Printer className="w-4 h-4" /> Preview
                          </button>
                          {canManage && h.state !== 'live' && (
                            <button type="button" disabled={dirty} onClick={() => setMode({ restore: h.id })}
                              title={dirty ? 'Save or undo your changes first' : 'Put this version into the editor'}
                              className="inline-flex items-center gap-1 px-3 min-h-[44px] text-sm rounded-md border bg-background touch-manipulation disabled:opacity-50">
                              <Undo2 className="w-4 h-4" /> Copy into editor
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {mode?.restore === h.id && (
                      <Confirm busy={busy}
                        text={`Replace the menu in the editor with the version published ${when(h.goes_live_at)}? Nothing goes live until you publish it.`}
                        yes="Yes, copy it in" onYes={() => restore.mutate(h.id)} onNo={() => setMode(null)} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

