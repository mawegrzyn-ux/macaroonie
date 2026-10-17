// The four ways a kiosk shows a set of choices (an option group or a
// combo step): grid, list, slider (with a level scale such as heat) and a
// spin wheel. Each gets the same props, so any group can use any of them:
//   options   [{ id, label, description, image_url, level, priceText, sold_out }]
//   countOf(id) how many times it is picked; onTap(option); onLess(option)
//   repeat    the same choice may be picked more than once
//   full      nothing more can be picked (max reached)
//   scale     { low, high } words at the ends of the level scale, or null
//   levelIcon 'flame' | 'star' | 'dot'
//   ui        the kiosk's words (store.js textsFor().ui)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Minus, Plus, ChevronLeft, ChevronRight, Dices } from 'lucide-react'
import { cx, Photo, Levels } from './parts.jsx'

function Tick({ n, repeat }) {
  if (!n) return null
  return <span className="k-opt-tick">{repeat && n > 1 ? n : <Check size={18} strokeWidth={3} />}</span>
}

// ── Grid ─────────────────────────────────────────────────────────

export function GridDisplay({ options, countOf, onTap, onLess, repeat, full, levelIcon, ui }) {
  return (
    <div className="grid gap-[var(--k-gap)]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(30vmin, 190px), 1fr))' }} data-display="grid">
      {options.map(o => {
        const n = countOf(o.id)
        const off = o.sold_out || (!n && full && !repeat)
        return (
          <div key={o.id} className="relative">
            <button className={cx('k-card k-opt w-full', n > 0 && 'k-opt-on', off && 'k-opt-dis')} onClick={() => !o.sold_out && onTap(o)} disabled={o.sold_out} data-testid="k-option" aria-pressed={n > 0}>
              <Photo src={o.image_url} label={o.label} className="k-opt-img" phClassName="k-opt-ph" />
              <span className="p-[.6em] flex flex-col gap-[.2em]">
                <span className="k-head text-[.95em]">{o.label}</span>
                {o.level != null && <Levels level={o.level} icon={levelIcon} />}
                {o.description && <span className="k-item-desc">{o.description}</span>}
                <span className="k-price text-[.9em]">{o.sold_out ? ui('sold_out') : o.priceText}</span>
              </span>
              <Tick n={n} repeat={repeat} />
            </button>
            {repeat && n > 0 && (
              <button className="k-opt-less" onClick={() => onLess(o)} aria-label={ui('one_less') + ' ' + o.label}><Minus size={18} /></button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── List ─────────────────────────────────────────────────────────

export function ListDisplay({ options, countOf, onTap, onLess, repeat, full, levelIcon, ui }) {
  return (
    <div className="flex flex-col gap-[calc(var(--k-gap)/1.5)]" data-display="list">
      {options.map(o => {
        const n = countOf(o.id)
        const off = o.sold_out || (!n && full && !repeat)
        return (
          <div key={o.id} className={cx('k-card flex items-center gap-[.8em] p-[.5em] border-[3px]', n > 0 ? 'border-[var(--k-primary)]' : 'border-transparent', off && 'k-opt-dis')}>
            <button className="flex items-center gap-[.8em] flex-1 min-w-0 text-left bg-transparent border-0 p-0" onClick={() => !o.sold_out && onTap(o)} disabled={o.sold_out} data-testid="k-option" aria-pressed={n > 0}>
              <span className="w-[4.2em] h-[4.2em] shrink-0 rounded-[calc(var(--k-radius)/1.5)] overflow-hidden">
                <Photo src={o.image_url} label={o.label} className="w-full h-full object-cover" phClassName="k-opt-ph h-full aspect-auto text-[1.2em]" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="k-head block">{o.label}</span>
                {o.description && <span className="k-item-desc block">{o.description}</span>}
                {o.level != null && <Levels level={o.level} icon={levelIcon} />}
              </span>
              <span className="k-price">{o.sold_out ? ui('sold_out') : o.priceText}</span>
            </button>
            {repeat ? (
              <span className="flex items-center gap-2 shrink-0">
                {n > 0 && <button className="k-btn k-btn-round" onClick={() => onLess(o)} aria-label={ui('one_less') + ' ' + o.label}><Minus /></button>}
                {n > 0 && <span className="k-head text-[1.3em] w-[1.4em] text-center">{n}</span>}
                <button className="k-btn k-btn-round k-btn-primary" onClick={() => onTap(o)} disabled={o.sold_out || full} aria-label={ui('one_more') + ' ' + o.label}><Plus /></button>
              </span>
            ) : (
              <span className={cx('w-[2.2em] h-[2.2em] rounded-full shrink-0 flex items-center justify-center border-[3px]', n > 0 ? 'bg-[var(--k-primary)] border-[var(--k-primary)] text-[var(--k-primary-text)]' : 'border-[var(--k-line)]')}>
                {n > 0 && <Check size={18} strokeWidth={3} />}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Slider ───────────────────────────────────────────────────────

export function SliderDisplay({ options: given, countOf, onTap, onLess, repeat, full, scale, levelIcon, ui }) {
  const track = useRef(null)
  const [focus, setFocus] = useState(0)
  const levels = given.some(o => o.level != null)
  const showScale = !!scale && levels
  // With a scale the cards run from its low end to its high end (mildest
  // first), so moving the scale moves along the cards; the group's own order
  // breaks ties and choices without a level go last.
  const options = useMemo(() => (showScale
    ? given.map((o, i) => ({ o, i })).sort((a, b) => (a.o.level ?? 99) - (b.o.level ?? 99) || a.i - b.i).map(x => x.o)
    : given), [given, showScale])

  // The card nearest the middle is the one in focus.
  const onScroll = useCallback(() => {
    const el = track.current
    if (!el) return
    const mid = el.scrollLeft + el.clientWidth / 2
    let best = 0, dist = Infinity
    ;[...el.children].forEach((c, i) => {
      const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid)
      if (d < dist) { dist = d; best = i }
    })
    setFocus(best)
  }, [])
  useEffect(() => { onScroll() }, [onScroll, options.length])

  const scrollTo = i => {
    const el = track.current
    const c = el?.children[Math.max(0, Math.min(options.length - 1, i))]
    if (c) el.scrollTo({ left: c.offsetLeft + c.offsetWidth / 2 - el.clientWidth / 2, behavior: 'smooth' })
  }
  // The scale picks the first choice at that level (or the nearest one).
  const toLevel = lv => {
    let best = 0, dist = Infinity
    options.forEach((o, i) => { const d = Math.abs((o.level ?? 0) - lv); if (o.level != null && d < dist) { dist = d; best = i } })
    scrollTo(best)
  }
  const focusLevel = options[focus]?.level ?? 0

  return (
    <div data-display="slider">
      <div className="relative">
        <div ref={track} className="k-hscroll k-slider" onScroll={onScroll}>
          {options.map((o, i) => {
            const n = countOf(o.id)
            const off = o.sold_out || (!n && full && !repeat)
            return (
              <div key={o.id} className={cx('k-slide relative', i === focus && 'k-slide-focus')}>
                <button className={cx('k-card k-opt w-full', n > 0 && 'k-opt-on', off && 'k-opt-dis')}
                  onClick={() => { if (i !== focus) scrollTo(i); if (!o.sold_out) onTap(o) }} disabled={o.sold_out} data-testid="k-option" aria-pressed={n > 0}>
                  <Photo src={o.image_url} label={o.label} className="k-opt-img" phClassName="k-opt-ph" />
                  <span className="p-[.7em] flex flex-col gap-[.3em] items-start">
                    <span className="k-head text-[1.05em]">{o.label}</span>
                    {o.level != null && <Levels level={o.level} icon={levelIcon} size={18} />}
                    {o.description && <span className="k-item-desc">{o.description}</span>}
                    <span className={cx('mt-[.2em] px-[.8em] py-[.25em] rounded-full font-bold', n > 0 ? 'bg-[var(--k-primary)] text-[var(--k-primary-text)]' : 'bg-[var(--k-soft)] text-[var(--k-primary)]')}>
                      {o.sold_out ? ui('sold_out') : n > 0 ? (repeat && n > 1 ? n + ' x ' : '') + ui('picked') : (o.priceText || ui('pick'))}
                    </span>
                  </span>
                  <Tick n={n} repeat={repeat} />
                </button>
                {repeat && n > 0 && <button className="k-opt-less" onClick={() => onLess(o)} aria-label={ui('one_less') + ' ' + o.label}><Minus size={18} /></button>}
                {n > 0 && <span className="k-slide-pointer" />}
              </div>
            )
          })}
        </div>
        {options.length > 1 && (
          <>
            <button className="k-btn k-btn-round absolute left-[var(--k-gap)] top-[40%] shadow" onClick={() => scrollTo(focus - 1)} disabled={focus === 0} aria-label={ui('back')}><ChevronLeft /></button>
            <button className="k-btn k-btn-round absolute right-[var(--k-gap)] top-[40%] shadow" onClick={() => scrollTo(focus + 1)} disabled={focus >= options.length - 1} aria-label={ui('next')}><ChevronRight /></button>
          </>
        )}
      </div>
      {showScale && (
        <div className={cx('k-scale mt-[.4em]', levelIcon === 'flame' && 'k-scale-heat')} data-testid="k-scale">
          <span className="font-bold text-[.9em] max-w-[22%]">{scale.low}</span>
          <input type="range" min="0" max="5" step="1" value={focusLevel} onChange={e => toLevel(Number(e.target.value))} aria-label={scale.low + ' - ' + scale.high} />
          <span className="font-bold text-[.9em] max-w-[22%] text-right">{scale.high}</span>
        </div>
      )}
    </div>
  )
}

// ── Spin wheel ───────────────────────────────────────────────────

const TAU = Math.PI * 2
const WHEEL_MAX = 16

/** Text that fits a segment: cut long labels. */
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export function WheelDisplay({ options, countOf, onTap, onLess, repeat, full, levelIcon, ui }) {
  const list = options.slice(0, WHEEL_MAX)
  const n = list.length
  const seg = 360 / Math.max(1, n)
  const [rot, setRot] = useState(0)           // degrees the wheel is turned
  const [anim, setAnim] = useState(false)
  const drag = useRef(null)
  const wrap = useRef(null)
  const frame = useRef(null)

  // The choice under the pointer (top): the segment whose middle is at -90deg.
  const current = useMemo(() => {
    if (!n) return null
    const a = ((-rot % 360) + 360) % 360
    return list[Math.floor(((a + seg / 2) % 360) / seg) % n]
  }, [rot, n, seg, list])

  const snap = useCallback(r => Math.round(r / seg) * seg, [seg])
  const turnTo = useCallback((target, ms = 900) => {
    cancelAnimationFrame(frame.current)
    setAnim(ms)
    setRot(target)
  }, [])

  const angleAt = e => {
    const b = wrap.current.getBoundingClientRect()
    return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2)) * 180 / Math.PI
  }
  const onDown = e => {
    if (!n) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    cancelAnimationFrame(frame.current)
    setAnim(false)
    drag.current = { last: angleAt(e), lastT: performance.now(), v: 0, moved: 0 }
  }
  const onMove = e => {
    const d = drag.current
    if (!d) return
    const a = angleAt(e)
    let delta = a - d.last
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    const t = performance.now()
    d.v = delta / Math.max(1, t - d.lastT)
    d.last = a
    d.lastT = t
    d.moved += Math.abs(delta)
    setRot(r => r + delta)
  }
  const onUp = e => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved < 4) {
      // A tap on a segment turns it to the pointer.
      const a = angleAt(e) + 90
      const i = Math.floor((((a - rot) % 360 + 360 + seg / 2) % 360) / seg) % n
      turnTo(snap(rot - (((rot + i * seg) % 360 + 540) % 360 - 180)), 500)
      return
    }
    // Flick: keep turning, slowing down, then settle on a segment.
    let v = d.v * 16
    let r = rot
    const step = () => {
      v *= 0.95
      r += v
      if (Math.abs(v) < 0.4) { turnTo(snap(r), 350); return }
      setRot(r)
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const spin = () => {
    if (!n) return
    const target = snap(rot - 720 - Math.floor(Math.random() * n) * seg - seg * Math.random())
    turnTo(target, 2600)
  }

  const r = 100
  const colours = ['var(--k-primary)', 'var(--k-accent)', 'var(--k-surface)', 'var(--k-soft)']
  const textOn = ci => (ci === 0 ? 'var(--k-primary-text)' : ci === 1 ? 'var(--k-accent-text)' : 'var(--k-text)')
  const cn = current ? countOf(current.id) : 0
  // Picked once already (not a repeat): tapping again takes it off.
  const canPick = current && !current.sold_out && ((cn > 0 && !repeat) || !full)

  return (
    <div className="flex flex-col gap-[var(--k-gap)]" data-display="wheel">
    <div className="flex flex-col landscape:flex-row items-center gap-[var(--k-pad)]">
      <div ref={wrap} className="k-wheel-wrap" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-testid="k-wheel">
        <span className="k-wheel-pointer" />
        <svg className="k-wheel" viewBox="-104 -104 208 208" aria-hidden="true">
          <g style={{ transform: 'rotate(' + rot + 'deg)', transition: anim ? 'transform ' + anim + 'ms cubic-bezier(.12,.72,.15,1)' : 'none' }}>
            {list.map((o, i) => {
              // Segment i is centred on -90deg + i*seg (the pointer is at the top).
              const a0 = (-90 + i * seg - seg / 2) * TAU / 360
              const a1 = (-90 + i * seg + seg / 2) * TAU / 360
              const large = seg > 180 ? 1 : 0
              const d = n === 1 ? `M -${r} 0 A ${r} ${r} 0 1 1 ${r} 0 A ${r} ${r} 0 1 1 -${r} 0`
                : `M 0 0 L ${r * Math.cos(a0)} ${r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`
              const mid = -90 + i * seg
              const picked = countOf(o.id) > 0
              // Neighbours never share a colour, also where the last meets the first.
              const ci = n > 1 && n % 4 === 1 && i === n - 1 ? 1 : i % 4
              return (
                <g key={o.id}>
                  <path d={d} fill={colours[ci]} stroke="var(--k-text)" strokeOpacity=".15" strokeWidth="0.8" opacity={o.sold_out ? 0.35 : 1} />
                  <g transform={`rotate(${mid}) translate(${r * 0.6} 0) rotate(90)`}>
                    <text textAnchor="middle" dominantBaseline="middle" fontSize={n > 10 ? 7 : n > 6 ? 8.5 : 10}
                      fontWeight="800" fill={textOn(ci)} style={{ fontFamily: 'var(--k-font-head)' }}>{short(o.label, n > 10 ? 10 : 14)}</text>
                    {picked && <circle cx="0" cy={n > 8 ? 11 : 14} r="4" fill="var(--k-text)" />}
                  </g>
                </g>
              )
            })}
          </g>
          <circle r="16" fill="var(--k-surface)" stroke="var(--k-text)" strokeOpacity=".2" strokeWidth="2" />
        </svg>
      </div>
      <div className="flex flex-col items-center gap-[var(--k-gap)] w-full landscape:flex-1 landscape:min-w-0">
      {current && (
        <div className="k-card flex items-center gap-[.8em] p-[.6em] w-full max-w-[640px]" data-testid="k-wheel-current">
          <span className="w-[4.4em] h-[4.4em] shrink-0 rounded-[calc(var(--k-radius)/1.5)] overflow-hidden">
            <Photo src={current.image_url} label={current.label} className="w-full h-full object-cover" phClassName="k-opt-ph h-full aspect-auto text-[1.2em]" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="k-head block text-[1.15em]">{current.label}</span>
            {current.level != null && <Levels level={current.level} icon={levelIcon} />}
            {current.description && <span className="k-item-desc block">{current.description}</span>}
            <span className="k-price">{current.sold_out ? ui('sold_out') : current.priceText}</span>
          </span>
          {repeat && cn > 0 && <button className="k-btn k-btn-round" onClick={() => onLess(current)} aria-label={ui('one_less')}><Minus /></button>}
          <button className={cx('k-btn', cn && !repeat ? '' : 'k-btn-primary')} onClick={() => onTap(current)} disabled={!canPick} data-testid="k-wheel-pick">
            {cn && !repeat ? <><Check /> {ui('picked')}</> : <>{repeat && cn ? cn + ' x ' : ''}{ui('pick')}</>}
          </button>
        </div>
      )}
      <button className="k-btn k-btn-accent" onClick={spin} data-testid="k-wheel-spin"><Dices /> {ui('spin')}</button>
      </div>
    </div>
      {options.length > WHEEL_MAX && <GridDisplay options={options.slice(WHEEL_MAX)} countOf={countOf} onTap={onTap} onLess={onLess} repeat={repeat} full={full} levelIcon={levelIcon} ui={ui} />}
    </div>
  )
}

export const DISPLAYS = { grid: GridDisplay, list: ListDisplay, slider: SliderDisplay, wheel: WheelDisplay }
