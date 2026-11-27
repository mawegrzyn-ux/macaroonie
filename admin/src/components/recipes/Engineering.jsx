// src/components/recipes/Engineering.jsx
//
// Menu margins' Engineering tab (inventory phase 7a, docs/INVENTORY.md 8.2):
// each menu section's dishes as Kasavana and Smith classify them from what
// really sold over some days (usage from sales, dish_cost_days): a star sells
// well and earns at least the section's average gross profit per unit; a
// plough-horse sells well and earns less; a puzzle earns more but sells
// little; a dog does neither. Popular means at least 70% of an equal share of
// the section's units. Pounds of margin lead (GP per unit, total GP), cost %
// beside. Worked out by engineer() in shared/engineering.js on the server
// (GET /api/menu-margins/engineering); the page shows it.
//
// The four-box chart is an SVG per section: share of units across, GP per
// unit up, the lines at the popularity share and the average GP per unit.
// Tapping a dish (on the chart or in the table) opens what it is and what to
// do. GP, net, cost % and the classes are the till's figures: without till
// reports view the server leaves them out (sees_sales false) and the tab shows
// units, shares and popularity only.
//
//   Engineering({ venues, menus })

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Star, Tractor, Puzzle, Dog, CircleDashed } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Field, inputCls, ErrorNote, addDay } from '@/components/staff/shared'
import { Card, DateButton, Drawer, btn } from '@/components/purchasing/shared'
import { penceText, pctText } from '@/components/recipes/shared'
import { CLASSES, NOT_COSTED, averageText } from '@shared/engineering.js'

const qtyText = n => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1))
const ICONS = { star: Star, plough_horse: Tractor, puzzle: Puzzle, dog: Dog }
const LOOK = {
  star: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  plough_horse: 'bg-amber-50 text-amber-900 border-amber-200',
  puzzle: 'bg-sky-50 text-sky-900 border-sky-200',
  dog: 'bg-stone-100 text-stone-800 border-stone-300',
}
const PLURALS = { star: 'Stars', plough_horse: 'Plough-horses', puzzle: 'Puzzles', dog: 'Dogs' }

/** A class as a badge with its icon and its name (never colour alone). */
export function ClassBadge({ cls, className }) {
  const Icon = ICONS[cls] || CircleDashed
  const words = CLASSES[cls]?.label || 'Not costed'
  return (
    <span className={cn('inline-flex items-center gap-1 h-7 px-2 rounded-full border text-xs font-medium whitespace-nowrap', LOOK[cls] || 'bg-muted text-muted-foreground border-border', className)}
      data-testid="eng-class" data-class={cls || 'none'}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />{words}
    </span>
  )
}

const today = () => new Date().toISOString().slice(0, 10)
const monthStart = d => d.slice(0, 8) + '01'

export default function Engineering({ venues = [], menus = [] }) {
  const api = useApi()
  const [venueId, setVenueId] = useState('')
  const [menuId, setMenuId] = useState('')
  const [range, setRange] = useState(null)
  const [sectionId, setSectionId] = useState('')
  const [open, setOpen] = useState(null)
  const q = new URLSearchParams({ ...(venueId ? { venue_id: venueId } : {}), ...(menuId ? { menu_id: menuId } : {}), ...(range || {}) }).toString()
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['menu-margins', 'engineering', q], queryFn: () => api.get('/menu-margins/engineering' + (q ? '?' + q : '')), placeholderData: prev => prev,
  })
  useEffect(() => { if (data && !range) setRange({ from: data.from, to: data.to }) }, [data])
  const sections = data?.sections || []
  const section = sections.find(s => s.section_id === sectionId) || sections[0] || null
  const sales = !!data?.sees_sales
  const t = data?.total
  const y = addDay(today(), -1)
  return (
    <div className="space-y-4" data-testid="margins-engineering">
      <Card title="Menu engineering">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Venue">
            <select className={cn(inputCls, 'h-12 w-48')} value={venueId} onChange={e => setVenueId(e.target.value)} data-testid="eng-venue">
              <option value="">Every venue</option>
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Menu">
            <select className={cn(inputCls, 'h-12 w-52')} value={menuId} onChange={e => { setMenuId(e.target.value); setSectionId('') }} data-testid="eng-menu">
              <option value="">Every menu</option>
              {menus.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Days" group>
            <span className="flex flex-wrap items-center gap-2">
              <DateButton value={range?.from} max={range?.to} onChange={v => setRange(r => ({ ...r, from: v }))} label="From" />
              <span className="text-sm text-muted-foreground">to</span>
              <DateButton value={range?.to} min={range?.from} onChange={v => setRange(r => ({ ...r, to: v }))} label="To" />
            </span>
          </Field>
          <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => setRange({ from: addDay(y, -27), to: y })} data-testid="eng-last-28">Last 28 days</button>
          <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => setRange({ from: monthStart(today()), to: today() })} data-testid="eng-this-month">This month</button>
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground self-center" />}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Each section&apos;s dishes from what really sold (usage from sales{data?.worked_out_at ? ', worked out ' + new Date(data.worked_out_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}).
          A dish is popular when its share of the section&apos;s units is at least 70% of an equal share, and profitable when its gross profit per
          unit is at least the section&apos;s average per unit sold. A meal deal rung up as a deal is one dish of its own section, counted by deals
          sold; the dishes picked in it add nothing to their sections. Units that couldn&apos;t be costed count for popularity but are left out of GP.
          {!sales && ' GP, cost % and the classes come from what the till took: they need till reports view as well, so only units and shares show here.'}
        </p>
      </Card>
      <ErrorNote error={error} />
      {isLoading ? <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : data && (
        <>
          {t && (
            <div className="flex flex-wrap gap-2" data-testid="eng-total">
              <Chip label="Dishes" value={t.dish_count} />
              <Chip label="Units" value={qtyText(t.units)} />
              {sales && ['star', 'plough_horse', 'puzzle', 'dog'].map(k => <Chip key={k} label={PLURALS[k]} value={t.classes?.[k] ?? 0} cls={LOOK[k]} />)}
              {sales && t.classes?.not_costed > 0 && <Chip label="Not costed" value={t.classes.not_costed} />}
              {sales && t.gp_pence != null && <Chip label="GP" value={penceText(t.gp_pence)} />}
              {t.uncosted_units > 0 && <Chip label="Left out of GP" value={qtyText(t.uncosted_units) + ' units'} cls="bg-amber-50 border-amber-200 text-amber-900" />}
            </div>
          )}
          {!sections.length ? (
            <Card title="Nothing sold"><p className="text-sm text-muted-foreground">No sales were worked out for these days{venueId ? ' here' : ''}{menuId ? ' on this menu' : ''} yet.</p></Card>
          ) : (
            <>
              <Card title="Four boxes" actions={sections.length > 1 && (
                <select className={cn(inputCls, 'h-11 w-56')} value={section?.section_id || ''} onChange={e => setSectionId(e.target.value)} aria-label="Section" data-testid="eng-section">
                  {sections.map(s => <option key={s.section_id} value={s.section_id}>{sectionName(s)}</option>)}
                </select>
              )}>
                {sales ? <FourBoxes section={section} onOpen={setOpen} /> : <p className="text-sm text-muted-foreground">The four boxes need till reports view: a dish&apos;s place up and down is its gross profit, from what the till took.</p>}
              </Card>
              {sales && <Suggestions />}
              {sections.map(s => <SectionTable key={s.section_id} section={s} sales={sales} onOpen={setOpen} />)}
            </>
          )}
          {data.auto_deals?.length > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="eng-auto-deals">
              Automatic meal deals ({data.auto_deals.map(d => d.name + (menuId ? '' : ' on ' + d.menu)).join(', ')}): when the till, a kiosk or online
              ordering finds one among dishes rung up one by one, it is a discount over those dishes. They count in their own sections, each at what it
              took after the deal&apos;s saving, and the deal has no units for them; only a deal rung up from its own button counts as a deal.
            </p>
          )}
          {data.left_out?.units > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="eng-left-out">
              Not engineered: {qtyText(data.left_out.units)} units of {data.left_out.dishes} {data.left_out.dishes === 1 ? 'thing' : 'things'} that are no dish of a section
              (open items typed in on the till, services, and dishes no longer on a menu).
            </p>
          )}
        </>
      )}
      {open && <DishDrawer dish={open.dish} section={open.section} sales={sales} onClose={() => setOpen(null)} />}
    </div>
  )
}

const sectionName = s => (s.section || 'A section') + (s.menu ? ' (' + s.menu + ')' : '')

function Chip({ label, value, cls }) {
  return <span className={cn('inline-flex items-center gap-1 h-10 px-3 rounded-full border text-sm bg-background', cls)}>{label} <strong className="tabular-nums">{value}</strong></span>
}

function Suggestions() {
  return (
    <Card title="What to do with each">
      <ul className="grid sm:grid-cols-2 gap-2" data-testid="eng-suggestions">
        {['star', 'plough_horse', 'puzzle', 'dog'].map(k => (
          <li key={k} className="rounded-lg border p-3 text-sm">
            <ClassBadge cls={k} />
            <p className="mt-1.5 text-xs text-muted-foreground">{CLASSES[k].hint}</p>
            <p className="mt-1 font-medium">{CLASSES[k].suggestion}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ── The four boxes ───────────────────────────────────────────

// The chart's own colours, light and dark (the admin has no dark theme yet; the OS setting picks).
const CHART_STYLE = `
.eng-chart { --eng-surface: #ffffff; --eng-ink: #191919; --eng-ink-2: #5c5c5c; --eng-grid: #e3e3e3; --eng-rule: #8a8a8a; --eng-point: #257de0; --eng-tint: rgba(37,125,224,0.06); }
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .eng-chart { --eng-surface: #191919; --eng-ink: #efefef; --eng-ink-2: #9c9c9c; --eng-grid: #333333; --eng-rule: #7a7a7a; --eng-point: #338ced; --eng-tint: rgba(51,140,237,0.10); }
}
:root[data-theme="dark"] .eng-chart { --eng-surface: #191919; --eng-ink: #efefef; --eng-ink-2: #9c9c9c; --eng-grid: #333333; --eng-rule: #7a7a7a; --eng-point: #338ced; --eng-tint: rgba(51,140,237,0.10); }
`

const W = 640, H = 380
const PAD = { l: 64, r: 16, t: 16, b: 48 }

/** Round a top value up to a tidy step for the axis. */
function niceMax(v) {
  if (!(v > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p
}

export function FourBoxes({ section, onOpen }) {
  const pts = useMemo(() => (section?.dishes || []).filter(d => d.gp_per_unit_pence != null), [section])
  if (!section) return null
  const notPlotted = section.dishes.filter(d => d.gp_per_unit_pence == null)
  const xMax = niceMax(Math.max(section.popular_pct * 2, ...pts.map(d => d.share_pct)) * 1.05)
  const gps = pts.map(d => d.gp_per_unit_pence)
  const yLo = Math.min(0, ...gps)
  const yHi = niceMax(Math.max(section.avg_gp_per_unit_pence ?? 0, ...gps, 1) * 1.1)
  const yMin = yLo < 0 ? -niceMax(-yLo * 1.1) : 0
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b
  const X = v => PAD.l + (v / xMax) * iw
  const Y = v => PAD.t + ih - ((v - yMin) / (yHi - yMin)) * ih
  const lineX = X(section.popular_pct)
  // No costed unit in the section: no average to draw (never a line at £0.00).
  const avgKnown = section.avg_gp_per_unit_pence != null
  const lineY = avgKnown ? Y(section.avg_gp_per_unit_pence) : null
  const ticksX = [0, xMax / 4, xMax / 2, (3 * xMax) / 4, xMax]
  const ticksY = [yMin, yMin + (yHi - yMin) / 4, yMin + (yHi - yMin) / 2, yMin + (3 * (yHi - yMin)) / 4, yHi]
  const label = pts.length <= 14
  const corner = (x, yy, anchor, text) => <text x={x} y={yy} textAnchor={anchor} className="text-[12px] font-semibold" fill="var(--eng-ink-2)">{text}</text>
  return (
    <div className="eng-chart" data-testid="eng-chart">
      <style>{CHART_STYLE}</style>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto max-h-[420px] select-none" role="img"
        aria-label={'Four boxes for ' + sectionName(section) + ': share of units across, gross profit per unit up'}>
        <rect x="0" y="0" width={W} height={H} fill="var(--eng-surface)" />
        {/* The stars' box, faintly tinted: popular and profitable. */}
        {avgKnown && <rect x={lineX} y={PAD.t} width={Math.max(0, W - PAD.r - lineX)} height={Math.max(0, lineY - PAD.t)} fill="var(--eng-tint)" />}
        {ticksY.map((v, i) => (
          <g key={'y' + i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} stroke="var(--eng-grid)" strokeWidth="1" />
            <text x={PAD.l - 8} y={Y(v) + 4} textAnchor="end" className="text-[11px] tabular-nums" fill="var(--eng-ink-2)">{penceText(Math.round(v))}</text>
          </g>
        ))}
        {ticksX.map((v, i) => (
          <text key={'x' + i} x={X(v)} y={H - PAD.b + 18} textAnchor="middle" className="text-[11px] tabular-nums" fill="var(--eng-ink-2)">{Math.round(v * 10) / 10}%</text>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} stroke="var(--eng-rule)" strokeWidth="1" />
        <line x1={lineX} x2={lineX} y1={PAD.t} y2={PAD.t + ih} stroke="var(--eng-rule)" strokeWidth="1.5" strokeDasharray="5 4" />
        {avgKnown && <line x1={PAD.l} x2={W - PAD.r} y1={lineY} y2={lineY} stroke="var(--eng-rule)" strokeWidth="1.5" strokeDasharray="5 4" />}
        {corner(W - PAD.r - 6, PAD.t + 16, 'end', 'Stars')}
        {corner(PAD.l + 6, PAD.t + 16, 'start', 'Puzzles')}
        {corner(W - PAD.r - 6, PAD.t + ih - 8, 'end', 'Plough-horses')}
        {corner(PAD.l + 6, PAD.t + ih - 8, 'start', 'Dogs')}
        <text x={PAD.l + iw / 2} y={H - 8} textAnchor="middle" className="text-[12px]" fill="var(--eng-ink-2)">Share of the section&apos;s units (popular from {pctText(section.popular_pct)})</text>
        <text transform={`translate(14 ${PAD.t + ih / 2}) rotate(-90)`} textAnchor="middle" className="text-[12px]" fill="var(--eng-ink-2)">GP per unit (average {averageText(section, penceText)})</text>
        {pts.map(d => {
          const cx = X(d.share_pct), cy = Y(d.gp_per_unit_pence)
          const right = cx < W - 160
          const open = () => onOpen({ dish: d, section })
          return (
            <g key={d.dish_id} role="button" tabIndex={0} aria-label={d.name + ': ' + (CLASSES[d.class]?.label || 'not costed')}
              onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}
              className="cursor-pointer" data-testid="eng-point" data-name={d.name} data-class={d.class || 'none'}>
              <title>{d.name}: {pctText(d.share_pct)} of units, {penceText(Math.round(d.gp_per_unit_pence))} GP a unit</title>
              {/* A tap target bigger than the mark (48 px on a tablet). */}
              <circle cx={cx} cy={cy} r="22" fill="transparent" />
              <circle cx={cx} cy={cy} r="7" fill="var(--eng-point)" stroke="var(--eng-surface)" strokeWidth="2" />
              {label && <text x={right ? cx + 11 : cx - 11} y={cy + 4} textAnchor={right ? 'start' : 'end'} className="text-[11px]" fill="var(--eng-ink)">{d.name.length > 22 ? d.name.slice(0, 20) + '...' : d.name}</text>}
            </g>
          )
        })}
      </svg>
      {notPlotted.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">Not on the chart (not costed): {notPlotted.map(d => d.name).join(', ')}.</p>
      )}
    </div>
  )
}

function SectionTable({ section, sales, onOpen }) {
  return (
    <Card title={sectionName(section) + ' · ' + qtyText(section.units) + ' sold'} bodyClass="p-0">
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        {section.dish_count} {section.dish_count === 1 ? 'dish' : 'dishes'}: popular from {pctText(section.popular_pct)} of the units
        {sales && section.avg_gp_per_unit_pence != null ? ', profitable from ' + penceText(Math.round(section.avg_gp_per_unit_pence)) + ' GP a unit (the section\'s average)' : ''}
        {section.uncosted_units > 0 ? '; ' + qtyText(section.uncosted_units) + ' units left out of GP' : ''}.
      </p>
      <div className="overflow-x-auto" data-testid="eng-table">
        <table className={cn('w-full text-sm', sales ? 'min-w-[720px]' : 'min-w-[420px]')}>
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="text-left font-medium px-4 py-2">Dish</th>
              {sales && <th className="text-left font-medium px-2 py-2">Class</th>}
              <th className="text-right font-medium px-2 py-2">Units</th>
              <th className="text-right font-medium px-2 py-2">Share</th>
              {sales && <th className="text-right font-medium px-2 py-2">GP a unit</th>}
              {sales && <th className="text-right font-medium px-2 py-2">Total GP</th>}
              {sales && <th className="text-right font-medium px-4 py-2">Cost %</th>}
              {!sales && <th className="text-right font-medium px-4 py-2">Popular</th>}
            </tr>
          </thead>
          <tbody>
            {section.dishes.map(d => (
              <tr key={d.dish_id} className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => onOpen({ dish: d, section })} data-testid="eng-row" data-name={d.name} data-class={d.class || 'none'}>
                <td className="px-4 py-2">
                  <button type="button" className="text-left min-h-[48px] touch-manipulation" onClick={e => { e.stopPropagation(); onOpen({ dish: d, section }) }}>
                    <span className="font-medium">{d.name}</span>
                    {d.kind === 'deal' && <span className="ml-2 text-xs rounded-full bg-muted px-2 py-0.5">Meal deal</span>}
                    {(d.uncosted_units > 0 || d.typical_units > 0) && (
                      <span className="block text-xs text-muted-foreground">
                        {[d.uncosted_units > 0 && qtyText(d.uncosted_units) + ' left out of GP', d.typical_units > 0 && qtyText(d.typical_units) + ' at typical meal deal picks'].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </button>
                </td>
                {sales && <td className="px-2 py-2"><ClassBadge cls={d.class} /></td>}
                <td className="px-2 py-2 text-right tabular-nums">{qtyText(d.units)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{pctText(d.share_pct)}</td>
                {sales && <td className="px-2 py-2 text-right tabular-nums font-medium">{d.gp_per_unit_pence == null ? '-' : penceText(Math.round(d.gp_per_unit_pence))}</td>}
                {sales && <td className="px-2 py-2 text-right tabular-nums">{d.gp_pence == null ? '-' : penceText(d.gp_pence)}</td>}
                {sales && <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{d.cost_pct == null ? '-' : pctText(d.cost_pct)}</td>}
                {!sales && <td className="px-4 py-2 text-right">{d.popular ? 'Yes' : 'No'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function DishDrawer({ dish, section, sales, onClose }) {
  const words = CLASSES[dish.class]
  return (
    <Drawer title={dish.name} subtitle={sectionName(section)} onClose={onClose}
      footer={(
        <>
          <Link to={'/menu-margins?tab=margins' + (section.menu_id ? '&menu=' + section.menu_id : '') + '&dish=' + dish.dish_id} className={cn(btn.outline, 'h-12')} data-testid="eng-open-margin">Its margin now</Link>
          <Link to={'/recipes?tab=dishes&dish=' + dish.dish_id} className={cn(btn.outline, 'h-12')}>Its recipe</Link>
        </>
      )}>
      <div className="space-y-4" data-testid="eng-drawer">
        <Card title="What it is">
          {sales ? (
            <>
              <ClassBadge cls={dish.class} />
              <p className="text-sm mt-2">{words ? words.hint : NOT_COSTED}</p>
              {words && <p className="text-sm font-medium mt-2">{words.suggestion}</p>}
            </>
          ) : <p className="text-sm">{dish.popular ? 'Popular' : 'Not popular'} in its section. Its class needs till reports view (GP comes from what the till took).</p>}
        </Card>
        <Card title="Its figures">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Units sold</dt><dd className="tabular-nums text-right">{qtyText(dish.units)}</dd>
            <dt className="text-muted-foreground">Share of the section</dt><dd className="tabular-nums text-right">{pctText(dish.share_pct)} (popular from {pctText(section.popular_pct)})</dd>
            {sales && <><dt className="text-muted-foreground">GP a unit</dt><dd className="tabular-nums text-right">{dish.gp_per_unit_pence == null ? '-' : penceText(Math.round(dish.gp_per_unit_pence))} (average {averageText(section, penceText)})</dd></>}
            {sales && <><dt className="text-muted-foreground">Total GP</dt><dd className="tabular-nums text-right">{dish.gp_pence == null ? '-' : penceText(dish.gp_pence)}</dd></>}
            {sales && <><dt className="text-muted-foreground">Net sales</dt><dd className="tabular-nums text-right">{dish.net_pence == null ? '-' : penceText(dish.net_pence)}</dd></>}
            <dt className="text-muted-foreground">Theoretical cost</dt><dd className="tabular-nums text-right">{dish.cost_pence == null ? '-' : penceText(dish.cost_pence)}</dd>
            {sales && <><dt className="text-muted-foreground">Cost %</dt><dd className="tabular-nums text-right">{dish.cost_pct == null ? '-' : pctText(dish.cost_pct)}</dd></>}
            {dish.uncosted_units > 0 && <><dt className="text-muted-foreground">Left out of GP</dt><dd className="tabular-nums text-right">{qtyText(dish.uncosted_units)} units (not every unit was costed)</dd></>}
          </dl>
        </Card>
      </div>
    </Drawer>
  )
}
