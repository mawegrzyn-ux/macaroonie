// src/components/staff/rotaExport.js
//
// Print / PDF and image export of a week's rota, no extra libraries.
//
//   buildRotaSheet()  turns the grid's entries into the sheet: one row per
//                     person, the days across, and per day the shift tiles
//                     (day-parts mode) or the times (hourly mode), exactly
//                     as the Rota grid shows them, without its buttons, the
//                     roles and the totals.
//   printRota()       writes that sheet into a hidden iframe as an A4
//                     landscape page and opens the browser's print dialog,
//                     where "Save as PDF" gives the PDF.
//   saveRotaImage()   draws the same sheet on a canvas and saves it as a
//                     JPG (or opens the share sheet on touch devices, so it
//                     can go straight to a staff group chat).
//
// Both outputs come from the one sheet, so they always match each other
// and the grid on screen (including unsaved changes, which are flagged).

import { format, parseISO } from 'date-fns'

const hhmm = t => (t ? String(t).slice(0, 5) : '')
const toMin = t => { const [h, m] = hhmm(t).split(':').map(Number); return h * 60 + (m || 0) }

/**
 * What a rota entry records (rota_entries.status, migration 129). Order is
 * the order of the grid's per-person mode menu. `solid` is the tile colour
 * (the grid's STATUS_CLS in rota.jsx, keep them the same) and `soft` the
 * tinted box of an hourly cell (STATUS_SOFT there).
 */
export const ENTRY_STATUSES = [
  { key: 'on',   label: 'ON',   name: 'Working',         solid: '#16a34a', soft: { bg: '#e8f6ed', fg: '#14532d' } },
  { key: 'sick', label: 'SICK', name: 'Sick',            solid: '#dc2626', soft: { bg: '#fce9e9', fg: '#7f1d1d' } },
  { key: 'pto',  label: 'PTO',  name: 'Paid time off',   solid: '#0284c7', soft: { bg: '#e6f3f9', fg: '#0c4a6e' } },
  { key: 'uto',  label: 'UTO',  name: 'Unpaid time off', solid: '#7c3aed', soft: { bg: '#f2ebfd', fg: '#4c1d95' } },
  { key: 'abs',  label: 'ABS',  name: 'Absent',          solid: '#f59e0b', soft: { bg: '#fef1da', fg: '#78350f' } },
]
export const STATUS_BY_KEY = Object.fromEntries(ENTRY_STATUSES.map(s => [s.key, s]))
export const statusOf = e => (e.status && STATUS_BY_KEY[e.status] ? e.status : 'on')

// The grid's own greys (index.css --muted, --border, --muted-foreground).
const C = {
  head:     '#eeeff2',  // bg-muted
  subHead:  '#f4f5f7',  // bg-muted/60
  border:   '#d7dae0',
  text:     '#111827',
  muted:    '#5d6371',
  offBg:    '#f3f4f6',  // an OFF tile
  offFg:    '#9ca3af',
  awayBg:   '#f3f4f6',  // a day off the rota (Staff page), hatched
  awayFg:   '#6b7280',
}

/**
 * Days to show: every day, or (hideClosed) only the days the venue is open,
 * per week.open_dates from its booking schedule. A closed day that still
 * has someone rostered is always kept. open_dates null = no schedule, show all.
 */
export function visibleRotaDates({ week, entries, hideClosed }) {
  if (!hideClosed || !Array.isArray(week.open_dates)) return week.dates
  const open = new Set(week.open_dates)
  const worked = new Set(entries.map(e => e.work_date))
  return week.dates.filter(d => open.has(d) || worked.has(d))
}

/** True when the venue's schedule says it is closed that day (null schedule = never). */
export function isClosedDay(week, date) {
  return Array.isArray(week.open_dates) && !week.open_dates.includes(date)
}

/**
 * @param {object} p
 * @param {object} p.week       GET /rota/.../weeks/:week payload (staff = the grid's rows)
 * @param {Array}  p.entries    entries shown on the grid (current mode, may be a draft)
 * @param {string} p.mode       'day_parts' | 'hourly'
 * @param {string} p.venueName
 * @param {boolean} p.unsaved   the grid has unsaved changes
 * @param {boolean} p.hideClosed leave out closed days (rota_settings.hide_closed_on_print)
 * @returns sheet: { title, subtitle, printed, fileName, mode, days, shifts, rows, legend }
 *   rows[].cells[] per day: { away: 'LEFT' | 'AWAY' }, or day parts
 *   { tiles: [status key | null per shift] }, or hourly { periods: [{ text, status }] }.
 */
export function buildRotaSheet({ week, entries, mode, venueName, unsaved, hideClosed = false }) {
  const usedShiftIds = new Set(entries.filter(e => e.shift_id).map(e => e.shift_id))
  // The grid's columns: active shifts, plus any old one this week still uses.
  const shifts = mode === 'day_parts'
    ? week.shifts.filter(s => s.is_active || usedShiftIds.has(s.id))
    : []
  const dates = visibleRotaDates({ week, entries, hideClosed })
  const days = dates.map(d => ({ date: d, label: format(parseISO(d), 'EEE d'), closed: isClosedDay(week, d) }))

  const usedStatuses = new Set()
  const rows = week.staff.map(st => ({
    name: st.name,
    cells: dates.map(d => {
      const away = st.off_days?.[d]
      if (away) return { away: away.kind === 'left' ? 'LEFT' : 'AWAY' }
      const mine = entries.filter(e => e.staff_id === st.id && e.work_date === d)
      if (mode === 'day_parts') {
        const byShift = new Map(mine.filter(e => e.shift_id).map(e => [e.shift_id, statusOf(e)]))
        for (const s of byShift.values()) usedStatuses.add(s)
        return { tiles: shifts.map(s => byShift.get(s.id) ?? null) }
      }
      const periods = mine.filter(e => !e.shift_id)
        .sort((a, b) => toMin(a.start_time) - toMin(b.start_time))
        .map(e => ({ text: `${hhmm(e.start_time)}–${hhmm(e.end_time)}`, status: statusOf(e) }))
      for (const p of periods) usedStatuses.add(p.status)
      return { periods }
    }),
  }))

  const legend = shifts.map(s => `${s.name} ${hhmm(s.start_time)}–${hhmm(s.end_time)}`)
  for (const st of ENTRY_STATUSES) if (st.key !== 'on' && usedStatuses.has(st.key)) legend.push(`${st.label} = ${st.name}`)

  const weekLabel = `${format(parseISO(week.dates[0]), 'd MMM')} – ${format(parseISO(week.dates[6]), 'd MMM yyyy')}`
  return {
    title:    venueName ? `Rota: ${venueName}` : 'Rota',
    subtitle: `Week ${weekLabel}${unsaved ? ' · DRAFT, not saved' : ''}`,
    printed:  `Printed ${format(new Date(), 'd MMM yyyy HH:mm')}`,
    fileName: `rota-${slug(venueName)}-${week.week_start}`,
    mode,
    days,
    shifts: shifts.map(s => ({ id: s.id, name: s.name })),
    rows,
    legend,
  }
}

function slug(s) {
  return String(s || 'venue').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'venue'
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

const tileText = key => (key ? STATUS_BY_KEY[key].label : 'OFF')

// ── Print / PDF ───────────────────────────────────────────────

export function rotaHtml(sheet) {
  const dayParts = sheet.mode === 'day_parts'
  const per = dayParts ? Math.max(1, sheet.shifts.length) : 1

  const dayHead = sheet.days.map(d => `
      <th class="day" colspan="${per}">${esc(d.label)}${d.closed ? '<span class="closed">Closed</span>' : ''}</th>`).join('')
  const shiftHead = dayParts
    ? `<tr class="shifts">${sheet.days.map(() => sheet.shifts.map((s, i) => `<th class="${i === 0 ? 'first' : ''}">${esc(s.name)}</th>`).join('')).join('')}</tr>`
    : ''

  const cell = c => {
    if (c.away) return `<td class="first" colspan="${per}"><div class="tile away">${c.away}</div></td>`
    if (dayParts) {
      if (!c.tiles.length) return '<td class="first"></td>'
      return c.tiles.map((key, i) => `<td class="${i === 0 ? 'first' : ''}"><div class="tile ${key ? `st-${key}` : 'off'}${tileText(key).length > 3 ? ' long' : ''}">${tileText(key)}</div></td>`).join('')
    }
    if (!c.periods.length) return '<td class="first"></td>'
    const tone = c.periods.some(p => p.status === 'on') ? 'on' : c.periods[0].status
    const lines = c.periods.map(p => `<div class="time">${esc(p.text)}${p.status !== 'on' ? ` <span class="badge st-${p.status}">${STATUS_BY_KEY[p.status].label}</span>` : ''}</div>`).join('')
    return `<td class="first"><div class="box soft-${tone}">${lines}</div></td>`
  }
  const body = sheet.rows.map(r => `
    <tr><td class="name">${esc(r.name)}</td>${r.cells.map(cell).join('')}</tr>`).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sheet.fileName)}</title>
<style>
  /* Chrome's Margins "Minimum" / "None" replace the @page margin, so the
     body keeps its own padding too; the rota never touches the paper edge. */
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, "Segoe UI", Roboto, Arial, sans-serif; color: ${C.text}; margin: 0; padding: 6mm;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 16pt; margin: 0 0 2pt; }
  .sub { font-size: 10pt; color: #444; margin-bottom: 8pt; }
  .wrap { border: 1px solid ${C.border}; border-radius: 10px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10pt; }
  th, td { padding: 2px; text-align: center; vertical-align: middle; }
  thead th { background: ${C.head}; font-weight: 600; }
  thead th.staff { text-align: left; padding: 6px 10px; width: ${dayParts ? 15 : 14}%; border-right: 1px solid ${C.border}; }
  th.day { padding: 6px 2px; border-left: 1px solid ${C.border}; white-space: nowrap; }
  .closed { display: block; font-size: 7.5pt; font-weight: 400; color: ${C.muted}; }
  tr.shifts th { background: ${C.subHead}; font-weight: 400; font-size: 8pt; color: ${C.muted}; padding: 3px 2px;
                 white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .first { border-left: 1px solid ${C.border}; }
  tbody tr { border-top: 1px solid ${C.border}; break-inside: avoid; page-break-inside: avoid; }
  td.name { text-align: left; padding: 4px 10px; font-weight: 500; border-right: 1px solid ${C.border};
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile { height: 30px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: 9.5pt; color: #fff; }
  .tile.long { font-size: 8pt; }
  .tile.off { background: ${C.offBg}; color: ${C.offFg}; font-weight: 600; }
  .tile.away { background: ${C.awayBg}; color: ${C.awayFg}; font-size: 8pt;
               background-image: repeating-linear-gradient(135deg, rgba(0,0,0,0.07) 0 6px, transparent 6px 12px); }
  ${ENTRY_STATUSES.map(st => `.st-${st.key} { background: ${st.solid}; color: #fff; }`).join('\n  ')}
  .box { min-height: 30px; border-radius: 6px; padding: 3px 6px; text-align: left; font-size: 8.5pt; font-variant-numeric: tabular-nums; }
  ${ENTRY_STATUSES.map(st => `.soft-${st.key} { background: ${st.soft.bg}; color: ${st.soft.fg}; }`).join('\n  ')}
  .time { white-space: nowrap; line-height: 1.5; }
  .badge { display: inline-block; border-radius: 3px; padding: 0 3px; font-size: 7pt; font-weight: 700; }
  thead { display: table-header-group; }
  .meta { display: flex; justify-content: space-between; gap: 12pt; font-size: 8pt; color: #666; margin-top: 6pt; }
</style></head><body>
  <h1>${esc(sheet.title)}</h1>
  <div class="sub">${esc(sheet.subtitle)}</div>
  <div class="wrap"><table>
    <thead>
      <tr><th class="staff"${dayParts ? ' rowspan="2"' : ''}>Staff</th>${dayHead}</tr>
      ${shiftHead}
    </thead>
    <tbody>${body}</tbody>
  </table></div>
  <div class="meta"><span>${esc(sheet.legend.join('  ·  '))}</span><span>${esc(sheet.printed)}</span></div>
</body></html>`
}

/** Open the print dialog for the sheet (choose "Save as PDF" there for a PDF). */
export function printRota(sheet) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const cleanup = () => { if (frame.parentNode) frame.parentNode.removeChild(frame) }
  frame.onload = () => {
    const win = frame.contentWindow
    win.addEventListener('afterprint', () => setTimeout(cleanup, 100))
    win.focus()
    win.print()
    // Fallback for browsers that never fire afterprint.
    setTimeout(cleanup, 60_000)
  }
  frame.srcdoc = rotaHtml(sheet)
}

// ── Image ─────────────────────────────────────────────────────

const FONT = '-apple-system, system-ui, "Segoe UI", Roboto, Arial, sans-serif'

function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Draw the sheet onto a canvas (2x for crisp text). Exported for testing. */
export function drawRotaCanvas(sheet, scale = 2) {
  const dayParts = sheet.mode === 'day_parts'
  const per = dayParts ? Math.max(1, sheet.shifts.length) : 1
  const pad = 24, titleH = 64, metaH = 30
  const nameW = 170
  const slotW = dayParts ? 60 : 124          // one shift column, or one hourly day
  const dayW = slotW * per
  const tileH = 40, inset = 2
  const lineH = 18
  const anyClosed = sheet.days.some(d => d.closed)
  const headH = anyClosed ? 46 : 36
  const subH = dayParts ? 24 : 0
  const rowHeights = sheet.rows.map(r => dayParts
    ? tileH + inset * 2 + 4
    : Math.max(tileH + inset * 2 + 4, ...r.cells.map(c => (c.periods?.length ?? 0) * lineH + 16)))
  const tableW = nameW + dayW * sheet.days.length
  const tableH = headH + subH + rowHeights.reduce((a, b) => a + b, 0)
  const width = pad * 2 + tableW
  const height = pad + titleH + tableH + metaH + pad

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)
  // A JPG has no transparency: the whole sheet sits on white.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'middle'

  ctx.fillStyle = C.text
  ctx.font = `bold 20px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(sheet.title, pad, pad + 14)
  ctx.fillStyle = '#444444'
  ctx.font = `13px ${FONT}`
  ctx.fillText(sheet.subtitle, pad, pad + 40)

  const x0 = pad, y0 = pad + titleH
  const dayX = i => x0 + nameW + i * dayW

  // Everything inside the rounded frame is clipped to it.
  ctx.save()
  roundRect(ctx, x0, y0, tableW, tableH, 10)
  ctx.clip()

  // Header rows
  ctx.fillStyle = C.head
  ctx.fillRect(x0, y0, tableW, headH)
  if (dayParts) {
    ctx.fillStyle = C.subHead
    ctx.fillRect(x0 + nameW, y0 + headH, tableW - nameW, subH)
    ctx.fillStyle = C.head
    ctx.fillRect(x0, y0 + headH, nameW, subH)
  }
  ctx.fillStyle = C.text
  ctx.font = `600 14px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillText('Staff', x0 + 12, y0 + (headH + subH) / 2)
  sheet.days.forEach((d, i) => {
    const cx = dayX(i) + dayW / 2
    ctx.textAlign = 'center'
    ctx.fillStyle = C.text
    ctx.font = `600 14px ${FONT}`
    ctx.fillText(fit(ctx, d.label, dayW - 6), cx, y0 + (d.closed ? 16 : headH / 2))
    if (d.closed) {
      ctx.fillStyle = C.muted
      ctx.font = `10px ${FONT}`
      ctx.fillText('Closed', cx, y0 + 33)
    }
    if (dayParts) {
      ctx.fillStyle = C.muted
      ctx.font = `11px ${FONT}`
      sheet.shifts.forEach((s, si) => {
        ctx.fillText(fit(ctx, s.name, slotW - 6), dayX(i) + si * slotW + slotW / 2, y0 + headH + subH / 2)
      })
    }
  })

  // Rows
  let y = y0 + headH + subH
  sheet.rows.forEach((r, ri) => {
    const h = rowHeights[ri]
    ctx.textAlign = 'left'
    ctx.fillStyle = C.text
    ctx.font = `500 14px ${FONT}`
    ctx.fillText(fit(ctx, r.name, nameW - 24), x0 + 12, y + h / 2)

    r.cells.forEach((c, i) => {
      const dx = dayX(i)
      if (c.away) {
        const tx = dx + inset, ty = y + inset + 2, tw = dayW - inset * 2, th = h - inset * 2 - 4
        ctx.save()
        roundRect(ctx, tx, ty, tw, th, 6)
        ctx.fillStyle = C.awayBg
        ctx.fill()
        ctx.clip()
        ctx.strokeStyle = 'rgba(0,0,0,0.07)'
        ctx.lineWidth = 6
        for (let k = -th; k < tw + th; k += 12) {
          ctx.beginPath()
          ctx.moveTo(tx + k, ty + th)
          ctx.lineTo(tx + k + th, ty)
          ctx.stroke()
        }
        ctx.restore()
        ctx.textAlign = 'center'
        ctx.fillStyle = C.awayFg
        ctx.font = `600 11px ${FONT}`
        ctx.fillText(c.away, tx + tw / 2, ty + th / 2)
        return
      }
      if (dayParts) {
        c.tiles.forEach((key, si) => {
          const tx = dx + si * slotW + inset, ty = y + inset + 2, tw = slotW - inset * 2, th = h - inset * 2 - 4
          roundRect(ctx, tx, ty, tw, th, 6)
          ctx.fillStyle = key ? STATUS_BY_KEY[key].solid : C.offBg
          ctx.fill()
          const label = tileText(key)
          ctx.textAlign = 'center'
          ctx.fillStyle = key ? '#ffffff' : C.offFg
          ctx.font = `${key ? 700 : 600} ${label.length > 3 ? 11 : 13}px ${FONT}`
          ctx.fillText(label, tx + tw / 2, ty + th / 2)
        })
        return
      }
      if (!c.periods.length) return
      const tone = STATUS_BY_KEY[c.periods.some(p => p.status === 'on') ? 'on' : c.periods[0].status].soft
      const tx = dx + inset, ty = y + inset + 2, tw = dayW - inset * 2, th = h - inset * 2 - 4
      roundRect(ctx, tx, ty, tw, th, 6)
      ctx.fillStyle = tone.bg
      ctx.fill()
      const top = ty + (th - c.periods.length * lineH) / 2 + lineH / 2
      c.periods.forEach((p, pi) => {
        const ly = top + pi * lineH
        ctx.textAlign = 'left'
        ctx.fillStyle = tone.fg
        ctx.font = `12px ${FONT}`
        ctx.fillText(p.text, tx + 7, ly)
        if (p.status !== 'on') {
          const st = STATUS_BY_KEY[p.status]
          const bx = tx + 7 + ctx.measureText(p.text).width + 5
          ctx.font = `bold 9px ${FONT}`
          const bw = ctx.measureText(st.label).width + 6
          roundRect(ctx, bx, ly - 7, bw, 14, 3)
          ctx.fillStyle = st.solid
          ctx.fill()
          ctx.fillStyle = '#ffffff'
          ctx.fillText(st.label, bx + 3, ly)
        }
      })
    })
    y += h
  })

  // Lines: name column, between days, between rows, under the header.
  ctx.strokeStyle = C.border
  ctx.lineWidth = 1
  const line = (ax, ay, bx, by) => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke() }
  line(x0 + nameW + 0.5, y0, x0 + nameW + 0.5, y0 + tableH)
  sheet.days.forEach((_, i) => { if (i > 0) line(dayX(i) + 0.5, y0, dayX(i) + 0.5, y0 + tableH) })
  let ry = y0 + headH + subH
  line(x0, ry + 0.5, x0 + tableW, ry + 0.5)
  rowHeights.forEach((h, i) => { ry += h; if (i < rowHeights.length - 1) line(x0, ry + 0.5, x0 + tableW, ry + 0.5) })
  ctx.restore()

  roundRect(ctx, x0 + 0.5, y0 + 0.5, tableW - 1, tableH - 1, 10)
  ctx.strokeStyle = C.border
  ctx.stroke()

  const my = y0 + tableH + 16
  ctx.font = `11px ${FONT}`
  ctx.fillStyle = '#666666'
  ctx.textAlign = 'left'
  ctx.fillText(fit(ctx, sheet.legend.join('  ·  '), tableW - 200), x0, my)
  ctx.textAlign = 'right'
  ctx.fillText(sheet.printed, x0 + tableW, my)

  return canvas
}

/**
 * Save the sheet as a JPG. On touch devices that support sharing files,
 * open the share sheet instead (e.g. to send it to a staff group chat).
 */
export async function saveRotaImage(sheet, { preferShare = false } = {}) {
  const canvas = drawRotaCanvas(sheet)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) throw new Error('Could not create the image')
  const name = `${sheet.fileName}.jpg`
  if (preferShare && typeof File !== 'undefined' && navigator.canShare) {
    const file = new File([blob], name, { type: 'image/jpeg' })
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: sheet.title })
        return
      } catch (e) {
        if (e?.name === 'AbortError') return
        // Sharing failed for another reason: fall through to download.
      }
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
