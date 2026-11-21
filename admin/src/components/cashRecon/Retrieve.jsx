// src/components/cashRecon/Retrieve.jsx
//
// One Retrieve button for every till system a venue's Cash Recon is linked
// to (migration 260, OUTSTANDING 44 item 6), in place of a Fill from
// Loyverse and a Fill from GloriaFood button. GET .../cash-recon/retrieve
// says which systems are linked and whether the venue skips the preview:
//   - with the preview: each system's own fill window, one after the other
//     (LoyverseFillModal, then GloriaFoodFillModal)
//   - without: POST .../cash-recon/retrieve fills straight away, and a panel
//     says what each system filled (submitted days are left as they are)
// RetrieveSettings is the Retrieve card of Cash Recon settings: skip the
// preview, the scheduled fill and its time, and what the last run did.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { Download, Loader2, X, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { LoyverseFillModal } from '@/components/cashRecon/Loyverse'
import { GloriaFoodFillModal } from '@/components/cashRecon/GloriaFood'

const MODALS = { loyverse: LoyverseFillModal, gloriafood: GloriaFoodFillModal }
const dayLabel = d => format(parseISO(d), 'EEE d MMM')
const NUMBER_WORDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six' }
const errText = e => e?.body?.error || e?.message || 'Something went wrong'

export function useRetrieve(venueId) {
  const api = useApi()
  return useQuery({
    queryKey: ['cash-retrieve', venueId],
    queryFn: () => api.get(`/venues/${venueId}/cash-recon/retrieve`),
    enabled: !!venueId,
  })
}

/** What one system's fill did, in a line. */
function sourceLine(s) {
  if (s.error) return s.label + ': ' + s.error
  const parts = []
  if (s.filled?.length) parts.push('filled ' + s.filled.map(dayLabel).join(', '))
  const submitted = (s.skipped || []).filter(x => x.reason === 'submitted').map(x => dayLabel(x.date))
  if (submitted.length) parts.push(submitted.join(', ') + ' submitted, left as is')
  const quiet = (s.skipped || []).filter(x => x.reason === 'no_sales').length
  if (quiet) parts.push(quiet + ' day' + (quiet === 1 ? '' : 's') + ' with no sales left out')
  if (s.kept?.length) parts.push('kept ' + s.kept.length + ' figure' + (s.kept.length === 1 ? '' : 's') + ' changed by hand')
  return s.label + ': ' + (parts.join('; ') || 'nothing to fill')
}

export function RetrieveButton({ venueId, dates, onApplied, compact, className }) {
  const api = useApi()
  const qc = useQueryClient()
  const { canUse } = usePermission('cash_recon')
  const { data } = useRetrieve(venueId)
  const [step, setStep] = useState(null)        // index into sources while previewing
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)    // { sources } | { error }
  const sources = data?.sources || []
  if (!canUse || !sources.length || !dates?.length) return null

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['cash-recon-daily', venueId] })
    qc.invalidateQueries({ queryKey: ['cash-recon-week-detail', venueId] })
    qc.invalidateQueries({ queryKey: ['cash-recon-week'] })
  }
  async function go() {
    if (!data.skip_preview) { setStep(0); return }
    setBusy(true); setResult(null)
    try {
      const r = await api.post(`/venues/${venueId}/cash-recon/retrieve`, { dates })
      setResult(r)
      refresh()
      onApplied?.(r)
    } catch (e) { setResult({ error: errText(e) }) }
    setBusy(false)
  }
  const next = () => setStep(s => (s == null || s + 1 >= sources.length ? null : s + 1))
  const Modal = step != null ? MODALS[sources[step]?.key] : null
  const title = 'Retrieve from ' + sources.map(s => s.label).join(' and ')

  return (
    <>
      <button type="button" onClick={go} disabled={busy} title={title} data-testid="cash-retrieve"
        data-skip-preview={data.skip_preview ? 'yes' : 'no'}
        className={cn(compact
          ? 'h-8 px-3 rounded-lg border text-xs font-semibold touch-manipulation hover:bg-muted flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50'
          : 'min-h-[48px] px-4 rounded-xl border text-sm font-medium touch-manipulation hover:bg-muted flex items-center gap-2 whitespace-nowrap disabled:opacity-50',
          className)}>
        {busy ? <Loader2 className={cn('animate-spin', compact ? 'w-3 h-3' : 'w-4 h-4')} /> : <Download className={compact ? 'w-3 h-3' : 'w-4 h-4'} />}
        Retrieve
      </button>
      {Modal && <Modal key={sources[step].key} venueId={venueId} dates={dates} onClose={next} onApplied={onApplied} />}
      {result && (
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-[26rem] z-50 rounded-xl border bg-background shadow-xl p-3 flex items-start gap-2"
          role="status" data-testid="cash-retrieve-result">
          {result.error || result.sources?.some(s => s.error)
            ? <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            : <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0 text-sm space-y-1">
            <p className="font-medium">{result.error ? 'Retrieve didn\'t work' : 'Retrieved'}</p>
            {result.error
              ? <p className="text-destructive">{result.error}</p>
              : result.sources.map(s => <p key={s.key} className={cn('text-xs', s.error ? 'text-destructive' : 'text-muted-foreground')}>{sourceLine(s)}</p>)}
          </div>
          <button type="button" onClick={() => setResult(null)} aria-label="Close"
            className="w-12 h-12 -m-2 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </>
  )
}

/** The Retrieve card of Cash Recon settings (General tab). */
export function RetrieveSettings({ venueId, onSaved, SectionCard, Toggle }) {
  const api = useApi()
  const qc = useQueryClient()
  const { isOwnerOrAdmin, canManage } = usePermission('cash_recon')
  const canEdit = isOwnerOrAdmin && canManage
  const { data } = useRetrieve(venueId)
  const [time, setTime] = useState(null)        // the time box while it is being typed
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState(null)
  if (!data) return null

  async function save(body, what) {
    setSaving(what); setError(null)
    try {
      await api.patch(`/venues/${venueId}/cash-recon/settings`, body)
      await qc.invalidateQueries({ queryKey: ['cash-retrieve', venueId] })
      onSaved?.()
      if (what === 'time') setTime(null)
    } catch (e) { setError(errText(e)) }
    setSaving(null)
  }
  const shownTime = time ?? data.auto_fill_at
  const last = data.last_auto_fill
  const linked = data.sources.map(s => s.label).join(' and ')

  return (
    <SectionCard title="Retrieve from till systems">
      <div className="space-y-4" data-testid="cash-retrieve-settings">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {linked
            ? <>Retrieve fills the day (or the week) from {linked} in one go.</>
            : <>Link Loyverse or GloriaFood in their tabs first: Retrieve and the scheduled fill use every system linked here.</>}
        </p>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Fill straight away, without the preview</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              On: Retrieve fills every day it covers at once and says what it did. Off: each system shows its figures first and you pick the days.
            </p>
          </div>
          <div className="shrink-0 mt-0.5">
            {saving === 'skip' ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              : <Toggle checked={!!data.skip_preview} onChange={v => save({ retrieve_skip_preview: v }, 'skip')} disabled={!canEdit} />}
          </div>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Scheduled fill</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Every day at the time below, fills the day just ended and the {NUMBER_WORDS[data.auto_fill_days - 1] || data.auto_fill_days - 1} days before it. A submitted day is left
              alone, and so is any figure someone changed by hand since the last fill.
            </p>
          </div>
          <div className="shrink-0 mt-0.5">
            {saving === 'auto' ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              : <Toggle checked={!!data.auto_fill} onChange={v => save({ auto_fill: v }, 'auto')} disabled={!canEdit || !data.sources.length} />}
          </div>
        </div>
        {data.auto_fill && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm" htmlFor="cash-auto-fill-at">Runs at</label>
            <input id="cash-auto-fill-at" type="time" value={shownTime} disabled={!canEdit} data-testid="cash-auto-fill-at"
              onChange={e => setTime(e.target.value)}
              className="min-h-[48px] border rounded-lg px-3 text-sm bg-background touch-manipulation" />
            {time != null && time !== data.auto_fill_at && (
              <button type="button" onClick={() => save({ auto_fill_at: time }, 'time')} disabled={saving === 'time'} data-testid="cash-auto-fill-save"
                className="min-h-[48px] px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold touch-manipulation disabled:opacity-50">
                {saving === 'time' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
              </button>
            )}
            <span className="text-xs text-muted-foreground">venue time</span>
          </div>
        )}
        {last && (
          <div className={cn('rounded-lg border p-3 text-xs space-y-1', last.error ? 'border-amber-200 bg-amber-50 text-amber-900' : 'bg-muted/30')}
            data-testid="cash-auto-fill-last">
            <p className="font-medium">Last scheduled fill: {format(new Date(last.at), 'EEE d MMM, HH:mm')}</p>
            {last.error && <p>{last.error}</p>}
            {(last.result?.sources || []).map(s => <p key={s.key}>{sourceLine(s)}</p>)}
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </SectionCard>
  )
}
