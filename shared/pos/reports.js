// shared/pos/reports.js
//
// Trading-day figures (X report while trading, Z report when the day is
// closed). ONE implementation for the till (offline X report), the cloud
// (Z report, POS reports page, Cash Recon feed) and later the hub.
//
// A trading day (pos_days) opens with the first event after the last Z
// report. Checks belong to the day they were opened in (Z needs every check
// closed first); payments, refunds and voids count on the day they happened
// (each carries day_id), so a refund on yesterday's check counts today.

import { checkTotals, isActiveLine, lineGross } from './pricing.js'
import { TENDERS } from './checks.js'
import { numberText } from './numbers.js'

/** Venue-local date a moment belongs to, when the trading day starts at `dayStartsAt` ('04:00'). */
export function businessDate(at, timeZone = 'Europe/London', dayStartsAt = '00:00') {
  const [h, m] = String(dayStartsAt || '00:00').split(':').map(Number)
  const shifted = new Date(new Date(at).getTime() - ((h || 0) * 60 + (m || 0)) * 60000)
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(shifted)
  const v = Object.fromEntries(parts.map(x => [x.type, x.value]))
  return v.year + '-' + v.month + '-' + v.day
}

const add = (map, key, init) => {
  if (!map.has(key)) map.set(key, init())
  return map.get(key)
}

/**
 * Figures for one trading day.
 *   checks  every check opened that day, plus any older check with a
 *           payment, refund or void that day
 *   dayId   the day
 * Returns plain numbers in pence (see the fields below).
 */
export function dayFigures(checks, dayId) {
  const counts = { closed: 0, open: 0, void: 0, merged: 0 }
  let covers = 0
  const sales = { gross: 0, discounts: 0, net: 0, service_charge: 0, total: 0, vat_total: 0 }
  const vat = new Map()
  const byStream = new Map()
  const byType = new Map()
  const byTender = new Map()
  const byStaff = new Map()
  const discounts = new Map()
  const items = new Map()
  const voids = { count: 0, qty: 0, value: 0, lines: [] }
  const refunds = { count: 0, amount: 0, lines: [] }
  const openChecks = []
  let tips = 0

  for (const c of checks) {
    const inDay = c.day_id === dayId
    if (inDay) counts[c.status] = (counts[c.status] || 0) + 1

    if (inDay && c.status === 'open') {
      const t = checkTotals(c)
      openChecks.push({ id: c.id, number: numberText(c), order_no: c.order_no, table_id: c.table_id, tab_name: c.tab_name, total: t.total, balance: t.balance, server_id: c.server_id })
    }

    if (inDay && c.status === 'closed') {
      const t = checkTotals(c)
      covers += Number(c.covers) || 0
      sales.gross += t.subtotal
      sales.discounts += t.discount
      sales.net += t.net
      sales.service_charge += t.service_charge
      sales.total += t.total
      sales.vat_total += t.vat_total
      for (const v of t.vat) {
        const row = add(vat, v.rate, () => ({ rate: v.rate, net: 0, vat: 0, gross: 0 }))
        row.net += v.net; row.vat += v.vat; row.gross += v.gross
      }
      const lineById = Object.fromEntries(c.lines.map(l => [l.id, l]))
      for (const lt of t.lines) {
        const l = lineById[lt.id]
        const sid = l.revenue_stream_id || c.revenue_stream_id || null
        const rs = add(byStream, sid, () => ({ id: sid, net: 0, vat: 0, gross: 0, discount: 0, items: 0 }))
        rs.net += lt.net; rs.vat += lt.vat; rs.gross += lt.gross; rs.discount += lt.discount; rs.items += l.qty
        const it = add(items, l.item_id || l.name, () => ({ item_id: l.item_id || null, name: l.name, qty: 0, net: 0 }))
        it.qty += l.qty; it.net += lt.net
      }
      for (const d of t.discounts) {
        if (d.amount <= 0) continue
        const row = add(discounts, (d.promotion ? 'promo:' : d.comp ? 'comp:' : 'disc:') + d.name, () => ({ name: d.name, comp: !!d.comp, promotion: !!d.promotion, count: 0, amount: 0 }))
        row.count++; row.amount += d.amount
      }
      const ot = add(byType, c.order_type_id || null, () => ({ id: c.order_type_id || null, checks: 0, net: 0, total: 0 }))
      ot.checks++; ot.net += t.net; ot.total += t.total
      const s = add(byStaff, c.server_id, () => ({ id: c.server_id, checks: 0, net: 0, total: 0, tips: 0, covers: 0 }))
      s.checks++; s.net += t.net; s.total += t.total; s.covers += Number(c.covers) || 0
    }

    for (const p of c.payments || []) {
      if (p.voided || p.day_id !== dayId) continue
      const row = add(byTender, p.tender, () => ({ tender: p.tender, count: 0, amount: 0, tips: 0, refunds: 0 }))
      row.count++; row.amount += p.amount; row.tips += p.tip || 0
      tips += p.tip || 0
      const s = add(byStaff, p.by, () => ({ id: p.by, checks: 0, net: 0, total: 0, tips: 0, covers: 0 }))
      s.tips += p.tip || 0
    }
    for (const r of c.refunds || []) {
      if (r.day_id !== dayId) continue
      refunds.count++; refunds.amount += r.amount
      refunds.lines.push({ check_id: c.id, number: numberText(c), tender: r.tender, amount: r.amount, reason: r.reason, by: r.by, approved_by: r.approved_by || null, at: r.at })
      const row = add(byTender, r.tender, () => ({ tender: r.tender, count: 0, amount: 0, tips: 0, refunds: 0 }))
      row.refunds += r.amount
    }
    for (const l of c.lines || []) {
      if (isActiveLine(l) || l.voided?.day_id !== dayId) continue
      const value = lineGross(l)
      voids.count++; voids.qty += l.qty; voids.value += value
      voids.lines.push({ check_id: c.id, number: numberText(c), name: l.name, qty: l.qty, value, reason: l.voided.reason, waste: l.voided.waste, by: l.voided.by, approved_by: l.voided.approved_by, at: l.voided.at })
    }
  }

  const tenders = [...byTender.values()].map(t => ({
    ...t, label: TENDERS.find(x => x.key === t.tender)?.label || t.tender, net: t.amount - t.refunds,
  }))
  const cash = byTender.get('cash')
  return {
    counts, covers,
    sales: { ...sales, average_check: counts.closed ? Math.round(sales.total / counts.closed) : 0, per_cover: covers ? Math.round(sales.total / covers) : 0 },
    vat: [...vat.values()].sort((a, b) => a.rate - b.rate),
    revenue_streams: [...byStream.values()],
    order_types: [...byType.values()],
    tenders,
    takings: tenders.reduce((s, t) => s + t.amount + t.tips - t.refunds, 0),
    tips,
    refunds,
    voids,
    discounts: [...discounts.values()].sort((a, b) => b.amount - a.amount),
    items: [...items.values()].sort((a, b) => b.qty - a.qty),
    staff: [...byStaff.values()],
    open_checks: openChecks,
    cash_expected: cash ? cash.amount + cash.tips - cash.refunds : 0,
  }
}
