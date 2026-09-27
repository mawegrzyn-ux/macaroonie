// src/services/rotaCalc.js
//
// The one implementation of rota maths: hours, pay, tip points and tip
// shares for a venue's week. Pure functions, no DB access. Used by
// routes/rota.js for GET /pay and POST /fill-wages, so the figures on the
// Rota page and the wages it writes can never disagree.
//
// Times are "HH:MM" or "HH:MM:SS" strings. A range whose end is at or
// before its start runs past midnight (end + 24h). Everything is compared
// in minutes from the start of the work date, so a 18:00-02:00 shift is
// [1080, 1560).
//
// Rules:
//   Day-parts entry (shift_id set): counts that whole shift.
//   Hourly entry (start/end set):   counts its own minutes; for each shift
//     it overlaps, that shift counts in proportion (overlap / shift length).
//
//   Points  = sum(shift.points x fraction worked) x role multiplier
//             + the week's manual adjustment. Never below 0 for sharing.
//   Pay:
//     hourly             minutes in a shift at that shift's hourly rate
//                        (staff_shift_rates, else default_rate); minutes
//                        outside every shift at default_rate.
//     fixed / week       default_rate if the person works at all that week.
//     fixed / day        default_rate x days worked.
//     fixed / shift      sum(shift amount x fraction worked); shift amount =
//                        staff_shift_rates.rate, else default_rate.
//     A pay_override for the week replaces the computed pay.
//   Tip pots (tip_pots, migration 108): each pot's gross is its allocated
//   service charge sources plus its manual lines for the week. A surcharge
//   (migration 111, e.g. tax) takes surcharge_pct % off the gross; what is
//   left (total) is what gets shared. By the pot's distribution:
//     house   kept by the house, nobody gets a share.
//     points  pot x person's points / everyone's points, then rounded to a
//             multiple of tipRounding.to (nearest / up / down) when set.
//     manual  whatever payroll entered per person for that pot.
//   A person's tip_share is the sum of their shares across pots, plus the
//   week's £ tip_adjustment (zero-sum £ moves between people), never below 0. Each pot
//   reports distributed and difference (distributed - total): rounding can
//   push a points pot slightly over or under; a manual pot is under while
//   not everything has been handed out.

export function toMinutes(t) {
  if (t == null) return null
  const [h, m] = String(t).split(':').map(Number)
  return h * 60 + (m || 0)
}

/** [start, end) in minutes; end past midnight when end <= start. */
export function span(start, end) {
  const s = toMinutes(start)
  let e = toMinutes(end)
  if (e <= s) e += 24 * 60
  return [s, e]
}

function overlap([a1, a2], [b1, b2]) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))
}

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100
const num = v => (v == null || v === '' ? 0 : Number(v) || 0)

/**
 * Round an amount to a multiple of `to` (e.g. 0.5, 1, 5), in whole pence so
 * floating point never produces 12.499999. mode: 'nearest' | 'up' | 'down'.
 * No `to` (null / 0) = to the penny.
 */
export function roundTip(amount, to, mode = 'nearest') {
  const pence = Math.round(num(amount) * 100)
  const unit = Math.round(num(to) * 100)
  if (!unit || unit <= 0) return pence / 100
  const q = pence / unit
  const n = mode === 'up' ? Math.ceil(q - 1e-9) : mode === 'down' ? Math.floor(q + 1e-9) : Math.round(q)
  return (n * unit) / 100
}

/** True when any two hourly periods (same person, same day) overlap. */
export function periodsOverlap(periods) {
  const spans = periods.map(p => span(p.start_time, p.end_time)).sort((a, b) => a[0] - b[0])
  for (let i = 1; i < spans.length; i++) {
    if (spans[i][0] < spans[i - 1][1]) return true
  }
  return false
}

/**
 * @param {object} p
 * @param {Array}  p.shifts     rota_shifts rows (all, incl. inactive, so old entries still price)
 * @param {Array}  p.staff      cash_staff rows + role_multiplier + shift_rates {shift_id: rate}
 * @param {Array}  p.entries    rota_entries rows for the week
 * @param {Array}  p.weekStaff  rota_week_staff rows (points_adjustment, tip_adjustment, pay_override)
 * @param {number} p.tipPot     amount to share out
 */
export function computeRotaWeek({ shifts, staff, entries, weekStaff = [], pots = [], tipRounding = null }) {
  const shiftById = new Map(shifts.map(s => [s.id, { ...s, span: span(s.start_time, s.end_time) }]))
  const adjByStaff = new Map(weekStaff.map(w => [w.staff_id, w]))

  const rows = staff.map(st => {
    const mine = entries.filter(e => e.staff_id === st.id)
    const rates = st.shift_rates ?? {}
    const multiplier = st.role_multiplier == null ? 1 : num(st.role_multiplier)
    const payType = st.pay_type ?? 'fixed'
    const basis = st.pay_basis ?? 'week'
    const defaultRate = num(st.default_rate)

    let minutes = 0
    let basePoints = 0
    let pay = 0
    const days = new Set()
    // fraction of each shift worked, summed over the week, for display
    const shiftFractions = {}

    for (const e of mine) {
      days.add(String(e.work_date).slice(0, 10))
      // Pieces of work: { shift, minutes, fraction } plus unassigned minutes.
      const pieces = []
      let loose = 0
      if (e.shift_id) {
        const sh = shiftById.get(e.shift_id)
        if (!sh) continue
        pieces.push({ shift: sh, minutes: sh.span[1] - sh.span[0], fraction: 1 })
      } else {
        const period = span(e.start_time, e.end_time)
        const total = period[1] - period[0]
        let inShifts = 0
        for (const sh of shiftById.values()) {
          const len = sh.span[1] - sh.span[0]
          const ov = overlap(period, sh.span)
          if (ov > 0 && len > 0) {
            pieces.push({ shift: sh, minutes: ov, fraction: ov / len })
            inShifts += ov
          }
        }
        loose = Math.max(0, total - inShifts)
      }

      for (const pc of pieces) {
        minutes += pc.minutes
        basePoints += num(pc.shift.points) * pc.fraction
        shiftFractions[pc.shift.id] = (shiftFractions[pc.shift.id] ?? 0) + pc.fraction
        if (payType === 'hourly') {
          const hourly = rates[pc.shift.id] != null ? num(rates[pc.shift.id]) : defaultRate
          pay += (pc.minutes / 60) * hourly
        } else if (basis === 'shift') {
          const amount = rates[pc.shift.id] != null ? num(rates[pc.shift.id]) : defaultRate
          pay += amount * pc.fraction
        }
      }
      minutes += loose
      if (payType === 'hourly') pay += (loose / 60) * defaultRate
    }

    if (payType !== 'hourly') {
      if (basis === 'week') pay = days.size > 0 ? defaultRate : 0
      if (basis === 'day') pay = defaultRate * days.size
    }

    const adj = adjByStaff.get(st.id)
    const points = round2(basePoints * multiplier)
    const adjustment = round2(num(adj?.points_adjustment))
    const computedPay = round2(pay)
    const payOverride = adj?.pay_override == null ? null : round2(num(adj.pay_override))

    return {
      staff_id:        st.id,
      name:            st.name,
      role_name:       st.role_name ?? null,
      role_multiplier: multiplier,
      pay_type:        payType,
      pay_basis:       basis,
      days_worked:     days.size,
      entry_count:     mine.length,
      hours:           round2(minutes / 60),
      shift_fractions: shiftFractions,
      computed_pay:    computedPay,
      pay_override:    payOverride,
      pay:             payOverride ?? computedPay,
      base_points:     points,
      points_adjustment: adjustment,
      tip_adjustment:  round2(num(adj?.tip_adjustment)),
      points:          round2(Math.max(0, points + adjustment)),
    }
  })

  const totalPoints = round2(rows.reduce((s, r) => s + r.points, 0))
  const roundTo = tipRounding?.to ? num(tipRounding.to) : null
  const roundMode = tipRounding?.mode ?? 'nearest'
  for (const r of rows) { r.pot_shares = {}; r.pot_shares_exact = {}; r.tip_share = 0 }

  const potSummaries = pots.map(pot => {
    const lines = (pot.lines ?? []).map(l => ({ ...l, amount: round2(num(l.amount)) }))
    const sourcesTotal = round2(num(pot.sources_total))
    const gross = round2(sourcesTotal + lines.reduce((s, l) => s + l.amount, 0))
    const surchargePct = Math.min(100, Math.max(0, num(pot.surcharge_pct)))
    const surcharge = round2(gross * surchargePct / 100)
    const total = round2(gross - surcharge)   // available to share
    let distributed = 0
    if (pot.distribution === 'points') {
      for (const r of rows) {
        const exact = totalPoints > 0 ? round2(total * r.points / totalPoints) : 0
        const share = roundTo ? roundTip(exact, roundTo, roundMode) : exact
        r.pot_shares_exact[pot.id] = exact
        r.pot_shares[pot.id] = share
        distributed += share
      }
    } else if (pot.distribution === 'manual') {
      const manual = pot.manual ?? {}
      for (const r of rows) {
        const share = round2(num(manual[r.staff_id]))
        r.pot_shares[pot.id] = share
        distributed += share
      }
    }
    distributed = round2(distributed)
    return {
      id: pot.id,
      name: pot.name,
      distribution: pot.distribution,
      sources_total: sourcesTotal,
      sources: pot.sources ?? [],
      lines,
      gross,
      surcharge_name: pot.surcharge_name || null,
      surcharge_pct: surchargePct,
      surcharge,
      total,
      distributed,
      kept_by_house: pot.distribution === 'house' ? total : 0,
      difference: pot.distribution === 'house' ? 0 : round2(distributed - total),
    }
  })
  for (const r of rows) {
    r.tip_share_from_pots = round2(Object.values(r.pot_shares).reduce((s, v) => s + v, 0))
    r.tip_share = round2(Math.max(0, r.tip_share_from_pots + r.tip_adjustment))
  }

  return {
    rows,
    pots: potSummaries,
    totals: {
      hours:  round2(rows.reduce((s, r) => s + r.hours, 0)),
      pay:    round2(rows.reduce((s, r) => s + r.pay, 0)),
      points: totalPoints,
      tips_gross:  round2(potSummaries.reduce((s, p) => s + p.gross, 0)),
      surcharges:  round2(potSummaries.reduce((s, p) => s + p.surcharge, 0)),
      tips_in:     round2(potSummaries.reduce((s, p) => s + p.total, 0)),
      tips_shared: round2(rows.reduce((s, r) => s + r.tip_share, 0)),
      kept_by_house: round2(potSummaries.reduce((s, p) => s + p.kept_by_house, 0)),
    },
    tip_rounding: roundTo ? { to: roundTo, mode: roundMode } : null,
  }
}
