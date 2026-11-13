// src/pages/ReportBuilder.jsx
//
// The report builder (docs/REPORTS.md 9):
//
//   /reports/new                 what the report is about
//   /reports/new?subject=<key>   a new report about that
//   /reports/new?from=<id>       a new report that starts as a copy of one
//                                (a starter, or a report the person can't change)
//   /reports/:id/edit            a saved report
//
// Three parts: the Data panel (everything a report about its subject can
// use), the preview (the report as it runs now, a moment after each change),
// and Set up (its shelves and the rest). Wide enough, they sit side by side
// and fields drag from the Data panel onto the shelves; narrower, they are
// three tabs and fields are added with a tap. The preview can be tapped into
// the way the saved report can (components/reports/drill.jsx), so what a
// tapped row opens is tried here before it is saved.
//
// The builder never writes a definition by hand: every change is an edit in
// shared/reports/build.js, which gives back a whole checked definition.
// Nothing is saved until Save.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, pointerWithin, closestCenter,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { ChevronLeft, Save, CopyPlus, Eye, FileText, PanelLeftClose, PanelLeftOpen, ChevronRight, FileBarChart } from 'lucide-react'
import {
  dataTree, startReport, paramInputs, setParamDefault, setKind, addRow, addColumn, addValue, addFilter,
  moveRow, moveColumn, moveValue, roomLeft, addDrillLevel, moveDrillLevel, setDrillRows,
} from '@shared/reports/build.js'
import { normaliseReport, reportProblems, rowId, LIMITS } from '@shared/reports/spec.js'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { usePepperPage } from '@/lib/pepperPage'
import { useVenues, Modal, Field, PageHeader, inputCls } from '@/components/staff/shared'
import ResultCard from '@/components/reports/ResultCard'
import { DrillTrail, DrillWindow, drillBody, drillChoices, stepOf } from '@/components/reports/drill'
import ParamInputs, { showsInputs } from '@/components/reports/ParamInputs'
import DataPanel from '@/components/reports/builder/DataPanel'
import SetUp, { accepts } from '@/components/reports/builder/SetUp'
import { RowWindow, ValueWindow, FilterWindow } from '@/components/reports/builder/Windows'
import { Problems, reportPath, editPath, retryUnlessRefused } from '@/components/reports/shared'
import { DescribeCard, SmartAnswer } from '@/components/reports/SmartBuild'
import { useAiStatus } from '@/components/ai/ChatView'
import { cn } from '@/lib/utils'

const WIDE = 860          // the three parts side by side from this much room
const ROOMY = 1000        // the Data panel open to begin with from this much
const PREVIEW_ROWS = 200
const PREVIEW_WAIT = 600  // ms after the last change before the preview runs

const btn = 'inline-flex items-center justify-center gap-2 h-12 min-w-[48px] px-3 rounded-lg border bg-background text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50 shrink-0'
const primaryBtn = 'inline-flex items-center gap-2 h-12 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 shrink-0'

// The room the page has (the app's own menu takes some), not the window's.
function useWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    setWidth(el.getBoundingClientRect().width)
    const watch = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  return [ref, width]
}

const shelfOf = id => {
  const s = String(id)
  if (s.startsWith('shelf:')) return s.slice(6)
  if (s.startsWith('row:')) return 'rows'
  if (s.startsWith('col:')) return 'columns'
  if (s.startsWith('val:')) return 'values'
  if (s.startsWith('drill:')) return 'drill'
  if (s.startsWith('drillrow:')) return 'drillrows'
  return null
}
// The two lists that say what a tapped row opens into.
const drillShelf = shelf => shelf === 'drill' || shelf === 'drillrows'
const NO_STEPS = []

// Where a drag is: the entry under the pointer, else the shelf under it,
// else (the keyboard) whatever is nearest.
const collide = args => {
  const hits = pointerWithin(args)
  if (!hits.length) return closestCenter(args)
  const entries = hits.filter(h => !String(h.id).startsWith('shelf:'))
  return entries.length ? entries : hits
}

const SHELF_TITLES = {
  rows: 'Add a grouping', columns: 'Put a grouping across the top', values: 'Add a value', filters: 'Add a filter',
  drill: 'Break a tapped row down by', drillrows: 'A column of the rows behind a tapped row',
}

// ── What the report is about ─────────────────────────────────

function SubjectPicker({ catalogue }) {
  const location = useLocation()
  const { data: ai } = useAiStatus()
  const groups = catalogue.areas
    .map(a => ({ ...a, subjects: Object.values(catalogue.subjects).filter(s => s.base && s.area === a.key) }))
    .filter(g => g.subjects.length)
  // What Pepper built: kept in this page's history entry (SmartBuild.jsx).
  const smart = location.state?.smart
  if (smart && typeof smart === 'object') return <SmartAnswer catalogue={catalogue} smart={smart} />
  const pepper = !!ai?.can_chat && groups.length > 0
  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="report-new">
      <PageHeader icon={FileBarChart} title="New report">
        <Link to="/reports" className={btn}>Back to Reports</Link>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 max-w-5xl space-y-6">
          {pepper && <DescribeCard catalogue={catalogue} />}
          <div>
            <h2 className="text-base font-semibold">{pepper ? 'Or build it yourself: what is the report about?' : 'What is the report about?'}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Each report counts one kind of thing. Pick it here; what belongs to it (its venue, its server, its dishes) can be used in the report too.
            </p>
          </div>
          {!groups.length && (
            <p className="rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground" data-testid="report-new-none">
              Your role can't see any of the areas reports are made from. An owner or admin can give access on the Access page.
            </p>
          )}
          {groups.map(g => (
            <section key={g.key} data-testid="report-new-area" data-area={g.key}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">{g.label}</h3>
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {g.subjects.map(s => (
                  <Link key={s.key} to={'/reports/new?subject=' + encodeURIComponent(s.key)} data-testid="report-new-subject" data-subject={s.key}
                    className="flex items-start gap-2 min-h-[72px] rounded-xl border bg-background px-4 py-3 touch-manipulation hover:border-primary/60 hover:bg-muted/40">
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium leading-tight">{s.label}</span>
                      {s.about && <span className="block text-xs text-muted-foreground mt-1 leading-snug">{s.about}</span>}
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
          <p className="text-sm text-muted-foreground">
            Or begin with one that is close to what you want: open a report on the <Link to="/reports" className="underline">Reports page</Link> and choose Customise.
          </p>
        </div>
      </div>
    </div>
  )
}

function Note({ children, back = '/reports' }) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={FileBarChart} title="Report builder">
        <Link to={back} className={btn}>Back</Link>
      </PageHeader>
      <div className="p-4 sm:p-6 space-y-3 max-w-3xl">{children}</div>
    </div>
  )
}

// ── The builder ──────────────────────────────────────────────

const snapshot = (name, description, spec) => JSON.stringify([name.trim(), description.trim(), spec])
const KIND_PARTS = ['kind', 'rows', 'columns', 'values', 'sort', 'limit', 'totals', 'compare', 'view']

function Builder({ catalogue, id, from, initial }) {
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: venues = [] } = useVenues()

  const [spec, setSpec] = useState(initial.spec)
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [saved, setSaved] = useState(() => snapshot(initial.name, initial.description, initial.spec))
  const dirty = snapshot(name, description, spec) !== saved

  const subject = catalogue.subjects[spec.subject]
  const tree = useMemo(() => dataTree(catalogue, spec.subject), [catalogue, spec.subject])
  // Pepper's "ask about this page": what the report is about, and the saved
  // report when it is one (the draft on screen isn't sent).
  usePepperPage({ report: { id: id || undefined, subject: spec.subject }, label: String(name || '').trim() || undefined })
  const list = spec.kind === 'list'
  const problems = useMemo(() => reportProblems(spec), [spec])

  // ── Layout: side by side with room, tabs without ──
  const [boxRef, width] = useWidth()
  const wide = width >= WIDE
  const [dataOpen, setDataOpen] = useState(null)     // null: as the room allows
  const showData = dataOpen ?? width >= ROOMY
  const [tab, setTab] = useState('setup')

  // ── A line said for a moment (a drop that can't go there) ──
  const [said, setSaid] = useState(null)
  const saidTimer = useRef(null)
  useEffect(() => () => clearTimeout(saidTimer.current), [])
  const say = text => {
    clearTimeout(saidTimer.current)
    setSaid(text)
    saidTimer.current = setTimeout(() => setSaid(null), 3500)
  }

  const change = next => { if (next && next !== spec) setSpec(next) }

  // ── Summary or list: each keeps what it had while the page is open ──
  const stash = useRef({})
  const switchKind = kind => {
    const now = list ? 'list' : 'summary'
    if (kind === now) return
    stash.current[now] = Object.fromEntries(KIND_PARTS.map(k => [k, spec[k]]))
    const kept = stash.current[kind]
    change(kept ? normaliseReport({ ...spec, ...kept }) : setKind(spec, kind, catalogue))
  }

  // ── Windows ──
  const [win, setWin] = useState(null)
  const apply = next => { change(next); setWin(null) }

  // A column for the rows behind a tapped row. With none chosen yet the
  // usual columns of a list of these are the ones it joins. `overId`: the
  // entry it was dropped on, whose place it takes.
  const addDrillRow = (node, overId = null) => {
    const chosen = spec.drill?.rows || []
    const base = chosen.length ? chosen : subject?.list || []
    if (base.includes(node.path)) return { ok: false, text: chosen.length ? 'It is one of the columns already' : 'It is one of the usual columns already' }
    if (base.length >= LIMITS.drill_rows) return { ok: false, text: 'The rows take ' + LIMITS.drill_rows + ' columns at most' }
    const next = [...base]
    const to = overId?.startsWith('drillrow:') ? base.indexOf(overId.slice(9)) : -1
    next.splice(to === -1 ? next.length : to, 0, node.path)
    change(setDrillRows(spec, next))
    return { ok: true, text: 'The rows behind a tapped row now show it' }
  }

  // What a tap in the Data panel does; what it says back, the panel says for a moment.
  const act = a => {
    const node = a.node
    if (a.type === 'row') {
      const next = addRow(spec, a.ref)
      if (next === spec) {
        const there = spec.rows.some(r => rowId(r) === rowId(a.ref))
        return { ok: false, text: there ? 'It is in the report already' : list ? 'A list takes ' + LIMITS.list_columns + ' columns at most' : 'A report takes ' + LIMITS.rows + ' groupings at most' }
      }
      change(next)
      return { ok: true, text: list ? 'Added as a column' : 'The report is grouped by it' }
    }
    if (a.type === 'column') {
      const next = addColumn(spec, a.ref)
      if (next === spec) {
        const there = spec.columns.some(r => rowId(r) === rowId(a.ref))
        return { ok: false, text: there ? 'It is across the top already' : 'Across the top takes ' + LIMITS.columns + ' at most' }
      }
      change(next)
      return { ok: true, text: 'Put across the top' }
    }
    if (a.type === 'value') {
      const next = addValue(spec, a.value)
      if (next === spec) return { ok: false, text: roomLeft(spec).values <= 0 ? 'A report takes ' + LIMITS.values + ' values at most' : 'That value is in the report already' }
      change(next)
      return { ok: true, text: 'Added as a value' }
    }
    if (a.type === 'drill') {
      const next = addDrillLevel(spec, a.ref)
      if (next === spec) {
        const there = (spec.drill?.down || []).some(x => rowId(x) === rowId(a.ref))
        return { ok: false, text: there ? 'A tapped row can be broken down by it already' : 'A row can be broken down by ' + LIMITS.drill_down + ' fields at most' }
      }
      change(next)
      return { ok: true, text: 'A tapped row can now be broken down by it' }
    }
    if (a.type === 'drillrow') return addDrillRow(node)
    if (a.type === 'filter') {
      if (node.uses.filter === 'venues') {
        if (spec.filters.some(f => f.field === node.path)) return { ok: false, text: 'The report already asks which venues' }
        const next = addFilter(spec, { field: node.path, op: 'in' }, { ask: true, venues: true })
        if (next === spec) return { ok: false, text: 'There is no room for another filter' }
        change(next)
        return { ok: true, text: 'The report now asks which venues' }
      }
      setWin({ what: 'filter', path: node.path })
    }
    return null
  }

  // ── Dragging ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [dragNode, setDragNode] = useState(null)
  const [overShelf, setOverShelf] = useState(null)
  const endDrag = () => { setDragNode(null); setOverShelf(null) }

  const dropNode = (node, shelf, overId) => {
    if (!accepts(node, shelf, spec)) {
      say(shelf === 'values' ? (list ? 'A list has no values: make it a summary to add things up' : node.full + ' can\'t be added up')
        : shelf === 'filters' ? node.full + ' can\'t be filtered by'
          : shelf === 'drill' ? 'A row can\'t be broken down by ' + node.full + ': it is a figure'
            : shelf === 'drillrows' ? node.full + ' can\'t be a column of the rows behind a row'
              : list ? node.full + ' can\'t be a column of a list' : node.full + ' can\'t be grouped by: it is a figure, so add it as a value')
      return
    }
    if (shelf === 'drill') {
      const ref = { field: node.path }
      let next = addDrillLevel(spec, ref)
      if (next === spec) { const r = act({ type: 'drill', node, ref }); if (r && !r.ok) say(r.text); return }
      if (overId.startsWith('drill:')) {
        const to = next.drill.down.findIndex(x => 'drill:' + rowId(x) === overId)
        const at = next.drill.down.findIndex(x => rowId(x) === rowId(ref))
        if (to !== -1 && at !== -1) next = moveDrillLevel(next, at, to)
      }
      change(next)
      return
    }
    if (shelf === 'drillrows') {
      const r = addDrillRow(node, overId)
      if (!r.ok) say(r.text)
      return
    }
    if (shelf === 'rows' || shelf === 'columns') {
      const ref = { field: node.path }
      const part = shelf
      const prefix = shelf === 'rows' ? 'row:' : 'col:'
      let next = shelf === 'rows' ? addRow(spec, ref) : addColumn(spec, ref)
      if (next === spec) { const r = act({ type: shelf === 'rows' ? 'row' : 'column', node, ref }); if (r && !r.ok) say(r.text); return }
      // Dropped on an entry: it takes that entry's place.
      if (overId.startsWith(prefix)) {
        const to = next[part].findIndex(r => prefix + rowId(r) === overId)
        const at = next[part].findIndex(r => rowId(r) === rowId(ref))
        if (to !== -1 && at !== -1) next = shelf === 'rows' ? moveRow(next, at, to) : moveColumn(next, at, to)
      }
      change(next)
      return
    }
    if (shelf === 'values') {
      let next = addValue(spec, node.uses.values[0])
      if (next === spec) { say(roomLeft(spec).values <= 0 ? 'A report takes ' + LIMITS.values + ' values at most' : 'That value is in the report already'); return }
      if (overId.startsWith('val:')) {
        const to = next.values.findIndex(v => 'val:' + v.key === overId)
        if (to !== -1) next = moveValue(next, next.values.length - 1, to)
      }
      change(next)
      return
    }
    const r = act({ type: 'filter', node })
    if (r && !r.ok) say(r.text)
  }

  const onDragEnd = ({ active, over }) => {
    endDrag()
    if (!over) return
    const a = String(active.id)
    const o = String(over.id)
    const target = shelfOf(o)
    if (!target) return
    if (a.startsWith('node:')) {
      const node = active.data.current?.node
      if (node) dropNode(node, target, o)
      return
    }
    const home = shelfOf(a)
    if (home === target && drillShelf(home)) {
      if (a === o || o.startsWith('shelf:')) return
      if (home === 'drill') {
        const ids = (spec.drill?.down || []).map(x => 'drill:' + rowId(x))
        change(moveDrillLevel(spec, ids.indexOf(a), ids.indexOf(o)))
        return
      }
      const paths = [...(spec.drill?.rows || [])]
      const at = paths.indexOf(a.slice(9))
      const to = paths.indexOf(o.slice(9))
      if (at === -1 || to === -1) return
      paths.splice(to, 0, ...paths.splice(at, 1))
      change(setDrillRows(spec, paths))
      return
    }
    // What a tapped row opens into is its own two lists: nothing moves between them and the report.
    if (drillShelf(home) || drillShelf(target)) {
      say(drillShelf(home) && drillShelf(target) ? 'Those are two lists. Add the field to the other one with its own Add button'
        : drillShelf(home) ? 'That list is for tapped rows. To use the field in the report itself, add it from the Data panel'
          : 'To set what a tapped row opens into, add a field there from the Data panel')
      return
    }
    if (home === target) {
      if (a === o || o.startsWith('shelf:')) return
      const ids = home === 'rows' ? spec.rows.map(r => 'row:' + rowId(r)) : home === 'columns' ? spec.columns.map(r => 'col:' + rowId(r)) : spec.values.map(v => 'val:' + v.key)
      const at = ids.indexOf(a)
      const to = ids.indexOf(o)
      if (at === -1 || to === -1) return
      change(home === 'rows' ? moveRow(spec, at, to) : home === 'columns' ? moveColumn(spec, at, to) : moveValue(spec, at, to))
      return
    }
    // A grouping carried between the rows and across the top.
    if (home === 'rows' && target === 'columns') {
      const entry = spec.rows.find(r => 'row:' + rowId(r) === a)
      const next = entry ? addColumn(spec, entry) : spec
      if (next === spec) say('Across the top takes ' + LIMITS.columns + ' at most')
      else change(next)
      return
    }
    if (home === 'columns' && target === 'rows') {
      const entry = spec.columns.find(r => 'col:' + rowId(r) === a)
      const next = entry ? addRow(spec, entry) : spec
      if (next === spec) say('A report takes ' + LIMITS.rows + ' groupings at most')
      else change(next)
      return
    }
    say(home === 'values' ? 'A value stays in Values. To group by something, add it from the Data panel' : 'A grouping can\'t be a value. Add a figure from the Data panel')
  }

  // ── The preview: the report as it is, a moment after the last change ──
  const [live, setLive] = useState(spec)
  useEffect(() => {
    const t = setTimeout(() => setLive(spec), PREVIEW_WAIT)
    return () => clearTimeout(t)
  }, [spec])
  const liveOk = useMemo(() => !reportProblems(live).length, [live])
  // The preview can be tapped into like the saved report. Where it has been
  // tapped to belongs to the definition it was tapped in: any change to the
  // report starts again from the report itself.
  const [drillAt, setDrillAt] = useState({ for: null, steps: NO_STEPS })
  const steps = drillAt.for === live ? drillAt.steps : NO_STEPS
  const drill = useMemo(() => drillBody(steps), [steps])
  const [tappedAt, setTappedAt] = useState(null)       // a row waiting for what to open it into
  const tapped = tappedAt?.for === live ? tappedAt.target : null
  const fresh = useRef(false)
  const previewQ = useQuery({
    queryKey: ['report-preview', live, drill],
    queryFn: () => api.post('/reports/preview', { spec: live, rows: PREVIEW_ROWS, ...(drill.length ? { drill } : {}), ...(fresh.current ? { fresh: true } : {}) }),
    enabled: liveOk,
    placeholderData: keepPreviousData,
    retry: false,
    gcTime: 60_000,
  })
  const result = previewQ.data
  const today = result?.meta?.today
  const currency = result?.meta?.currency
  const waiting = live !== spec || previewQ.isFetching
  const refresh = () => {
    fresh.current = true
    previewQ.refetch().finally(() => { fresh.current = false })
  }
  // One thing a row can open into: a tap goes there. More: the window asks.
  const openInto = (target, choice) => { setDrillAt({ for: live, steps: [...steps, stepOf(target, choice)] }); setTappedAt(null) }
  const onTap = target => {
    if (!target) return
    const choices = drillChoices(result)
    if (choices.length === 1) openInto(target, choices[0])
    else if (choices.length) setTappedAt({ for: live, target })
  }
  const backToStep = n => { setDrillAt({ for: live, steps: steps.slice(0, n) }); setTappedAt(null) }

  const inputs = useMemo(() => paramInputs(catalogue, spec), [catalogue, spec])
  const starts = Object.fromEntries(spec.params.map(p => [p.key, p.default]))

  // ── Saving ──
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [justSaved, setJustSaved] = useState(!!location.state?.saved)
  useEffect(() => {
    if (!justSaved) return undefined
    const t = setTimeout(() => setJustSaved(false), 4000)
    return () => clearTimeout(t)
  }, [justSaved])

  const whyNot = !name.trim() ? 'Name the report to save it' : problems.length ? 'It can\'t be saved yet: see what the preview says' : null
  const canSave = !whyNot && !saving && (!id || dirty)

  const save = async ({ asNew = false, newName = null } = {}) => {
    setSaving(true)
    setSaveError(null)
    try {
      const body = { name: (newName ?? name).trim(), description: description.trim() || null, spec }
      if (id && !asNew) {
        const out = await api.put('/reports/' + encodeURIComponent(id), body)
        qc.setQueryData(['report', id], { report: out.report })
        qc.invalidateQueries({ queryKey: ['reports'] })
        qc.removeQueries({ queryKey: ['report-run', id] })
        const kept = normaliseReport(out.report.spec)
        setSpec(kept)
        setSaved(snapshot(name, description, kept))
        setJustSaved(true)
      } else {
        const out = await api.post('/reports', { ...body, ...(!asNew && initial.starterKey ? { starter_key: initial.starterKey } : {}) })
        qc.setQueryData(['report', out.report.id], { report: out.report })
        qc.invalidateQueries({ queryKey: ['reports'] })
        setWin(null)
        // Saved: nothing here is unsaved any more, so the page may be left.
        setSaved(snapshot(name, description, spec))
        navigate(editPath(out.report.id), { replace: !id, state: { saved: true } })
      }
    } catch (error) {
      setSaveError(error)
    } finally {
      setSaving(false)
    }
  }

  // ── Leaving with changes not saved ──
  const [leaving, setLeaving] = useState(null)
  const go = to => (dirty ? setLeaving(to) : navigate(to))
  useEffect(() => {
    if (!dirty) return undefined
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  // A report Pepper built goes back to its answer (the page before), still there.
  const backTo = id ? reportPath(id) : from ? reportPath(from) : initial.fromSmart ? -1 : '/reports'

  // ── The three parts ──
  const dataPart = (
    <DataPanel tree={tree} spec={spec} onAct={act} drag={wide} className="h-full" />
  )
  const setupPart = (
    <SetUp catalogue={catalogue} spec={spec} onChange={change} onOpen={setWin} onAdd={mode => setWin({ what: 'add', mode })} onKind={switchKind}
      venues={venues} currency={currency} dragNode={dragNode} overShelf={overShelf} />
  )
  const previewPart = (
    <div className="p-3 sm:p-4 space-y-3" data-testid="builder-preview" data-waiting={waiting ? '1' : '0'}>
      {showsInputs(inputs, venues) && (
        <div data-testid="builder-starts">
          <p className="text-[11px] text-muted-foreground mb-1.5">What the report starts with. Whoever opens it can pick something else.</p>
          <div className="flex flex-wrap items-center gap-2">
            <ParamInputs catalogue={catalogue} inputs={inputs} values={starts} venues={venues} today={today} currency={currency}
              onChange={(key, value) => change(setParamDefault(spec, key, value))} />
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status" data-testid="builder-problems">
          <p className="font-medium">Not ready to show yet</p>
          <ul className={cn('mt-1', problems.length > 1 && 'list-disc pl-5')}>
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      {steps.length > 0 && (
        <div data-testid="builder-drilled">
          <p className="text-[11px] text-muted-foreground mb-1.5">What a tapped row opens. All goes back to the report; so does any change to it.</p>
          <DrillTrail steps={steps} onGo={backToStep} />
        </div>
      )}

      {!problems.length && previewQ.error && !previewQ.isFetching && <Problems error={previewQ.error} title={steps.length ? 'That can\'t be shown' : 'This report can\'t be shown'} />}

      {!problems.length && !result && previewQ.isFetching && <p className="text-sm text-muted-foreground" data-testid="report-loading">Working it out…</p>}

      {result && !(previewQ.error && !previewQ.isFetching) && (
        <ResultCard result={result} fetching={previewQ.isFetching} stale={waiting || problems.length > 0} onRefresh={problems.length ? null : refresh} onTap={onTap}
          more={'The saved report shows up to 5,000, and its file has them all.'} />
      )}
    </div>
  )

  const adding = win?.what === 'add' ? win.mode : null

  return (
    <div className="relative flex flex-col h-full overflow-hidden" data-testid="report-builder" data-layout={wide ? 'wide' : 'tabs'} data-dirty={dirty ? '1' : '0'}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 max-lg:notouch:pl-14 border-b shrink-0 min-h-[56px] bg-background">
        <button type="button" onClick={() => go(backTo)} aria-label="Back" title="Back"
          className="w-12 h-12 -ml-2 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation shrink-0">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={LIMITS.name} placeholder="Name the report" aria-label="The report's name"
          data-testid="builder-name" className={cn(inputCls, 'h-12 flex-1 min-w-[11rem] font-semibold')} />
        <button type="button" onClick={() => setWin({ what: 'details' })} data-testid="builder-details" className={btn} title="What the report is for">
          <FileText className="w-4 h-4" /><span className="hidden sm:inline">Details</span>
        </button>
        {id && (
          <button type="button" onClick={() => go(reportPath(id))} data-testid="builder-view" className={btn} title="Open the report">
            <Eye className="w-4 h-4" /><span className="hidden sm:inline">View</span>
          </button>
        )}
        {id && (
          <button type="button" onClick={() => setWin({ what: 'saveas' })} disabled={!!problems.length || saving} data-testid="builder-save-as" className={btn} title="Save as a new report">
            <CopyPlus className="w-4 h-4" /><span className="hidden sm:inline">Save as</span>
          </button>
        )}
        <button type="button" onClick={() => save()} disabled={!canSave} data-testid="builder-save" className={primaryBtn}>
          <Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save'}
        </button>
        {/* Always a line, so the bar keeps its height as the report changes. */}
        <p className={cn('basis-full text-right text-[11px] leading-tight', justSaved && !dirty ? 'text-emerald-700' : 'text-muted-foreground')} data-testid="builder-save-note">
          {justSaved && !dirty ? 'Saved' : whyNot || (!id ? 'Not saved yet' : dirty ? 'Changes not saved' : 'Nothing to save')}
        </p>
      </div>

      {leaving && (
        <div className="px-4 py-2 border-b bg-amber-50 flex flex-wrap items-center gap-2 text-sm text-amber-900 shrink-0" role="alert" data-testid="builder-leave">
          <span className="flex-1 min-w-[12rem]">Leave without saving your changes?</span>
          <button type="button" onClick={() => navigate(leaving)} data-testid="builder-leave-yes" className="h-12 px-4 rounded-lg bg-amber-600 text-white text-sm font-medium touch-manipulation">Leave</button>
          <button type="button" onClick={() => setLeaving(null)} data-testid="builder-leave-no" className="h-12 px-4 rounded-lg border bg-background text-sm touch-manipulation">Stay</button>
        </div>
      )}
      {saveError && <div className="px-4 pt-3 shrink-0"><Problems error={saveError} title="The report wasn't saved" /></div>}

      <DndContext sensors={sensors} collisionDetection={collide}
        onDragStart={({ active }) => setDragNode(active.data.current?.node || null)}
        onDragOver={({ over }) => setOverShelf(over ? shelfOf(over.id) : null)}
        onDragEnd={onDragEnd} onDragCancel={endDrag}>
        <div ref={boxRef} className="flex-1 min-h-0 flex flex-col">
          {!wide && (
            <div className="flex border-b bg-background shrink-0" role="tablist" aria-label="Parts of the builder">
              {[['data', 'Data'], ['setup', 'Set up'], ['preview', 'Preview']].map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={'builder-tab-' + key}
                  className={cn('flex-1 h-12 text-sm font-medium touch-manipulation border-b-2', tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted')}>
                  {label}
                  {key === 'preview' && problems.length > 0 && <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-amber-500 align-middle" aria-label="Not ready" />}
                </button>
              ))}
            </div>
          )}

          {wide ? (
            <div className="flex-1 min-h-0 flex">
              {showData ? (
                <aside className="w-60 shrink-0 border-r bg-background flex flex-col min-h-0" data-testid="builder-data">
                  <div className="flex items-center gap-1 pl-3 pr-1 pt-1 shrink-0">
                    <h2 className="flex-1 text-xs font-semibold">Data: {subject?.label}</h2>
                    <button type="button" onClick={() => setDataOpen(false)} aria-label="Hide the Data panel" title="Hide the Data panel" data-testid="builder-data-hide"
                      className="w-12 h-12 flex items-center justify-center rounded-lg text-muted-foreground touch-manipulation hover:bg-muted">
                      <PanelLeftClose className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0">{dataPart}</div>
                </aside>
              ) : (
                <div className="shrink-0 border-r bg-background">
                  <button type="button" onClick={() => setDataOpen(true)} aria-label="Show the Data panel" title="Show the Data panel" data-testid="builder-data-show"
                    className="w-12 h-12 m-1 flex items-center justify-center rounded-lg text-muted-foreground touch-manipulation hover:bg-muted">
                    <PanelLeftOpen className="w-4 h-4" />
                  </button>
                </div>
              )}
              <main className="flex-1 min-w-0 overflow-y-auto">{previewPart}</main>
              <aside className="w-[19rem] shrink-0 border-l bg-background overflow-y-auto" data-testid="builder-setup">{setupPart}</aside>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto" data-testid={'builder-part-' + tab}>
              {tab === 'data' && <div className="h-full bg-background">{dataPart}</div>}
              {tab === 'setup' && <div className="bg-background min-h-full">{setupPart}</div>}
              {tab === 'preview' && previewPart}
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {dragNode && (
            <div className="px-3 py-2 rounded-lg border bg-background shadow-lg text-sm font-medium max-w-[16rem] truncate" data-testid="builder-dragging">{dragNode.full}</div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Said over the page for a moment: it never moves what is under it.
          On a phone it sits above the floating Mobile view button. */}
      {said && (
        <p className="absolute left-1/2 -translate-x-1/2 bottom-4 touch:max-[700px]:bottom-[4.5rem] z-40 max-w-[min(32rem,calc(100%-2rem))] rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 shadow-lg pointer-events-none"
          role="status" data-testid="builder-said">{said}</p>
      )}

      {tapped && result && !waiting && !problems.length && (
        <DrillWindow result={result} target={tapped} onPick={choice => openInto(tapped, choice)} onClose={() => setTappedAt(null)} />
      )}

      {adding && (
        <Modal title={list && adding === 'rows' ? 'Add a column' : SHELF_TITLES[adding]} onClose={() => setWin(null)}>
          <DataPanel tree={tree} spec={spec} mode={adding} onAct={act} autoFocus={false} className="h-[60vh] -m-2" />
        </Modal>
      )}
      {win?.what === 'row' && <RowWindow key={win.where + ':' + win.id} catalogue={catalogue} spec={spec} where={win.where} id={win.id} onApply={apply} onClose={() => setWin(null)} />}
      {win?.what === 'value' && <ValueWindow key={win.key} catalogue={catalogue} spec={spec} valueKey={win.key} onApply={apply} onClose={() => setWin(null)} />}
      {win?.what === 'calc' && <ValueWindow catalogue={catalogue} spec={spec} valueKey={null} onApply={apply} onClose={() => setWin(null)} />}
      {win?.what === 'filter' && (
        <FilterWindow key={win.index ?? 'new:' + win.path} catalogue={catalogue} spec={spec} index={win.index ?? null} path={win.path ?? null} today={today}
          onApply={apply} onClose={() => setWin(null)} />
      )}
      {win?.what === 'details' && (
        <Modal title="Details" onClose={() => setWin(null)}
          footer={<button type="button" onClick={() => setWin(null)} className={primaryBtn}>Done</button>}>
          <Field label="What the report is for" hint="Shown under its name on the Reports page and when it is opened.">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} maxLength={1000} data-testid="builder-description"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </Field>
          <p className="text-xs text-muted-foreground">
            About: {subject?.label}. {subject?.about}
          </p>
        </Modal>
      )}
      {win?.what === 'saveas' && <SaveAsWindow name={name} saving={saving} error={saveError} onSave={newName => save({ asNew: true, newName })} onClose={() => setWin(null)} />}
    </div>
  )
}

function SaveAsWindow({ name, saving, error, onSave, onClose }) {
  const [text, setText] = useState((name.trim() || 'Report') + ' (copy)')
  const ok = !!text.trim() && !saving
  return (
    <Modal title="Save as a new report" onClose={onClose}
      footer={<button type="button" disabled={!ok} onClick={() => onSave(text)} data-testid="save-as-go" className={primaryBtn}>{saving ? 'Saving…' : 'Save as a new report'}</button>}>
      <p className="text-sm text-muted-foreground">
        The report as it is now, with any changes you haven't saved, becomes a new report of yours. The one you opened stays as it was last saved.
      </p>
      <form onSubmit={e => { e.preventDefault(); e.stopPropagation(); if (ok) onSave(text) }}>
        <Field label="Name of the new report">
          <input type="text" value={text} onChange={e => setText(e.target.value)} maxLength={LIMITS.name} data-testid="save-as-name" className={cn(inputCls, 'h-12')} />
        </Field>
      </form>
      <Problems error={error} title="The report wasn't saved" />
    </Modal>
  )
}

// ── The page: what to build on ───────────────────────────────

export default function ReportBuilder() {
  const { id } = useParams()
  const [query] = useSearchParams()
  const from = id ? null : query.get('from')
  const subjectKey = id || from ? null : query.get('subject')
  const api = useApi()
  const { canUse, loaded } = usePermission('reports')

  const catQ = useQuery({ queryKey: ['report-catalogue'], queryFn: () => api.get('/reports/catalogue'), staleTime: 5 * 60_000, retry: retryUnlessRefused })
  const source = id || from
  const reportQ = useQuery({
    queryKey: ['report', source], queryFn: () => api.get('/reports/' + encodeURIComponent(source)), enabled: !!source, retry: retryUnlessRefused,
  })
  const catalogue = catQ.data
  const report = reportQ.data?.report
  // A report the smart builder handed over (Open in the builder), not saved yet.
  const location = useLocation()
  const draft = !source && subjectKey ? location.state?.draft : null

  // What the builder opens on, worked out once for each thing it can open on.
  const initial = useMemo(() => {
    if (!catalogue) return null
    if (source) {
      if (!report) return null
      const copy = !id
      return {
        name: copy && report.kind !== 'starter' ? (report.name + ' (copy)').slice(0, LIMITS.name) : report.name,
        description: report.description || '',
        spec: normaliseReport(report.spec),
        starterKey: copy ? (report.starter_key || (report.kind === 'starter' ? String(report.id).replace(/^starter:/, '') : null)) : null,
      }
    }
    if (subjectKey && catalogue.subjects[subjectKey]?.base) {
      if (draft?.spec?.subject === subjectKey) {
        return {
          name: String(draft.name || '').slice(0, LIMITS.name), description: String(draft.description || '').slice(0, 1000),
          spec: normaliseReport(draft.spec), starterKey: null, fromSmart: true,
        }
      }
      return { name: '', description: '', spec: startReport(catalogue, subjectKey), starterKey: null }
    }
    return null
  }, [catalogue, report, source, id, subjectKey, draft]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loaded && !canUse) return <Navigate replace to={id ? reportPath(id) : '/reports'} />
  if (catQ.error || reportQ.error) {
    return <Note back={id ? reportPath(id) : '/reports'}><Problems error={catQ.error || reportQ.error} title="The builder couldn't open" /></Note>
  }
  if (!loaded || !catalogue || (source && !report)) return <div className="p-6 text-sm text-muted-foreground" data-testid="builder-loading">Loading…</div>

  // A starter, or someone else's report: build on a copy of it.
  if (id && (report.kind === 'starter' || !report.can_edit)) return <Navigate replace to={'/reports/new?from=' + encodeURIComponent(id)} />
  if (!source && !subjectKey) return <SubjectPicker catalogue={catalogue} />
  if (!initial || !catalogue.subjects[initial.spec.subject]?.base) {
    return (
      <Note back={source ? reportPath(source) : '/reports/new'}>
        <p className="rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground" data-testid="builder-cant">
          {source ? 'This report is about something your role can\'t see, so it can\'t be changed here.' : 'Your role can\'t make a report about that.'}
          {' '}An owner or admin can give access on the Access page.
        </p>
      </Note>
    )
  }
  return <Builder key={source || subjectKey} catalogue={catalogue} id={id || null} from={from} initial={initial} />
}
