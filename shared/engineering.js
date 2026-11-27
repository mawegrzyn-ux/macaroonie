// shared/engineering.js
//
// Menu engineering from real sales (inventory phase 7a, docs/INVENTORY.md
// 8.2; 27 Nov 2026): Kasavana and Smith's four classes for each dish of a
// menu section, from what really sold over a period (dish_cost_days, usage
// from sales: units, net of VAT, theoretical cost). Plain ESM, no database:
// the Menu margins page's Engineering tab (GET /api/menu-margins/engineering),
// Pepper's menu_engineering and the report subject Menu engineering all call
// engineer() here (rule 12).
//
//   popular     the dish's share of its section's units is at least 70% of
//               an equal share: units / section units >= 0.7 / dishes in
//               the section (the dishes that sold in the period)
//   profitable  its gross profit in pounds per unit is at least the
//               section's average GP per unit sold, weighted by units
//               (section GP / section units, over the units that were costed)
//   classes     star (popular and profitable), plough-horse (popular, not
//               profitable), puzzle (profitable, not popular), dog (neither)
//
// Pounds of margin lead (GP per unit, the dish's GP); cost % is beside them.
// Pence meet pounds only in margin() (shared/costing.js).
//
// What counts:
//   - A row of dish_cost_days with units not costed (no recipe, a gap, an
//     item with no price) is left out of GP, never priced at nil: its units
//     count for popularity (they sold), not for profitability. A dish none of
//     whose units were costed has no class, named as not costed.
//   - A meal deal rung up as a deal (from its own button, manual or
//     automatic) is one dish of the section it sits in, counted by the deals
//     sold; its GP is what the deal took net less the cost of the dishes
//     picked in it (dish_cost_days keeps the picks' cost on the deal's row).
//     The dishes picked inside it add no units to their own sections: the
//     till sold a deal, not a burger.
//   - An automatic deal (combo mode 'auto') that the till, a kiosk or online
//     ordering found among dishes rung up one by one is a discount over those
//     dishes, like a promotion (shared/pos/offers.js autoCombosFor(),
//     shared/orderPricing.js): the check keeps each dish as its own line and
//     the deal only as a promotion. So those dishes count in their own
//     sections, each at what it took after the deal's saving (its net is
//     lower, so its GP per unit is too), and the deal has no units for them.
//     engineeringFor() names a menu's automatic deals (auto_deals) so the
//     page and Pepper can say so.
//   - Open items, services and dishes on no menu (left_out), and rows with no
//     dish or no section are not engineered: they are counted in left_out.
//
//   engineer(rows, { names })   rows: dish_cost_days rows, or sums of them
//                               ({ dish_id, name, section_id, section, kind,
//                               qty, net_pence, cost, uncosted_qty,
//                               typical_qty, left_out }); names: { sectionId:
//                               words } to show (the menu's name beside it).
//                               { sections: [...], total, left_out }
//   averageText(section, fmt, none)
//                               a section's average GP per unit in words,
//                               `none` when it has no costed unit

import { margin } from './costing.js'

export const POPULAR_FACTOR = 0.7

export const CLASSES = {
  star: {
    label: 'Star', popular: true, profitable: true,
    hint: 'Sells well and earns more than the section\'s average per sale.',
    suggestion: 'Keep it as it is: give it the best place on the menu and keep its recipe, portion and price steady.',
  },
  plough_horse: {
    label: 'Plough-horse', popular: true, profitable: false,
    hint: 'Sells well but earns less than the section\'s average per sale.',
    suggestion: 'Look at its cost or its price: a cheaper ingredient, a smaller portion or a small price rise.',
  },
  puzzle: {
    label: 'Puzzle', popular: false, profitable: true,
    hint: 'Earns more than the section\'s average per sale but doesn\'t sell much.',
    suggestion: 'Move it up the menu, rename or describe it better, or have staff suggest it.',
  },
  dog: {
    label: 'Dog', popular: false, profitable: false,
    hint: 'Sells little and earns less than the section\'s average per sale.',
    suggestion: 'Consider taking it off the menu, or rework it into something that sells.',
  },
}
export const CLASS_KEYS = Object.keys(CLASSES)
export const NOT_COSTED = 'Not costed: none of its units sold could be costed, so it has no GP to compare.'

const num = v => (v == null || v === '' ? 0 : Number(v))
const round2 = n => Math.round(Number(n) * 100) / 100
const round4 = n => Math.round(Number(n) * 1e4) / 1e4
const round6 = n => Math.round(Number(n) * 1e6) / 1e6

/** The class of a dish that is (or isn't) popular and profitable; null when profitability isn't known. */
export function classOf(popular, profitable) {
  if (profitable == null) return null
  if (popular) return profitable ? 'star' : 'plough_horse'
  return profitable ? 'puzzle' : 'dog'
}

/** The popularity threshold as a share of units in percent (70% of an equal share): 70 / n. */
export const popularPct = n => (n > 0 ? round2(POPULAR_FACTOR * 100 / n) : null)

const sums = () => ({ qty: 0, costed_qty: 0, net_pence: 0, cost: 0, uncosted_qty: 0, typical_qty: 0 })

// One row into a dish's (or section's) sums: its units always; its net and
// cost only when every unit of it was costed.
function into(s, r) {
  const qty = num(r.qty)
  s.qty += qty
  s.typical_qty += num(r.typical_qty)
  const costed = r.cost != null && !(num(r.uncosted_qty) > 0)
  if (costed) {
    s.costed_qty += qty
    s.net_pence += Math.round(num(r.net_pence))
    s.cost += num(r.cost)
  } else {
    s.uncosted_qty += qty
  }
}

// The money of some sums: net, cost, GP and cost % of the costed units (margin(): pence meet pounds there).
function money(s) {
  if (!(s.costed_qty > 0)) return { net_pence: null, cost_pence: null, gp_pence: null, cost_pct: null, gp_per_unit_pence: null }
  const m = margin({ gross_pence: s.net_pence, vat_rate: 0, cost: round6(s.cost) })
  return { net_pence: m.net_pence, cost_pence: m.cost_pence, gp_pence: m.gp_pence, cost_pct: m.cost_pct, gp_per_unit_pence: round2(m.gp_pence / s.costed_qty) }
}

/**
 * Kasavana and Smith's classes for each section's dishes (see the top).
 * Returns { sections: [{ section_id, section, dishes: [{ dish_id, name,
 * kind, units, share_pct, popular, costed_units, uncosted_units,
 * typical_units, net_pence, cost_pence, gp_pence, gp_per_unit_pence,
 * cost_pct, profitable, class }] (most units first), dish_count, units,
 * popular_pct (the share a dish needs to be popular, %), costed_units,
 * uncosted_units, net_pence, cost_pence, gp_pence, cost_pct,
 * avg_gp_per_unit_pence, classes: { star: n, ... , not_costed: n } }]
 * (most units first), total: the same figures over every section,
 * left_out: { units, dishes } }.
 */
export function engineer(rows = [], { names = {} } = {}) {
  const sections = new Map()
  const left = { units: 0, dishes: new Set() }
  for (const r of rows || []) {
    if (r.left_out || !r.dish_id || !r.section_id) {
      left.units += num(r.qty)
      left.dishes.add(r.dish_id || 'name:' + String(r.name || '').toLowerCase())
      continue
    }
    const sec = sections.get(r.section_id) || sections.set(r.section_id, {
      section_id: r.section_id, section: names[r.section_id] ?? r.section ?? null, s: sums(), dishes: new Map(),
    }).get(r.section_id)
    const d = sec.dishes.get(r.dish_id) || sec.dishes.set(r.dish_id, { dish_id: r.dish_id, name: r.name, kind: r.kind ?? null, s: sums() }).get(r.dish_id)
    if (!d.kind && r.kind) d.kind = r.kind
    into(d.s, r)
    into(sec.s, r)
  }
  const total = { ...sums(), dish_count: 0, classes: emptyClasses() }
  const out = []
  for (const sec of sections.values()) {
    // Only dishes that sold count: a dish sold and refunded in the period to nothing isn't one of the section's.
    const dishes = [...sec.dishes.values()].filter(d => d.s.qty > 0)
    if (!dishes.length || !(sec.s.qty > 0)) continue
    const n = dishes.length
    const sm = money(sec.s)
    const classes = emptyClasses()
    const list = dishes.map(d => {
      const dm = money(d.s)
      // Shares compared as cross products, so 0.7 / n and the average are never rounded first.
      const popular = d.s.qty * n >= POPULAR_FACTOR * sec.s.qty - 1e-9
      const profitable = dm.gp_pence == null || sm.gp_pence == null ? null
        : dm.gp_pence * sec.s.costed_qty >= sm.gp_pence * d.s.costed_qty - 1e-6
      const cls = classOf(popular, profitable)
      classes[cls || 'not_costed']++
      return {
        dish_id: d.dish_id, name: d.name, kind: d.kind,
        units: round4(d.s.qty), share_pct: round2(d.s.qty * 100 / sec.s.qty), popular,
        costed_units: round4(d.s.costed_qty), uncosted_units: round4(d.s.uncosted_qty), typical_units: round4(d.s.typical_qty),
        ...dm, profitable, class: cls,
      }
    }).sort((a, b) => b.units - a.units || String(a.name).localeCompare(String(b.name)))
    for (const k of Object.keys(classes)) total.classes[k] += classes[k]
    total.dish_count += n
    for (const k of Object.keys(sums())) total[k] += sec.s[k]
    out.push({
      section_id: sec.section_id, section: sec.section, dishes: list, dish_count: n,
      units: round4(sec.s.qty), popular_pct: popularPct(n),
      costed_units: round4(sec.s.costed_qty), uncosted_units: round4(sec.s.uncosted_qty),
      net_pence: sm.net_pence, cost_pence: sm.cost_pence, gp_pence: sm.gp_pence, cost_pct: sm.cost_pct,
      avg_gp_per_unit_pence: sm.gp_per_unit_pence, classes,
    })
  }
  out.sort((a, b) => b.units - a.units || String(a.section).localeCompare(String(b.section)))
  const tm = money(total)
  return {
    sections: out,
    total: {
      dish_count: total.dish_count, units: round4(total.qty), costed_units: round4(total.costed_qty), uncosted_units: round4(total.uncosted_qty),
      net_pence: tm.net_pence, cost_pence: tm.cost_pence, gp_pence: tm.gp_pence, cost_pct: tm.cost_pct, classes: total.classes,
    },
    left_out: { units: round4(left.units), dishes: left.dishes.size },
  }
}

function emptyClasses() {
  return { star: 0, plough_horse: 0, puzzle: 0, dog: 0, not_costed: 0 }
}

/**
 * A section's average GP per unit in words: fmt(pence, rounded), or `none`
 * when none of its units could be costed (avg_gp_per_unit_pence null). An
 * unknown average is a gap, never £0.00 (the page's chart and drawer,
 * Pepper's menu_engineering).
 */
export function averageText(section, fmt, none = '-') {
  const v = section?.avg_gp_per_unit_pence
  return v == null ? none : fmt(Math.round(v))
}

/** A dish's class in words, with what to do: { label, hint, suggestion }, or the not costed words. */
export function classWords(cls) {
  return CLASSES[cls] || { label: 'Not costed', hint: NOT_COSTED, suggestion: 'Cost it first: link its recipe and fix its gaps on the Recipes page.' }
}

// What leaves engineering's figures for people without till reports view: what the till took and what is worked out from it.
export const ENGINEERING_SALES_FIELDS = ['net_pence', 'gp_pence', 'gp_per_unit_pence', 'cost_pct', 'profitable', 'class', 'avg_gp_per_unit_pence', 'classes']

/** engineer()'s answer without the sales figures (ENGINEERING_SALES_FIELDS): units, shares, popularity and theoretical cost stay. */
export function withoutSales(result) {
  const strip = o => Object.fromEntries(Object.entries(o).filter(([k]) => !ENGINEERING_SALES_FIELDS.includes(k)))
  return {
    ...result,
    sections: result.sections.map(s => ({ ...strip(s), dishes: s.dishes.map(strip) })),
    total: strip(result.total),
  }
}
