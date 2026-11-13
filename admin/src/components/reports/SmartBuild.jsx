// src/components/reports/SmartBuild.jsx
//
// The smart builder on the New report page (docs/REPORTS.md 10): say what
// the report should show, or add a photo or PDF of a report used now, and
// Pepper builds it (POST /api/ai/reports/build, up to a minute). The answer
// shows with real data, says what it shows in one sentence
// (shared/reports/describe.js), what was assumed and what couldn't be done.
// A question's choice changes the report on the page (applyChange() in
// shared/reports/choices.js, then POST /api/reports/preview); a choice in
// words, and Change it, go back to Pepper. Then Save it, Open in the
// builder, or Start again.
//
// The answer lives in the page's own history entry (location.state.smart):
// Back from the builder, or a reload, shows it again. Nothing is saved until
// Save.
//
//   <DescribeCard catalogue={catalogue} />   above the subjects on /reports/new
//   <SmartAnswer catalogue={catalogue} smart={location.state.smart} />

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Camera, FileBarChart, FileText, Info, Loader2, Pencil, RotateCcw, Save, SlidersHorizontal, Sparkles, Upload, X,
} from 'lucide-react'
import { applyChange } from '@shared/reports/choices.js'
import { describeReport } from '@shared/reports/describe.js'
import { reportProblems, LIMITS } from '@shared/reports/spec.js'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { FileDropArea } from '@/components/FileDropArea'
import { useAiStatus } from '@/components/ai/ChatView'
import { prepareFile, sizeText } from '@/components/ai/attachments'
import { useVenues, Modal, Field, PageHeader, inputCls } from '@/components/staff/shared'
import ResultCard from '@/components/reports/ResultCard'
import { Problems, reportPath } from '@/components/reports/shared'

const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf,.pdf'
const MAX_FILES = 10
const MAX_WORDS = 2000         // what the route takes for a request
const KEEP_REQUESTS = 10       // earlier requests sent with a change
const PREVIEW_ROWS = 200

const btn = 'inline-flex items-center justify-center gap-2 h-12 min-w-[48px] px-3 rounded-lg border bg-background text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50 shrink-0'
const primaryBtn = 'inline-flex items-center justify-center gap-2 h-12 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 shrink-0'
const areaCls = 'w-full rounded-lg border bg-background px-3 py-2 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40'

// Ways to start, for the areas the person's role can report on.
const EXAMPLES = [
  { area: 'till', text: 'Net sales by day last week' },
  { area: 'till', text: 'The top 20 dishes by net sales last month' },
  { area: 'till', text: 'Net sales and checks by server yesterday' },
  { area: 'online', text: 'Online orders by day this month' },
  { area: 'bookings', text: 'Bookings by party size last month' },
]

let nextKey = 1
const key = () => 'f' + nextKey++

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1))
    r.onerror = () => reject(new Error(file.name + ' couldn\'t be read here.'))
    r.readAsDataURL(file)
  })
}

/** Seconds since `on` became true (0 while off). */
function useElapsed(on) {
  const [s, setS] = useState(0)
  useEffect(() => {
    if (!on) { setS(0); return undefined }
    const t0 = Date.now()
    const id = setInterval(() => setS(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [on])
  return s
}

/** False once the component has gone, so a late answer doesn't move the page. */
function useAlive() {
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  return alive
}

/**
 * Pepper builds (or changes) a report. The answer goes into the page's
 * history entry, which shows it. Only the latest request counts.
 */
function useSmartBuild() {
  const api = useApi()
  const location = useLocation()
  const navigate = useNavigate()
  const alive = useAlive()
  const seq = useRef(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const build = async ({ request, previous = null, files = [], requests, fileCount = 0 }) => {
    const n = ++seq.current
    setBusy(true)
    setError(null)
    try {
      const payload = []
      for (const f of files) payload.push({ name: f.name, data: await readBase64(f) })
      const out = await api.post('/ai/reports/build', {
        request, ...(previous ? { previous } : {}), ...(payload.length ? { files: payload } : {}),
      })
      if (!alive.current || n !== seq.current) return
      if (!out || !('spec' in out)) throw new Error(ASSISTANT_NAME + '\'s answer didn\'t arrive. Try again.')
      navigate(location.pathname + location.search, { replace: true, state: { smart: { ...out, requests, files: fileCount } } })
    } catch (e) {
      if (alive.current && n === seq.current) setError(e)
    } finally {
      if (alive.current && n === seq.current) setBusy(false)
    }
  }
  return { build, busy, error }
}

// ── Describe it ──────────────────────────────────────────────

export function DescribeCard({ catalogue }) {
  const { data: ai } = useAiStatus()
  const location = useLocation()
  const [text, setText] = useState(() => String(location.state?.describe?.text || '').slice(0, MAX_WORDS))
  const [files, setFiles] = useState([])        // { key, file }
  const [fileNote, setFileNote] = useState(null)
  const { build, busy, error } = useSmartBuild()
  const elapsed = useElapsed(busy)
  const fileRef = useRef(null)
  const camRef = useRef(null)

  const areas = useMemo(() => new Set(Object.values(catalogue.subjects).filter(s => s.base).map(s => s.area)), [catalogue])
  const examples = EXAMPLES.filter(x => areas.has(x.area)).slice(0, 4)

  if (!ai?.can_chat || !areas.size) return null

  const add = async list => {
    setFileNote(null)
    const room = MAX_FILES - files.length
    if (room <= 0) { setFileNote('Up to ' + MAX_FILES + ' files at a time.'); return }
    const next = []
    for (const f of [...list].slice(0, room)) {
      if (!/^image\//.test(f.type) && f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { setFileNote(f.name + ' isn\'t a photo or a PDF.'); continue }
      next.push({ key: key(), file: await prepareFile(f) })
    }
    setFiles(fs => [...fs, ...next])
  }

  // Only files: what they show is the request.
  const words = text.trim() || (files.length ? 'The report in the ' + (files.length > 1 ? 'files' : 'file') : '')
  const submit = () => {
    if (busy || !words) return
    build({ request: words, files: files.map(f => f.file), requests: [words], fileCount: files.length })
  }

  return (
    <section className="rounded-xl border bg-background" data-testid="smart-describe">
      <div className="section-head px-4 py-3 rounded-t-xl flex items-center gap-2">
        <Sparkles className="w-4 h-4 shrink-0" />
        <h2 className="text-sm font-semibold">Describe it to {ASSISTANT_NAME}</h2>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Say what the report should show, in your own words, or add a photo or PDF of a report you use now.
          {' '}{ASSISTANT_NAME} builds it and shows it with your figures. Nothing is saved until you save it.
        </p>
        <FileDropArea onFiles={add} onRefused={setFileNote} disabled={busy} kinds={['image', 'pdf']} label="Drop to add">
          <textarea value={text} onChange={e => setText(e.target.value.slice(0, MAX_WORDS))} rows={3} disabled={busy}
            onKeyDown={e => { if (!IS_TOUCH && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
            placeholder="e.g. Net sales by dish last month at each venue, the top 20" aria-label="What the report should show"
            data-testid="smart-request" className={areaCls} />
        </FileDropArea>

        {!text.trim() && !files.length && examples.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="smart-examples">
            {examples.map(x => (
              <button key={x.text} type="button" onClick={() => setText(x.text)} disabled={busy} data-testid="smart-example" data-text={x.text}
                className="min-h-[48px] px-3 rounded-full border bg-background text-sm text-left touch-manipulation hover:bg-muted disabled:opacity-50">
                {x.text}
              </button>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <ul className="divide-y rounded-lg border" data-testid="smart-files">
            {files.map(f => (
              <li key={f.key} className="flex items-center gap-2 pl-3" data-testid="smart-file" data-name={f.file.name}>
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0 truncate text-sm">{f.file.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">{sizeText(f.file.size)}</span>
                <button type="button" onClick={() => setFiles(fs => fs.filter(x => x.key !== f.key))} disabled={busy}
                  aria-label={'Remove ' + f.file.name} data-testid="smart-file-remove"
                  className="w-12 h-12 shrink-0 flex items-center justify-center text-muted-foreground touch-manipulation hover:bg-muted rounded-lg disabled:opacity-50">
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <input ref={fileRef} type="file" accept={ACCEPT} multiple className="sr-only" data-testid="smart-file-input"
          onChange={e => { const l = [...(e.target.files || [])]; e.target.value = ''; add(l) }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="sr-only"
          onChange={e => { const l = [...(e.target.files || [])]; e.target.value = ''; add(l) }} />
        <div className="relative flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="smart-add-file" className={btn}>
            <Upload className="w-4 h-4" /> Add a photo or PDF
          </button>
          {IS_TOUCH && (
            <button type="button" onClick={() => camRef.current?.click()} disabled={busy} data-testid="smart-camera" className={btn}>
              <Camera className="w-4 h-4" /> Take a photo
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={submit} disabled={busy || !words} data-testid="smart-build" className={primaryBtn}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {busy ? 'Building it… ' + elapsed + 's' : 'Build it'}
          </button>
        </div>
        {busy && <p className="text-xs text-muted-foreground text-right" data-testid="smart-building">{ASSISTANT_NAME} works out the report and runs it on your figures. It can take a minute.</p>}
        {fileNote && <p className="text-sm text-destructive" role="alert" data-testid="smart-file-note">{fileNote}</p>}
        {error && <div data-testid="smart-error"><Problems error={error} title={ASSISTANT_NAME + ' couldn\'t build it'} /></div>}
      </div>
    </section>
  )
}

// ── The answer ───────────────────────────────────────────────

function Notes({ title, items, warn, testid }) {
  if (!items?.length) return null
  const Icon = warn ? AlertTriangle : Info
  return (
    <div className={cn('rounded-lg border px-3 py-2 text-sm', warn ? 'border-amber-200 bg-amber-50 text-amber-900' : 'bg-muted/30')} data-testid={testid}>
      <p className="font-medium flex items-center gap-1.5"><Icon className="w-4 h-4 shrink-0" />{title}</p>
      <ul className={cn('mt-1', items.length > 1 && 'list-disc pl-5')}>
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </div>
  )
}

function SaveWindow({ catalogue, smart, venues, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState((smart.name || '').slice(0, LIMITS.name))
  // What it is for: the report in words, without the dates the period comes to today.
  const [description, setDescription] = useState(() => describeReport(catalogue, smart.spec, { venues }).slice(0, 1000))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const ok = !!name.trim() && !saving
  const save = async () => {
    if (!ok) return
    setSaving(true)
    setError(null)
    try {
      const out = await api.post('/reports', { name: name.trim(), description: description.trim() || null, spec: smart.spec })
      qc.setQueryData(['report', out.report.id], { report: out.report })
      qc.invalidateQueries({ queryKey: ['reports'] })
      // Saved: the report's own page takes the answer's place.
      navigate(reportPath(out.report.id), { replace: true })
    } catch (e) {
      setError(e)
      setSaving(false)
    }
  }
  return (
    <Modal title="Save the report" onClose={onClose}
      footer={<button type="button" disabled={!ok} onClick={save} data-testid="smart-save-go" className={primaryBtn}><Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save'}</button>}>
      <form onSubmit={e => { e.preventDefault(); save() }} className="space-y-4">
        <Field label="Name">
          <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={LIMITS.name} data-testid="smart-save-name" className={cn(inputCls, 'h-12')} />
        </Field>
        <Field label="What the report is for" hint="Shown under its name on the Reports page and when it is opened.">
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} maxLength={1000} data-testid="smart-save-description" className={areaCls} />
        </Field>
      </form>
      <p className="text-xs text-muted-foreground">Only you see it until you share it. You can change it in the builder any time.</p>
      <Problems error={error} title="The report wasn't saved" />
    </Modal>
  )
}

export function SmartAnswer({ catalogue, smart }) {
  const api = useApi()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: venues = [] } = useVenues()
  const { build, busy, error } = useSmartBuild()
  const alive = useAlive()
  const pseq = useRef(0)
  const [choosing, setChoosing] = useState(false)
  const [chooseError, setChooseError] = useState(null)
  const [changing, setChanging] = useState(false)
  const [changeText, setChangeText] = useState('')
  const [saving, setSaving] = useState(false)
  const elapsed = useElapsed(busy || choosing)

  const requests = Array.isArray(smart.requests) ? smart.requests : []
  const spec = smart.spec || null
  const subject = spec ? catalogue.subjects[spec.subject] : null
  const problems = useMemo(() => (spec ? reportProblems(spec) : []), [spec])
  const working = busy || choosing
  const canSave = !!spec && !smart.problem && !problems.length && !!smart.result && !working
  const canBuild = !!spec && !!subject?.base && !working

  const write = next => navigate(location.pathname + location.search, { replace: true, state: { smart: next } })

  // The report run again as it is now (a choice picked, or Refresh).
  const preview = async (next, { fresh = false } = {}) => {
    const n = ++pseq.current
    setChoosing(true)
    setChooseError(null)
    try {
      const result = await api.post('/reports/preview', { spec: next.spec, rows: PREVIEW_ROWS, ...(fresh ? { fresh: true } : {}) })
      if (!alive.current || n !== pseq.current) return
      const about = describeReport(catalogue, next.spec, { venues, periodText: result?.meta?.period?.text, currency: result?.meta?.currency })
      write({ ...next, result, about, problem: null })
    } catch (e) {
      if (alive.current && n === pseq.current) setChooseError(e)
    } finally {
      if (alive.current && n === pseq.current) setChoosing(false)
    }
  }

  // Pepper changes the report as it is, told what the person asked so far;
  // with nothing built yet, it starts again from all of it (a question of its
  // own answered).
  const changeWith = words => {
    const all = [...requests, words].map(r => String(r).slice(0, MAX_WORDS))
    const fileCount = smart.files || 0
    if (spec) build({ request: all[all.length - 1], previous: { spec, requests: all.slice(0, -1).slice(-KEEP_REQUESTS), name: smart.name || '' }, requests: all, fileCount })
    else build({ request: all.join('. ').slice(-MAX_WORDS), requests: all, fileCount })
  }

  const choose = (qi, q, choice) => {
    if (working) return
    const said = q.question + ' ' + choice.label
    if (choice.change && spec) {
      preview({
        ...smart, spec: applyChange(spec, choice.change),
        questions: (smart.questions || []).filter((_, i) => i !== qi),
        requests: [...requests, said],
      })
    } else {
      changeWith(said)
    }
  }

  const sendChange = () => {
    const words = changeText.trim()
    if (!words || working) return
    setChanging(false)
    setChangeText('')
    changeWith(words)
  }

  const startAgain = text => navigate(location.pathname + location.search, { replace: true, state: text ? { describe: { text } } : null })

  const openInBuilder = () => navigate('/reports/new?subject=' + encodeURIComponent(spec.subject), {
    state: { draft: { spec, name: smart.name || '', description: describeReport(catalogue, spec, { venues }) } },
  })

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="smart-answer">
      <PageHeader icon={FileBarChart} title="New report">
        <Link to="/reports" className={btn}>Back to Reports</Link>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 max-w-5xl space-y-4">
          <section className="rounded-xl border bg-background" data-testid="smart-card" data-working={working ? '1' : '0'}>
            <div className="section-head px-4 py-3 rounded-t-xl flex items-center gap-2">
              <Sparkles className="w-4 h-4 shrink-0" />
              <h2 className="text-sm font-semibold flex-1 min-w-0">{spec ? 'Built by ' + ASSISTANT_NAME : ASSISTANT_NAME + ' couldn\'t build it'}</h2>
            </div>
            <div className="p-4 space-y-3">
              {requests.length > 0 && (
                <div className="text-sm text-muted-foreground" data-testid="smart-asked">
                  <p className="text-[11px] font-semibold uppercase tracking-wide">You asked</p>
                  <ul className="mt-1 space-y-0.5">
                    {requests.map((r, i) => <li key={i} className="break-words">&ldquo;{r}&rdquo;</li>)}
                  </ul>
                  {smart.files > 0 && <p className="text-xs mt-1">With {smart.files} {smart.files === 1 ? 'file' : 'files'}.</p>}
                </div>
              )}

              {spec && (
                <div>
                  <p className="text-base font-semibold break-words" data-testid="smart-name">{smart.name || subject?.label}</p>
                  {smart.about && (
                    <p className="text-sm mt-1" data-testid="smart-about"><span className="font-medium">What this shows:</span> {smart.about}</p>
                  )}
                </div>
              )}

              <Notes title={'What ' + ASSISTANT_NAME + ' assumed'} items={smart.assumed} testid="smart-assumed" />
              <Notes title={'What ' + ASSISTANT_NAME + ' couldn\'t do'} items={smart.couldnt} warn testid="smart-couldnt" />
              {spec && smart.problem && (
                <div data-testid="smart-problem">
                  <Problems error={{ message: smart.problem }} title="It can't be shown yet. Change it, or open it in the builder to put it right." />
                </div>
              )}

              {(smart.questions || []).map((q, qi) => (
                <div key={qi + ':' + q.question} className="rounded-lg border px-3 py-2" data-testid="smart-question" data-question={q.question}>
                  <p className="text-sm font-medium">{q.question}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {q.choices.map(c => (
                      <button key={c.label} type="button" onClick={() => choose(qi, q, c)} disabled={working}
                        data-testid="smart-choice" data-label={c.label} data-kind={c.change ? 'change' : 'words'}
                        className="min-h-[48px] px-3 rounded-lg border bg-background text-sm text-left touch-manipulation hover:bg-muted disabled:opacity-50">
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-2 pt-1" data-testid="smart-actions">
                {spec && (
                  <button type="button" onClick={() => setSaving(true)} disabled={!canSave} data-testid="smart-save" className={primaryBtn}
                    title={canSave ? 'Save the report' : 'It can be saved once it shows'}>
                    <Save className="w-4 h-4" /> Save it
                  </button>
                )}
                {spec ? (
                  <button type="button" onClick={() => setChanging(c => !c)} disabled={working} aria-expanded={changing}
                    data-testid="smart-change-open" className={btn}>
                    <Pencil className="w-4 h-4" /> Change it
                  </button>
                ) : (
                  // Back to the box with the words in it, to say it another way (or add a file).
                  <button type="button" onClick={() => startAgain(requests[requests.length - 1] || '')} disabled={working}
                    data-testid="smart-ask-again" className={btn}>
                    <Pencil className="w-4 h-4" /> Ask in other words
                  </button>
                )}
                {spec && subject?.base && (
                  <button type="button" onClick={openInBuilder} disabled={!canBuild} data-testid="smart-open-builder" className={btn}>
                    <SlidersHorizontal className="w-4 h-4" /> Open in the builder
                  </button>
                )}
                <button type="button" onClick={() => startAgain(null)} disabled={working} data-testid="smart-start-again" className={btn}>
                  <RotateCcw className="w-4 h-4" /> Start again
                </button>
              </div>

              {changing && spec && (
                <form onSubmit={e => { e.preventDefault(); sendChange() }} className="space-y-2" data-testid="smart-change-form">
                  <Field label="What should change?">
                    <textarea value={changeText} onChange={e => setChangeText(e.target.value.slice(0, MAX_WORDS))} rows={2} autoFocus={!IS_TOUCH}
                      onKeyDown={e => { if (!IS_TOUCH && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChange() } }}
                      placeholder="e.g. Only Fridays, add guests, as a line chart"
                      data-testid="smart-change" className={areaCls} />
                  </Field>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => { setChanging(false); setChangeText('') }} data-testid="smart-change-cancel" className={btn}>Cancel</button>
                    <button type="submit" disabled={!changeText.trim() || working} data-testid="smart-change-send" className={primaryBtn}>
                      <Sparkles className="w-4 h-4" /> Change it
                    </button>
                  </div>
                </form>
              )}

              {working && (
                <p className="text-sm text-muted-foreground flex items-center gap-2" role="status" data-testid="smart-busy">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  {busy ? ASSISTANT_NAME + ' is changing the report… ' + elapsed + 's' : 'Running it again…'}
                </p>
              )}
              {error && <div data-testid="smart-error"><Problems error={error} title={ASSISTANT_NAME + ' couldn\'t change it'} /></div>}
              {chooseError && <div data-testid="smart-choice-error"><Problems error={chooseError} title="That can't be shown" /></div>}
            </div>
          </section>

          {spec && smart.result && (
            <div data-testid="smart-result">
              <ResultCard result={smart.result} fetching={choosing} stale={working} onRefresh={working ? null : () => preview(smart, { fresh: true })}
                more="The saved report shows up to 5,000, and its file has them all." />
            </div>
          )}
        </div>
      </div>

      {saving && <SaveWindow catalogue={catalogue} smart={smart} venues={venues} onClose={() => setSaving(false)} />}
    </div>
  )
}
