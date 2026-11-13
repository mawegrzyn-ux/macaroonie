// src/components/reports/ReportChart.jsx
//
// A report's result as a chart (docs/REPORTS.md 12). shared/reports/chart.js
// decides what is drawn and draws it, the same drawing the print page gets;
// this component gives it the room it has, a legend that hides and shows a
// series, the figures of the mark under the pointer or the finger, and a way
// to open a mark up as a row of the table is opened (drill.jsx).
//
//   result   what the run or preview route returned
//   model    chartModel(result): what to draw (the card works it out, since
//            it also decides whether the table shows)
//   onOpen   (target) a mark was asked to be opened. Left out, or for a
//            result with nothing to open, marks only say their figures
//   hiddenRef  a ref kept up to date with the keys of the series switched
//            off in the legend, so Print can leave them off the page too
//
// Pointer: the mark under it says its figures. Tap or click: the figures
// stay put, with a button to open the mark when it can be opened; a tap
// anywhere else lets go. Held figures can cover other marks: a tap on their
// words goes to the mark underneath (only their button is theirs). In a
// narrow chart (a phone) a column's figures hang under the chart instead.
// Keyboard: the chart takes the focus, the arrow keys walk its marks, Enter
// opens one (or holds its figures), Escape lets go. The table under the
// chart is the same data for a screen reader.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Info } from 'lucide-react'
import { drawChart, chartTip, chartMark } from '@shared/reports/chart.js'
import { drillChoices, markTarget } from '@/components/reports/drill'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const NONE = new Set()

/** The brand's main colour (the website theme's): a chart with one series is drawn in it when it stands out on white. */
export function useBrandColour() {
  const api = useApi()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  return me?.site_theme?.primary || null
}

// The width the chart has to draw in, followed as the page changes. The
// element comes and goes (a result that can't be drawn has no chart), so it
// is kept in state: the watch starts whenever there is one.
function useRoom() {
  const [el, setEl] = useState(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!el) return undefined
    setWidth(Math.floor(el.getBoundingClientRect().width))
    const watch = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    watch.observe(el)
    return () => watch.disconnect()
  }, [el])
  return [setEl, width]
}

function Swatch({ item }) {
  if (item.mark === 'line') {
    return <span className="w-4 h-[3px] rounded-full shrink-0" style={{ background: item.hidden ? 'transparent' : item.colour, outline: item.hidden ? '1px solid ' + item.colour : undefined }} aria-hidden="true" />
  }
  return <span className="w-3 h-3 rounded-[3px] shrink-0" style={{ background: item.hidden ? 'transparent' : item.colour, outline: item.hidden ? '1px solid ' + item.colour : undefined }} aria-hidden="true" />
}

export default function ReportChart({ result, model, onOpen = null, hiddenRef = null, className }) {
  const brand = useBrandColour()
  const [roomRef, width] = useRoom()
  const boxRef = useRef(null)
  const tipRef = useRef(null)

  // Which series are switched off belongs to the series there are: another
  // result with other series starts with all of them showing.
  const seriesKey = model?.ok ? (model.series || []).map(s => s.key + ':' + s.label).join('|') : ''
  const [offFor, setOffFor] = useState({ key: '', off: NONE })
  const off = offFor.key === seriesKey ? offFor.off : NONE
  useEffect(() => {
    if (!hiddenRef) return undefined
    hiddenRef.current = model?.ok ? [...off] : []
    return () => { hiddenRef.current = [] }
  })

  const drawn = useMemo(
    () => (model?.ok && width > 0 ? drawChart(model, { width, brand, hidden: off }) : null),
    [model, width, brand, off],
  )
  const targets = drawn?.targets || []

  // The mark being read: under the pointer, walked to with the keys, or held by a tap.
  const [at, setAt] = useState(null)          // { i, held }
  useEffect(() => { setAt(null) }, [model, seriesKey])
  const active = at && targets[at.i] ? at : null
  const target = active ? targets[active.i] : null
  const tip = target ? chartTip(model, target, { hidden: off, brand }) : null
  const mark = target ? chartMark(model, target) : null
  // A mark with nothing in it has nothing behind it to open.
  const opens = onOpen && mark && tip && !tip.none ? markTarget(result, mark, tip) : null
  const choices = opens ? drillChoices(result, opens) : []

  // A held mark lets go when the tap lands anywhere outside the chart.
  useEffect(() => {
    if (!active?.held) return undefined
    const away = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setAt(null) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [active?.held])

  // The drawing's own units against the room it was given (they differ only
  // in a room narrower than the narrowest drawing).
  const scale = () => {
    const box = boxRef.current?.getBoundingClientRect()
    return box && drawn?.width ? box.width / drawn.width : 1
  }
  const hit = e => {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box || !drawn) return -1
    const k = drawn.width / box.width
    const x = (e.clientX - box.left) * k, y = (e.clientY - box.top) * k
    return targets.findIndex(t => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h)
  }

  // The figures sit beside the mark: to the side of a column; under a row, a
  // cell or a part, or over it when there is no room under and there is over.
  // In a chart too short for either they hang below it, over what follows,
  // rather than cover the mark they are about. In a narrow chart (a phone)
  // a column's figures would cover most of the plot from its side, so they
  // hang under the chart too.
  useLayoutEffect(() => {
    const el = tipRef.current, box = boxRef.current
    if (!el || !box || !target) return
    const k = scale()
    const W = box.clientWidth, H = box.clientHeight
    const t = { x: target.x * k, y: target.y * k, w: target.w * k, h: target.h * k }
    const w = el.offsetWidth, h = el.offsetHeight
    const fit = (v, max) => Math.max(4, Math.min(v, max - 4))
    let left, top
    if (t.h > H * 0.6) {
      // A column of the plot: beside it, on the side with more room.
      const cx = t.x + t.w / 2
      if (w > W * 0.5) {
        left = fit(cx - w / 2, W - w)
        top = H + 6
      } else {
        left = cx < W / 2 ? t.x + t.w + 8 : t.x - w - 8
        if (left < 4 || left + w > W - 4) left = fit(cx - w / 2, W - w)
        top = 8
      }
    } else {
      left = t.w > W * 0.6 ? fit(W - w - 8, W - w) : fit(t.x + t.w / 2 - w / 2, W - w)
      top = t.y + t.h + 6 + h <= H || t.y - h - 6 < 0 ? t.y + t.h + 6 : t.y - h - 6
    }
    el.style.left = Math.round(left) + 'px'
    el.style.top = Math.round(top) + 'px'
  })

  // Held figures carry a button: where they hang past the edge of what shows
  // (under a chart at the foot of the screen), they are brought into view,
  // clear of the Mobile view button that floats at the foot of a touch phone.
  const heldAt = active?.held ? active.i : -1
  useEffect(() => {
    if (heldAt >= 0) tipRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [heldAt])

  if (!model) return null
  if (!model.ok) {
    if (!model.why) return null
    return (
      <p className={cn('px-4 py-3 border-b flex gap-2 text-xs text-muted-foreground', className)} data-testid="chart-none">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />No chart: {model.why}.
      </p>
    )
  }

  const toggle = key => {
    const showing = (drawn?.legend || []).filter(l => l.toggle && !l.hidden)
    const hide = !off.has(key)
    // One series always shows.
    if (hide && showing.length <= 1) return
    const next = new Set(off)
    if (hide) next.add(key); else next.delete(key)
    setOffFor({ key: seriesKey, off: next })
    setAt(null)
  }

  const open = () => { if (opens) { onOpen(opens); setAt(null) } }
  // Held figures can cover marks (and, hanging under a narrow chart, what
  // follows it). A tap on their words is a tap on the mark underneath when
  // there is one, and nothing otherwise: never on something they hide.
  const onTip = e => {
    if (!active?.held || e.target.closest('button')) return
    const i = hit(e)
    if (i >= 0 && i !== active.i) setAt({ i, held: true })
  }
  const onKey = e => {
    if (!targets.length) return
    const i = active ? active.i : -1
    const go = n => { e.preventDefault(); setAt({ i: Math.max(0, Math.min(targets.length - 1, n)), held: !!active?.held }) }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(i < 0 ? 0 : i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(targets.length - 1)
    else if (e.key === 'Escape') { if (active) { e.preventDefault(); setAt(null) } }
    else if (e.key === 'Enter' || e.key === ' ') {
      if (!active) return
      e.preventDefault()
      if (opens) open(); else setAt({ i: active.i, held: !active.held })
    }
  }

  const k = target ? scale() : 1
  const cell = model.form === 'heat'
  const legend = drawn?.legend || []
  const said = tip ? tip.title + (tip.none ? ': nothing' : ': ' + tip.lines.map(l => l.label + ' ' + l.value).join(', ')) : ''

  return (
    <div className={cn('border-b', className)} data-testid="report-chart" data-kind={model.kind} data-form={model.form}>
      {legend.length > 0 && (
        <ul className="flex flex-wrap gap-x-1 gap-y-0.5 px-3 pt-2" data-testid="chart-legend" aria-label="What the colours stand for">
          {legend.map(l => (
            <li key={l.key}>
              {l.toggle ? (
                <button type="button" onClick={() => toggle(l.key)} aria-pressed={!l.hidden} data-testid="chart-legend-item" data-key={l.key} data-hidden={l.hidden ? '1' : '0'}
                  title={l.hidden ? 'Show ' + l.label : 'Hide ' + l.label}
                  className={cn('inline-flex items-center gap-2 min-h-[36px] touch:min-h-[48px] px-2 rounded-lg text-xs text-left touch-manipulation hover:bg-muted',
                    l.hidden && 'text-muted-foreground line-through')}>
                  <Swatch item={l} /><span className="break-words">{l.label}</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-2 min-h-[28px] px-2 text-xs" data-testid="chart-legend-item" data-key={l.key}>
                  <Swatch item={l} /><span className="break-words">{l.label}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="px-4 pt-3 pb-2">
        {/* The room is measured on an element with no padding of its own. */}
        <div ref={roomRef} />
        {drawn && (
          <div ref={boxRef} className="relative" style={{ maxWidth: drawn.width }}>
            {/* Every word in the drawing is escaped where it is drawn (shared/reports/chart.js). */}
            <div data-testid="chart-svg" dangerouslySetInnerHTML={{ __html: drawn.svg }} />
            {targets.length > 0 && (
              <div className="absolute inset-0 rounded-md touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                tabIndex={0} role="group" aria-roledescription="chart" aria-label={drawn.label + '. The arrow keys read each mark.'}
                data-testid="chart-marks" data-marks={targets.length}
                onPointerMove={e => { if (e.pointerType === 'mouse' && !active?.held) { const i = hit(e); setAt(i < 0 ? null : { i, held: false }) } }}
                onPointerLeave={e => { if (e.pointerType === 'mouse' && !active?.held) setAt(null) }}
                onClick={e => { const i = hit(e); setAt(i < 0 || (active?.held && active.i === i) ? null : { i, held: true }) }}
                onKeyDown={onKey}>
                {target && (
                  <span className={cn('absolute pointer-events-none', cell ? 'ring-2 ring-foreground/70 rounded-[3px]' : 'bg-foreground/[0.06] rounded-sm')}
                    style={{ left: target.x * k, top: target.y * k, width: target.w * k, height: target.h * k }} data-testid="chart-mark-on" />
                )}
              </div>
            )}
            {tip && (
              <div ref={tipRef} role={active.held ? 'dialog' : 'tooltip'} aria-label={tip.title} data-testid="chart-tip" data-held={active.held ? '1' : '0'}
                onClick={onTip}
                className={cn('absolute z-30 w-max max-w-[min(17rem,calc(100%_-_8px))] rounded-lg border bg-background shadow-md px-3 py-2 text-xs scroll-my-2 touch:max-[700px]:scroll-mb-[4.5rem]',
                  !active.held && 'pointer-events-none')}
                style={{ left: 4, top: 4 }}>
                <p className="text-sm font-semibold leading-tight break-words" data-testid="chart-tip-title">{tip.title}</p>
                {tip.none ? <p className="mt-1 text-muted-foreground">Nothing here.</p> : (
                  <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-center">
                    {tip.lines.map((l, i) => (
                      <div key={i} className="contents" data-testid="chart-tip-line">
                        <dt className="flex items-center gap-2 text-muted-foreground min-w-0">
                          <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: l.colour || 'transparent' }} aria-hidden="true" />
                          <span className="min-w-0 break-words">{l.label}</span>
                        </dt>
                        <dd className="text-right tabular-nums font-medium">{l.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {active.held && opens && (
                  <button type="button" onClick={open} data-testid="chart-open"
                    className="mt-2 w-full min-h-[40px] touch:min-h-[48px] inline-flex items-center justify-between gap-2 px-3 rounded-lg border bg-background text-sm font-medium text-left touch-manipulation hover:bg-muted">
                    {choices.length === 1 ? choices[0].label : 'Open it up'}
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                )}
              </div>
            )}
            <span className="sr-only" aria-live="polite">{said}</span>
          </div>
        )}
      </div>

      {model.notes?.length > 0 && (
        <ul className="px-4 pb-2 space-y-1" data-testid="chart-notes">
          {model.notes.map((n, i) => (
            <li key={i} className="flex gap-2 text-xs text-muted-foreground"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
