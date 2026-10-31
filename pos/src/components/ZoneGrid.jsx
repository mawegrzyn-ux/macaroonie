// A till layout zone's own grid of buttons (Store tech > Till layouts;
// shared/pos/tillLayout.js). The cells are placed by packCells(), as in the
// designer's preview, so a button lands in the same cell in both. The zone's
// columns and rows set the cells' size (sized with container units, so they
// follow the zone, not the buttons' words); what doesn't fit scrolls (down,
// or across in a one-row zone), goes on pages with arrows, behind a More
// button in the last cell, or is left out.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { packCells } from '@shared/pos/tillLayout.js'
import { Modal, cx } from './ui.jsx'

const GAP = 6
// The page each zone is on, kept while the till app runs (a check opening
// redraws the screen; the dishes zone stays on its page).
const pageMemo = new Map()

const track = (n, of) => `calc((100cq${of} - ${GAP * (n - 1)}px) / ${n})`

/**
 * cells: [{ key, w, h, node }]: node fills its cell. zone: { cols, rows,
 * overflow, font, bold }. memoKey: where the page is remembered; resetKey:
 * when it changes, back to the first page (another category, another dish).
 */
export default function ZoneGrid({ zone, cells, memoKey, resetKey = '', empty = null, moreTitle = 'More', testid = null }) {
  const sig = cells.map(c => c.key + ':' + (c.w || 1) + 'x' + (c.h || 1)).join('|')
  const packed = useMemo(
    () => packCells(cells.map(c => ({ w: c.w || 1, h: c.h || 1 })), zone),
    [sig, zone.cols, zone.rows, zone.overflow], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const memo = memoKey + '|' + resetKey
  const [page, setPageState] = useState(() => pageMemo.get(memo) || 0)
  const [more, setMore] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setPageState(pageMemo.get(memo) || 0)
  }, [memo])
  const setPage = p => { pageMemo.set(memo, p); setPageState(p) }
  const pages = packed.pages
  const at = Math.min(page, pages.length - 1)
  const style = { fontSize: zone.font + 'px', fontWeight: zone.bold === false ? 500 : 700 }

  if (!cells.length) {
    return <div className="h-full flex items-center justify-center text-muted text-sm p-3 text-center" data-testid={testid}>{empty}</div>
  }

  const across = zone.overflow === 'scroll' && zone.rows === 1 && zone.cols > 1
  const down = zone.overflow === 'scroll' && !across
  const grid = {
    display: 'grid',
    gap: GAP + 'px',
    gridTemplateColumns: across ? `repeat(${packed.cols}, ${track(zone.cols, 'w')})` : `repeat(${zone.cols}, minmax(0, 1fr))`,
    gridTemplateRows: down ? `repeat(${packed.rows}, ${track(zone.rows, 'h')})` : across ? '100cqh' : `repeat(${zone.rows}, minmax(0, 1fr))`,
    ...(down || across ? {} : { height: '100%' }),
  }
  const place = p => ({ gridColumn: `${p.x + 1} / span ${p.w}`, gridRow: `${p.y + 1} / span ${p.h}` })
  const shown = pages[at] || []
  const rest = packed.rest.map(i => cells[i])

  return (
    <div className="h-full flex flex-col min-h-0" style={style} data-testid={testid} data-overflow={zone.overflow} data-page={at} data-pages={pages.length}>
      <div className={cx('flex-1 min-h-0 min-w-0', down && 'overflow-y-auto overscroll-contain', across && 'overflow-x-auto overflow-y-hidden overscroll-contain')}
        style={{ containerType: 'size' }}>
        <div style={grid}>
          {shown.map(p => (
            <div key={cells[p.i].key} className="min-w-0 min-h-0 relative" style={place(p)} data-cell={cells[p.i].key}>{cells[p.i].node}</div>
          ))}
          {rest.length > 0 && (
            <div className="min-w-0 min-h-0" style={{ gridColumn: `${zone.cols} / span 1`, gridRow: `${zone.rows} / span 1` }}>
              <button className="w-full h-full rounded-xl border-2 border-dashed border-brand text-brand flex flex-col items-center justify-center gap-0.5 touch-manipulation"
                onClick={() => setMore(true)} data-testid="zone-more">
                <MoreHorizontal size={20} /><span>More ({rest.length})</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {pages.length > 1 && (
        // The arrows shrink to 44 px in a narrow zone; the page count stays on one line.
        <div className="shrink-0 flex items-center justify-between gap-1 pt-1.5" style={{ fontSize: 15 }}>
          <button className="btn h-11 flex-1 min-w-[44px] max-w-[64px] px-0" disabled={at === 0} onClick={() => setPage(at - 1)} aria-label="Page before" data-testid="zone-prev"><ChevronLeft size={22} /></button>
          <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-muted tabular-nums" data-testid="zone-page">{at + 1} / {pages.length}</span>
          <button className="btn h-11 flex-1 min-w-[44px] max-w-[64px] px-0" disabled={at >= pages.length - 1} onClick={() => setPage(at + 1)} aria-label="Next page" data-testid="zone-next"><ChevronRight size={22} /></button>
        </div>
      )}
      {more && (
        <Modal title={moreTitle} onClose={() => setMore(false)} wide>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', ...style }} data-testid="zone-more-sheet">
            {rest.map(c => (
              <div key={c.key} className="h-20 min-w-0 relative" onClick={() => setMore(false)}>{c.node}</div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
