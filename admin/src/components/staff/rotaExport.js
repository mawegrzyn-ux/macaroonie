// src/components/staff/rotaExport.js
//
// Print / PDF and image export of a week's rota, no extra libraries.
//
//   buildRotaSheet()  turns the grid's entries into a printable table:
//                     one row per person, one column per day, each cell
//                     listing the shifts (day-parts mode) or the times
//                     (hourly mode) that person works.
//   printRota()       writes that table into a hidden iframe as an A4
//                     landscape page and opens the browser's print dialog,
//                     where "Save as PDF" gives the PDF.
//   saveRotaImage()   draws the same table on a canvas and saves it as a
//                     PNG (or opens the share sheet on touch devices, so
//                     it can go straight to a staff group chat).
//
// Both outputs come from the one sheet, so they always match each other
// and the grid on screen (including unsaved changes, which are flagged).

import { format, parseISO } from 'date-fns'

const hhmm = t => (t ? String(t).slice(0, 5) : '')
const toMin = t => { const [h, m] = hhmm(t).split(':').map(Number); return h * 60 + (m || 0) }
const rangeMin = (s, e) => { let d = toMin(e) - toMin(s); if (d <= 0) d += 1440; return d }
const hoursLabel = mins => `${Math.round((mins / 60) * 100) / 100}h`

/**
 * @param {object} p
 * @param {object} p.week       GET /rota/.../weeks/:week payload
 * @param {Array}  p.entries    entries shown on the grid (current mode, may be a draft)
 * @param {string} p.mode       'day_parts' | 'hourly'
 * @param {string} p.venueName
 * @param {boolean} p.unsaved   the grid has unsaved changes
 */
export function buildRotaSheet({ week, entries, mode, venueName, unsaved }) {
  const shiftById = Object.fromEntries(week.shifts.map(s => [s.id, s]))
  const shiftOrder = Object.fromEntries(week.shifts.map((s, i) => [s.id, i]))
  const days = week.dates.map(d => ({ date: d, label: format(parseISO(d), 'EEE d MMM') }))

  const rows = week.staff.map(st => {
    let minutes = 0
    const cells = week.dates.map(d => {
      const mine = entries.filter(e => e.staff_id === st.id && e.work_date === d)
      if (mode === 'day_parts') {
        return mine.filter(e => e.shift_id && shiftById[e.shift_id])
          .sort((a, b) => shiftOrder[a.shift_id] - shiftOrder[b.shift_id])
          .map(e => {
            const s = shiftById[e.shift_id]
            minutes += rangeMin(s.start_time, s.end_time)
            return s.name
          })
      }
      return mine.filter(e => !e.shift_id)
        .sort((a, b) => toMin(a.start_time) - toMin(b.start_time))
        .map(e => {
          minutes += rangeMin(e.start_time, e.end_time)
          return `${hhmm(e.start_time)}–${hhmm(e.end_time)}`
        })
    })
    return { name: st.name, role: st.role_name ?? '', cells, hours: hoursLabel(minutes), working: minutes > 0 }
  })

  const counts = week.dates.map((_, i) => rows.filter(r => r.cells[i].length > 0).length)
  const usedShiftIds = new Set(entries.filter(e => e.shift_id).map(e => e.shift_id))
  const legend = mode === 'day_parts'
    ? week.shifts.filter(s => s.is_active || usedShiftIds.has(s.id)).map(s => `${s.name} ${hhmm(s.start_time)}–${hhmm(s.end_time)}`)
    : []

  const weekLabel = `${format(parseISO(week.dates[0]), 'd MMM')} – ${format(parseISO(week.dates[6]), 'd MMM yyyy')}`
  return {
    title:    venueName ? `Rota: ${venueName}` : 'Rota',
    subtitle: `Week ${weekLabel}${unsaved ? ' · DRAFT, not saved' : ''}`,
    printed:  `Printed ${format(new Date(), 'd MMM yyyy HH:mm')}`,
    days,
    rows,
    counts,
    legend,
    fileName: `rota-${slug(venueName)}-${week.week_start}`,
  }
}

function slug(s) {
  return String(s || 'venue').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'venue'
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ── Print / PDF ───────────────────────────────────────────────

export function rotaHtml(sheet) {
  const head = sheet.days.map(d => `<th>${esc(d.label)}</th>`).join('')
  const body = sheet.rows.map(r => `
    <tr>
      <td class="name"><strong>${esc(r.name)}</strong>${r.role ? `<div class="role">${esc(r.role)}</div>` : ''}</td>
      ${r.cells.map(c => `<td class="${c.length ? 'on' : 'off'}">${c.length ? c.map(esc).join('<br>') : '–'}</td>`).join('')}
      <td class="hours">${esc(r.working ? r.hours : '')}</td>
    </tr>`).join('')
  const foot = sheet.counts.map(n => `<td>${n || ''}</td>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sheet.fileName)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 16pt; margin: 0 0 2pt; }
  .sub { font-size: 10pt; color: #444; margin-bottom: 6pt; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9pt; }
  th, td { border: 1px solid #999; padding: 3pt 4pt; vertical-align: top; text-align: center; }
  th { background: #e5e7eb; font-weight: 600; }
  th.name, td.name { text-align: left; width: 18%; }
  th.hours, td.hours { width: 6%; text-align: right; }
  td.on { background: #dcfce7; font-weight: 600; }
  td.off { color: #9ca3af; }
  .role { font-size: 8pt; color: #555; font-weight: 400; }
  tfoot td { background: #f3f4f6; font-size: 8pt; }
  tr { page-break-inside: avoid; }
  .meta { display: flex; justify-content: space-between; font-size: 8pt; color: #666; margin-top: 6pt; }
</style></head><body>
  <h1>${esc(sheet.title)}</h1>
  <div class="sub">${esc(sheet.subtitle)}</div>
  <table>
    <thead><tr><th class="name">Staff</th>${head}<th class="hours">Hours</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><td class="name">Working</td>${foot}<td></td></tr></tfoot>
  </table>
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

/** Draw the sheet onto a canvas (2x for crisp text). Exported for testing. */
export function drawRotaCanvas(sheet, scale = 2) {
  const pad = 24, nameW = 190, dayW = 124, hoursW = 70, lineH = 17, cellPad = 7
  const headH = 32, titleH = 60, footH = 28, metaH = 30
  const rowHeights = sheet.rows.map(r => {
    const lines = Math.max(1, ...r.cells.map(c => c.length))
    return Math.max(38, lines * lineH + cellPad * 2, r.role ? 38 : 0)
  })
  const tableW = nameW + dayW * sheet.days.length + hoursW
  const width = pad * 2 + tableW
  const height = pad + titleH + headH + rowHeights.reduce((a, b) => a + b, 0) + footH + metaH + pad

  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'middle'

  ctx.fillStyle = '#111111'
  ctx.font = `bold 20px ${FONT}`
  ctx.fillText(sheet.title, pad, pad + 14)
  ctx.fillStyle = '#444444'
  ctx.font = `13px ${FONT}`
  ctx.fillText(sheet.subtitle, pad, pad + 40)

  const x0 = pad
  let y = pad + titleH
  const colX = [x0, x0 + nameW]
  for (let i = 1; i < sheet.days.length; i++) colX.push(colX[colX.length - 1] + dayW)
  colX.push(colX[colX.length - 1] + dayW) // hours column start

  function cellBox(x, yy, w, h, fill) {
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, yy, w, h) }
    ctx.strokeStyle = '#9ca3af'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, yy + 0.5, w, h)
  }

  // Header
  ctx.font = `600 13px ${FONT}`
  cellBox(x0, y, nameW, headH, '#e5e7eb')
  ctx.fillStyle = '#111111'
  ctx.textAlign = 'left'
  ctx.fillText('Staff', x0 + cellPad, y + headH / 2)
  sheet.days.forEach((d, i) => {
    const x = colX[i + 1]
    cellBox(x, y, dayW, headH, '#e5e7eb')
    ctx.fillStyle = '#111111'
    ctx.textAlign = 'center'
    ctx.fillText(fit(ctx, d.label, dayW - 8), x + dayW / 2, y + headH / 2)
  })
  const hx = colX[colX.length - 1]
  cellBox(hx, y, hoursW, headH, '#e5e7eb')
  ctx.fillStyle = '#111111'
  ctx.textAlign = 'right'
  ctx.fillText('Hours', hx + hoursW - cellPad, y + headH / 2)
  y += headH

  // Rows
  sheet.rows.forEach((r, ri) => {
    const h = rowHeights[ri]
    cellBox(x0, y, nameW, h, '#ffffff')
    ctx.textAlign = 'left'
    ctx.fillStyle = '#111111'
    ctx.font = `600 13px ${FONT}`
    ctx.fillText(fit(ctx, r.name, nameW - cellPad * 2), x0 + cellPad, y + (r.role ? 14 : h / 2))
    if (r.role) {
      ctx.fillStyle = '#555555'
      ctx.font = `11px ${FONT}`
      ctx.fillText(fit(ctx, r.role, nameW - cellPad * 2), x0 + cellPad, y + 29)
    }
    r.cells.forEach((lines, i) => {
      const x = colX[i + 1]
      cellBox(x, y, dayW, h, lines.length ? '#dcfce7' : '#ffffff')
      ctx.textAlign = 'center'
      if (!lines.length) {
        ctx.fillStyle = '#9ca3af'
        ctx.font = `13px ${FONT}`
        ctx.fillText('–', x + dayW / 2, y + h / 2)
        return
      }
      ctx.fillStyle = '#14532d'
      ctx.font = `600 12px ${FONT}`
      const top = y + (h - lines.length * lineH) / 2 + lineH / 2
      lines.forEach((t, li) => ctx.fillText(fit(ctx, t, dayW - 8), x + dayW / 2, top + li * lineH))
    })
    cellBox(hx, y, hoursW, h, '#ffffff')
    ctx.textAlign = 'right'
    ctx.fillStyle = '#111111'
    ctx.font = `12px ${FONT}`
    ctx.fillText(r.working ? r.hours : '', hx + hoursW - cellPad, y + h / 2)
    y += h
  })

  // Footer
  ctx.font = `12px ${FONT}`
  cellBox(x0, y, nameW, footH, '#f3f4f6')
  ctx.textAlign = 'left'
  ctx.fillStyle = '#444444'
  ctx.fillText('Working', x0 + cellPad, y + footH / 2)
  sheet.counts.forEach((n, i) => {
    const x = colX[i + 1]
    cellBox(x, y, dayW, footH, '#f3f4f6')
    ctx.textAlign = 'center'
    ctx.fillStyle = '#444444'
    ctx.fillText(n ? String(n) : '', x + dayW / 2, y + footH / 2)
  })
  cellBox(hx, y, hoursW, footH, '#f3f4f6')
  y += footH

  ctx.font = `11px ${FONT}`
  ctx.fillStyle = '#666666'
  ctx.textAlign = 'left'
  ctx.fillText(fit(ctx, sheet.legend.join('  ·  '), tableW - 200), x0, y + 16)
  ctx.textAlign = 'right'
  ctx.fillText(sheet.printed, x0 + tableW, y + 16)

  return canvas
}

/**
 * Save the sheet as a PNG. On touch devices that support sharing files,
 * open the share sheet instead (e.g. to send it to a staff group chat).
 */
export async function saveRotaImage(sheet, { preferShare = false } = {}) {
  const canvas = drawRotaCanvas(sheet)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not create the image')
  const name = `${sheet.fileName}.png`
  if (preferShare && typeof File !== 'undefined' && navigator.canShare) {
    const file = new File([blob], name, { type: 'image/png' })
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
