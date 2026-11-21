// src/pages/ReportLayouts.jsx
//
// Layout templates (/reports/layouts; docs/REPORTS.md 11): how reports look
// on paper and in a PDF. Settings, not a canvas: the paper, the header's
// parts, the footer, the style and a front page (shared/reports/layout.js).
// A group keeps up to 20; one can be its default, which every report prints
// with unless it picks another (More → How it looks on paper in the viewer).
//
// The preview is the real print page of a report the person picks, drawn
// with the settings being edited, in a frame (POST /reports/:id/print-link
// with `layout` and `preview`). Making and changing layouts needs Manage on
// Reports; View sees the list.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Plus, Star, Eye, LayoutTemplate } from 'lucide-react'
import {
  normaliseLayout, BUILT_IN, layoutWords, PAPER_SIZES, PAPER_LABELS, WAYS, WAY_LABELS, MARGINS, MARGIN_LABELS,
  DENSITIES, DENSITY_LABELS, NEGATIVES, NEGATIVE_LABELS, HEADER_PARTS, HEADER_LABELS, LAYOUT_LIMITS,
} from '@shared/reports/layout.js'
import { useApi } from '@/lib/api'
import { Field, Segmented, inputCls, ConfirmDelete } from '@/components/staff/shared'
import { useLayouts } from '@/components/reports/LayoutPick'
import { Problems, retryUnlessRefused } from '@/components/reports/shared'
import { cn } from '@/lib/utils'

const btn = 'inline-flex items-center gap-2 h-12 px-3 rounded-lg border bg-background text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50 shrink-0'
const primaryBtn = 'inline-flex items-center gap-2 h-12 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 shrink-0'
const checkRow = 'flex items-center gap-3 min-h-[48px] touch-manipulation'
const box = 'w-5 h-5 accent-[hsl(var(--primary))]'

function Check({ checked, onChange, children, testid, disabled }) {
  return (
    <label className={checkRow}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} disabled={disabled} className={box} data-testid={testid} />
      <span className="text-sm">{children}</span>
    </label>
  )
}

function Editor({ layout, canManage, reports, onDone }) {
  const api = useApi()
  const qc = useQueryClient()
  const [name, setName] = useState(layout?.name || '')
  const [isDefault, setDefault] = useState(!!layout?.is_default)
  const [s, setS] = useState(() => normaliseLayout(layout?.settings || BUILT_IN))
  const [state, setState] = useState({ busy: false, error: null })
  const set = (part, patch) => setS(x => normaliseLayout({ ...x, [part]: { ...x[part], ...patch } }))
  const runnable = reports.filter(r => r.runs && r.report_kind !== 'page')
  const [previewRef, setPreviewRef] = useState(() => runnable[0]?.id || '')
  const [preview, setPreview] = useState({ busy: false, url: null, error: null })
  const showPreview = async () => {
    setPreview({ busy: true, url: null, error: null })
    try {
      const out = await api.post('/reports/' + encodeURIComponent(previewRef) + '/print-link', { layout: s, preview: true })
      setPreview({ busy: false, url: out.path, error: null })
    } catch (error) {
      setPreview({ busy: false, url: null, error })
    }
  }
  const save = async () => {
    setState({ busy: true, error: null })
    try {
      const body = { name: name.trim(), settings: s, is_default: isDefault }
      if (layout) await api.put('/reports/layouts/' + layout.id, body)
      else await api.post('/reports/layouts', body)
      qc.invalidateQueries({ queryKey: ['report-layouts'] })
      setState({ busy: false, error: null })
      onDone()
    } catch (error) {
      setState({ busy: false, error })
    }
  }
  const remove = async () => {
    setState({ busy: true, error: null })
    try {
      await api.delete('/reports/layouts/' + layout.id)
      qc.invalidateQueries({ queryKey: ['report-layouts'] })
      onDone()
    } catch (error) {
      setState({ busy: false, error })
    }
  }
  const locked = !canManage
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]" data-testid="layout-editor">
      <fieldset disabled={locked} className="rounded-xl border bg-background p-4 space-y-4 min-w-0">
        <Field label="Name">
          <input value={name} onChange={e => setName(e.target.value)} maxLength={LAYOUT_LIMITS.name} placeholder="Board pack" className={cn(inputCls, 'h-12')} data-testid="layout-name" />
        </Field>
        <Check checked={isDefault} onChange={setDefault} testid="layout-default">The group's default: reports print with it unless they pick another</Check>
        <h3 className="text-sm font-semibold pt-2">Paper</h3>
        <Field label="Paper size" group><Segmented value={s.page.size} testid="layout-size" onChange={v => set('page', { size: v })} options={PAPER_SIZES.map(v => ({ value: v, label: PAPER_LABELS[v] }))} /></Field>
        <Field label="Which way round" group><Segmented value={s.page.way} testid="layout-way" onChange={v => set('page', { way: v })} options={WAYS.map(v => ({ value: v, label: WAY_LABELS[v] }))} /></Field>
        <Field label="Margins" group><Segmented value={s.page.margin} testid="layout-margin" onChange={v => set('page', { margin: v })} options={MARGINS.map(v => ({ value: v, label: MARGIN_LABELS[v] }))} /></Field>
        <h3 className="text-sm font-semibold pt-2">The top of the first sheet</h3>
        {HEADER_PARTS.map(k => (
          <Check key={k} checked={s.header[k]} onChange={v => set('header', { [k]: v })} testid={'layout-header-' + k}>{HEADER_LABELS[k]}</Check>
        ))}
        <h3 className="text-sm font-semibold pt-2">The foot of every sheet</h3>
        <Check checked={s.footer.numbers} onChange={v => set('footer', { numbers: v })} testid="layout-numbers">Page numbers</Check>
        <Field label="Words (optional)">
          <input value={s.footer.text} onChange={e => setS(x => ({ ...x, footer: { ...x.footer, text: e.target.value } }))} maxLength={LAYOUT_LIMITS.footer}
            placeholder="Confidential: for the management team" className={cn(inputCls, 'h-12')} data-testid="layout-footer" />
        </Field>
        <h3 className="text-sm font-semibold pt-2">Style</h3>
        <Check checked={s.style.brand} onChange={v => set('style', { brand: v })} testid="layout-brand">Headings in the brand's colour</Check>
        <Check checked={s.style.stripes} onChange={v => set('style', { stripes: v })} testid="layout-stripes">Striped rows</Check>
        <Field label="Rows" group><Segmented value={s.style.density} testid="layout-density" onChange={v => set('style', { density: v })} options={DENSITIES.map(v => ({ value: v, label: DENSITY_LABELS[v] }))} /></Field>
        <Field label="Negative figures">
          <select value={s.style.negatives} onChange={e => set('style', { negatives: e.target.value })} className={cn(inputCls, 'h-12')} data-testid="layout-negatives">
            {NEGATIVES.map(v => <option key={v} value={v}>{NEGATIVE_LABELS[v]}</option>)}
          </select>
        </Field>
        <h3 className="text-sm font-semibold pt-2">Front page</h3>
        <Check checked={s.front.on} onChange={v => set('front', { on: v })} testid="layout-front">A front page with the report's name and period</Check>
        {s.front.on && (
          <Field label="A paragraph for the front page (optional)">
            <textarea value={s.front.text} onChange={e => setS(x => ({ ...x, front: { ...x.front, text: e.target.value } }))} maxLength={LAYOUT_LIMITS.front} rows={4}
              className={cn(inputCls, 'h-auto py-2')} data-testid="layout-front-text" />
          </Field>
        )}
        <p className="text-[11px] text-muted-foreground" data-testid="layout-words">{layoutWords(s)}</p>
        <Problems error={state.error} title="The layout wasn't saved" />
        {!locked && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={save} disabled={state.busy || !name.trim()} data-testid="layout-save" className={primaryBtn}>{state.busy ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={onDone} className={btn} data-testid="layout-cancel">Cancel</button>
            {layout && <ConfirmDelete big label="Delete this layout" confirmLabel="Yes, delete it" onConfirm={remove} disabled={state.busy} />}
          </div>
        )}
      </fieldset>

      <div className="rounded-xl border bg-background p-4 space-y-3 min-w-0" data-testid="layout-preview">
        <h3 className="text-sm font-semibold">Preview with real figures</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select value={previewRef} onChange={e => setPreviewRef(e.target.value)} className={cn(inputCls, 'h-12 flex-1 min-w-[12rem]')} data-testid="layout-preview-report">
            {runnable.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button type="button" onClick={showPreview} disabled={!canManage || !previewRef || preview.busy} data-testid="layout-preview-show" className={btn}>
            <Eye className="w-4 h-4" /> {preview.busy ? 'Making it…' : preview.url ? 'Show it again' : 'Show the preview'}
          </button>
        </div>
        {!canManage && <p className="text-[11px] text-muted-foreground">Trying a layout out needs Manage on Reports.</p>}
        <Problems error={preview.error} title="The preview wasn't made" />
        {preview.url && (
          <iframe src={preview.url} title="Preview of the layout" data-testid="layout-preview-frame"
            className="w-full h-[70vh] rounded-lg border bg-white" />
        )}
        <p className="text-[11px] text-muted-foreground">The preview is the print page as it would print now. A change shows after Show it again.</p>
      </div>
    </div>
  )
}

export default function ReportLayouts() {
  const api = useApi()
  const q = useLayouts()
  const reportsQ = useQuery({ queryKey: ['reports'], queryFn: () => api.get('/reports'), retry: retryUnlessRefused })
  const reports = useMemo(() => [...(reportsQ.data?.reports || []), ...(reportsQ.data?.starters || [])], [reportsQ.data])
  const [open, setOpen] = useState(null)   // 'new' | layout id
  const layouts = q.data?.layouts || []
  const canManage = !!q.data?.can_manage
  const editing = open === 'new' ? null : layouts.find(l => l.id === open)
  useEffect(() => { if (open && open !== 'new' && q.data && !editing) setOpen(null) }, [open, q.data, editing])
  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="report-layouts-page">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 max-lg:notouch:pl-14 border-b shrink-0 min-h-[56px] bg-background">
        <Link to="/reports" aria-label="Back to Reports" title="Back to Reports"
          className="w-12 h-12 -ml-2 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation shrink-0">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-semibold text-sm flex-1 min-w-[8rem]">Report layouts</h1>
        {canManage && !open && (
          <button type="button" onClick={() => setOpen('new')} disabled={layouts.length >= (q.data?.limit || 20)} data-testid="layout-new" className={primaryBtn}>
            <Plus className="w-4 h-4" /> New layout
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 space-y-4">
          <Problems error={q.error || reportsQ.error} />
          {!open && (
            <>
              <p className="text-sm text-muted-foreground max-w-3xl">How reports look on paper and in a PDF: the paper, the top of the first sheet, the foot of every sheet, the style and a front page. A report prints with the group's default unless it picks another.</p>
              <div className="space-y-2 max-w-3xl" data-testid="layout-list">
                {!layouts.length && q.data && (
                  <p className="text-sm text-muted-foreground rounded-xl border bg-background px-4 py-3" data-testid="layout-none">No layouts yet: reports print as they come.</p>
                )}
                {layouts.map(l => (
                  <button key={l.id} type="button" onClick={() => setOpen(l.id)} data-testid="layout-row" data-id={l.id}
                    className="w-full text-left flex items-start gap-3 min-h-[56px] px-4 py-3 rounded-xl border bg-background touch-manipulation hover:bg-muted">
                    <LayoutTemplate className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                    <span className="flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {l.name}
                        {l.is_default && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary" data-testid="layout-is-default"><Star className="w-3 h-3" /> Default</span>}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">{l.words}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {open && (open === 'new' || editing) && (
            <Editor key={open} layout={editing} canManage={canManage} reports={reports} onDone={() => setOpen(null)} />
          )}
        </div>
      </div>
    </div>
  )
}
