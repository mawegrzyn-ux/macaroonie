// src/services/itemMappingSvc.js
//
// Sales from other tills, phase 2 (docs/SALES_IMPORT.md 4, migration 292):
// the item mapping applied to stored lines. The rule itself is
// shared/itemMapping.js; this file loads what it needs and writes what it
// decides.
//
//   mappingContext(tx, ...)   a connection's rules, its catalogue and our
//                             menus' list prices, loaded once per run
//   mapChecks(tx, ...)        maps some checks' lines: the mapped columns of
//                             ext_check_lines and their ext_line_parts
//   requestRemap(tx, ...)     a rule changed: re-map the connection's lines
//                             from a day on (marked on the connection, then
//                             queued; never run in the request)
//   remapConnection()         the re-map itself, in batches (the sales-sync job)
//   sweepRemaps()             every connection with a re-map waiting (the
//                             job's minute sweep: a lost queue add still runs)
//   previewMapping(tx, ...)   what the last 30 days' lines would become under
//                             a draft set of rules; writes nothing
//   coverage(tx, ...)         the share of the last 30 days' item sales
//                             value mapped, by venue, and the unmapped items
//   venueMenus(tx, ...)       the menus a venue sells: the group's shared
//                             menus and its own (as Menu times reads them)
//
// Phase 3 (suggestions, Pepper, Create missing dishes, Copy):
//   venueOurs(tx, ...)        a venue's menus' dishes and options, for matching
//   recentSales(tx, ...)      the last 30 days' sales by item, variant, option
//   openThings(tx, ...)       what is still unmapped at a venue, to match
//   ruleFor(thing, target)    a match as the exact rule that would save it
//   suggestions(tx, ...)      suggested targets for it (shared/itemMatch.js)

import { systemSql, withTenant } from '../config/db.js'
import { queue as syncQueue } from '../jobs/sales-sync.js'
import {
  mapCheck, normaliseRule, catalogContext, ourContext, soldName, catalogState, STATE_LABELS, coverageShare,
} from '../../../shared/itemMapping.js'
import { matchIndex, matchThing, AUTO_MATCH } from '../../../shared/itemMatch.js'

// How far back Preview and Coverage look.
export const RECENT_DAYS = 30
const REMAP_BATCH = 400

/** A connection's rules, normalised. */
export async function loadRules(tx, tenantId, connectionId) {
  const rows = await tx`
    SELECT id, kind, venue_id, item_ref, variant_ref, option_ref, option_refs, axis_kind, axis_name, axis_group_ref,
           axis_values, target_item_id, target_item_ids, target_option_ids, target_combo_id, target_group_id,
           ext_sku, ext_name, pattern_field, pattern_op, pattern_value, target_section_id,
           effective_from::text AS effective_from, note, created_by, created_at, updated_at
      FROM ext_map_rules WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId}
     ORDER BY created_at, id`
  return rows.map(normaliseRule)
}

/** Our dishes, combos and options with their list prices and names (the whole group's: ids are checked when rules are saved). */
export async function loadOurs(tx, tenantId) {
  const [items, options, prices, sections] = await Promise.all([
    tx`SELECT mi.id, mi.name, mi.kind,
              COALESCE(mi.price_pence, (SELECT min(v.price_pence) FROM menu_item_variants v WHERE v.item_id = mi.id AND v.tenant_id = mi.tenant_id), 0) AS price_pence
         FROM menu_items mi WHERE mi.tenant_id = ${tenantId}`,
    tx`SELECT o.id, o.group_id, o.label, o.price_pence, g.name AS group_name
         FROM menu_variant_options o JOIN menu_variant_groups g ON g.id = o.group_id AND g.tenant_id = o.tenant_id
        WHERE o.tenant_id = ${tenantId}`,
    tx`SELECT item_id, option_id, price_pence FROM menu_item_variant_prices WHERE tenant_id = ${tenantId}`,
    tx`SELECT s.id, s.title, m.name AS menu FROM menu_sections s JOIN menus m ON m.id = s.menu_id AND m.tenant_id = s.tenant_id WHERE s.tenant_id = ${tenantId}`,
  ])
  const names = {}
  for (const i of items) names[i.id] = i.name
  for (const o of options) names[o.id] = o.group_name + ': ' + o.label
  for (const s of sections) names[s.id] = 'Section ' + s.title + ' (' + s.menu + ')'
  const optionInfo = Object.fromEntries(options.map(o => [o.id, { group_id: o.group_id, group_name: o.group_name, label: o.label }]))
  return { ctx: ourContext({ items, options, itemOptionPrices: prices }), names, optionInfo }
}

export async function loadCatalogRows(tx, tenantId, connectionId) {
  return tx`
    SELECT kind, external_id, parent_ref, name, sku, price_pence, category_ref, attrs, deleted_at
      FROM ext_catalog WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId}
       AND kind IN ('item', 'variant', 'modifier', 'modifier_option', 'category')`
}

/** Everything mapCheck() needs for a connection. */
export async function mappingContext(tx, tenantId, connectionId) {
  const [rules, catalogRows, ours] = await Promise.all([
    loadRules(tx, tenantId, connectionId),
    loadCatalogRows(tx, tenantId, connectionId),
    loadOurs(tx, tenantId),
  ])
  return { rules, ctx: { catalog: catalogContext(catalogRows), ours: ours.ctx }, names: ours.names, optionInfo: ours.optionInfo, catalogRows }
}

async function loadLines(tx, tenantId, checkIds) {
  return tx`
    SELECT l.id, l.check_id, l.line_no, l.line_kind, l.parent_line_id AS parent_id, l.item_ref, l.variant_ref, l.option_ref,
           l.sku, l.name, l.variant_name, l.qty::float8 AS qty, l.net_pence,
           l.map_state, l.item_id, l.option_id, l.combo_id, l.rule_id, l.allocated_net_pence,
           c.venue_id, c.business_date::text AS business_date, c.number, c.kind AS check_kind, c.cancelled
      FROM ext_check_lines l JOIN ext_checks c ON c.id = l.check_id AND c.tenant_id = l.tenant_id
     WHERE l.tenant_id = ${tenantId} AND l.check_id = ANY(${checkIds}::uuid[])
     ORDER BY l.check_id, l.line_no`
}

/** Lines grouped into checks, in the shape mapCheck() takes. */
function asChecks(lines) {
  const checks = new Map()
  for (const l of lines) {
    if (!checks.has(l.check_id)) checks.set(l.check_id, { id: l.check_id, venue_id: l.venue_id, business_date: l.business_date, lines: [] })
    checks.get(l.check_id).lines.push(l)
  }
  return [...checks.values()]
}

/**
 * Maps the lines of these checks (all of one connection) and writes the
 * result: each line's map_state, rule, dish, option, combo and allocated
 * net, and the item lines' parts (replaced). Money columns are never
 * touched. `mc` is mappingContext() when the caller has it. Returns how many
 * lines were mapped.
 */
export async function mapChecks(tx, tenantId, connectionId, checkIds, mc = null) {
  if (!checkIds.length) return 0
  mc ||= await mappingContext(tx, tenantId, connectionId)
  const lines = await loadLines(tx, tenantId, checkIds)
  const rows = [], parts = []
  for (const check of asChecks(lines)) {
    for (const r of mapCheck(check, mc.rules, mc.ctx)) {
      rows.push({ id: r.id, state: r.state, rule_id: r.rule_id, item_id: r.item_id, option_id: r.option_id, combo_id: r.combo_id,
        section_id: r.section_id, allocated: r.allocated_net_pence })
      for (const p of r.parts) parts.push({ ...p, line_id: r.id, check_id: check.id })
    }
  }
  if (rows.length) {
    await tx`
      UPDATE ext_check_lines l
         SET map_state = x.state, rule_id = x.rule_id, item_id = x.item_id, option_id = x.option_id,
             combo_id = x.combo_id, section_id = x.section_id, allocated_net_pence = x.allocated
        FROM jsonb_to_recordset(${tx.json(rows)}) AS x(id uuid, state text, rule_id uuid, item_id uuid, option_id uuid, combo_id uuid,
             section_id uuid, allocated integer)
       WHERE l.id = x.id AND l.tenant_id = ${tenantId}`
  }
  await tx`DELETE FROM ext_line_parts WHERE tenant_id = ${tenantId} AND check_id = ANY(${checkIds}::uuid[])`
  if (parts.length) {
    await tx`
      INSERT INTO ext_line_parts (tenant_id, check_id, line_id, source_line_id, part_no, role, item_id, option_id, combo_id, rule_id, qty, net_pence)
      SELECT ${tenantId}, x.check_id, x.line_id, x.source_line_id, x.part_no, x.role, x.item_id, x.option_id, x.combo_id, x.rule_id, x.qty, x.net_pence
        FROM jsonb_to_recordset(${tx.json(parts)}) AS x(check_id uuid, line_id uuid, source_line_id uuid, part_no integer, role text,
             item_id uuid, option_id uuid, combo_id uuid, rule_id uuid, qty numeric, net_pence integer)
       WHERE EXISTS (SELECT 1 FROM ext_check_lines l WHERE l.id = x.line_id AND l.tenant_id = ${tenantId})`
  }
  return rows.length
}

// ── Re-mapping after a rule change ──────────────────────────────────────────

/**
 * A rule was saved or deleted: the connection's lines on trading days from
 * `from` on are to be mapped again. Marks the connection (the earliest day
 * asked for wins) in the caller's transaction; the caller queues the re-map
 * with queueRemap() once that transaction has committed (fire and forget,
 * rule 17: the minute sweep runs it if the add is lost).
 */
export async function requestRemap(tx, tenantId, connectionId, from) {
  await tx`
    UPDATE pos_connections
       SET remap_from = LEAST(COALESCE(remap_from, ${from}::date), ${from}::date), remap_requested_at = now()
     WHERE id = ${connectionId} AND tenant_id = ${tenantId}`
}

/** Queue a connection's re-map now (never awaited in a request). */
export function queueRemap(tenantId, connectionId, log = null) {
  syncQueue.add('remap', { tenantId, connectionId }, {
    jobId: 'remap-' + connectionId + '-' + Math.floor(Date.now() / 5000), removeOnComplete: true, removeOnFail: 20,
  }).catch(err => log?.warn?.({ err: err?.message, connectionId }, 'Item re-map not queued (Redis?)'))
}

/**
 * Re-maps a connection's stored lines from its remap_from on, a batch of
 * checks per transaction, each holding the connection's row so two
 * processes don't write the same parts at once. Clears the mark when no
 * new ask came in meanwhile. Returns { checks, lines } or { skipped }.
 */
export async function remapConnection(tenantId, connectionId, { log = null } = {}) {
  const [conn] = await withTenant(tenantId, tx => tx`
    SELECT remap_from::text AS remap_from, extract(epoch FROM remap_requested_at)::text AS asked FROM pos_connections
     WHERE id = ${connectionId} AND tenant_id = ${tenantId}`)
  if (!conn?.remap_from) return { skipped: 'nothing to re-map' }
  let after = '00000000-0000-0000-0000-000000000000'
  let checks = 0, lines = 0
  for (;;) {
    const batch = await withTenant(tenantId, async tx => {
      await tx`SELECT id FROM pos_connections WHERE id = ${connectionId} AND tenant_id = ${tenantId} FOR UPDATE`
      const ids = (await tx`
        SELECT id FROM ext_checks
         WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} AND business_date >= ${conn.remap_from}::date AND id > ${after}
         ORDER BY id LIMIT ${REMAP_BATCH}`).map(r => r.id)
      if (!ids.length) return null
      const mc = await mappingContext(tx, tenantId, connectionId)
      const n = await mapChecks(tx, tenantId, connectionId, ids, mc)
      return { ids, n }
    })
    if (!batch) break
    checks += batch.ids.length
    lines += batch.n
    after = batch.ids[batch.ids.length - 1]
    if (batch.ids.length < REMAP_BATCH) break
  }
  // Compared as text: a timestamptz parameter would lose its microseconds.
  await withTenant(tenantId, tx => tx`
    UPDATE pos_connections SET remap_from = NULL, remap_requested_at = NULL
     WHERE id = ${connectionId} AND tenant_id = ${tenantId} AND extract(epoch FROM remap_requested_at)::text = ${conn.asked}`)
  log?.info?.({ connectionId, checks, lines }, 'Item mapping re-applied')
  return { checks, lines }
}

/** The minute sweep: every connection with a re-map waiting (system mode finds them; each runs as its tenant). */
export async function sweepRemaps(log = null) {
  const due = await systemSql`
    SELECT id, tenant_id FROM pos_connections WHERE remap_from IS NOT NULL ORDER BY remap_requested_at LIMIT 20`
  let ran = 0
  for (const c of due) {
    try {
      const r = await remapConnection(c.tenant_id, c.id, { log })
      if (!r.skipped) ran++
    } catch (err) {
      log?.warn?.({ err: err?.message, connectionId: c.id }, 'Item re-map failed')
    }
  }
  return ran
}

// ── Preview and coverage ────────────────────────────────────────────────────

/** The checks of the last RECENT_DAYS days (sales and refunds, cancelled left out), optionally one venue's. */
async function recentCheckIds(tx, tenantId, connectionId, venueId = null) {
  return (await tx`
    SELECT id FROM ext_checks
     WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} AND NOT cancelled
       AND business_date >= current_date - ${RECENT_DAYS}::int
       AND (${venueId}::uuid IS NULL OR venue_id = ${venueId}::uuid)`).map(r => r.id)
}

function targetOf(r, names) {
  if (r.state === 'bucket') return names[r.section_id] || 'A section no longer on the menu'
  if (r.state !== 'mapped') return STATE_LABELS[r.state] || ''
  const id = r.combo_id || r.item_id || r.option_id
  return names[id] || 'Something no longer on the menu'
}

/**
 * What the last RECENT_DAYS days' lines become under `draft` (a whole set
 * of rules: the saved ones with the page's changes), beside what the saved
 * rules make of them. Nothing is written. Returns totals before and after
 * (item lines' net by state), the value by our dish, combo or option after,
 * and the lines whose mapping changes (the first 100).
 */
export async function previewMapping(tx, tenantId, connectionId, { venueId = null, draft }) {
  const mc = await mappingContext(tx, tenantId, connectionId)
  const ids = await recentCheckIds(tx, tenantId, connectionId, venueId)
  const lines = ids.length ? await loadLines(tx, tenantId, ids) : []
  const draftRules = draft.map(normaliseRule)
  const blank = () => ({ mapped: 0, kept: 0, ignored: 0, unmapped: 0 })
  const before = blank(), after = blank()
  const byTarget = new Map()
  const changes = []
  let changed = 0
  for (const check of asChecks(lines)) {
    const was = mapCheck(check, mc.rules, mc.ctx)
    const now = mapCheck(check, draftRules, mc.ctx)
    check.lines.forEach((l, i) => {
      const a = was[i], b = now[i]
      if (l.line_kind === 'item') {
        before[a.state] = (before[a.state] || 0) + l.net_pence
        after[b.state] = (after[b.state] || 0) + l.net_pence
        for (const p of b.parts) {
          const id = p.combo_id || p.item_id || p.option_id
          const key = p.role + ':' + id
          if (!byTarget.has(key)) byTarget.set(key, { id, kind: p.combo_id ? 'combo' : p.item_id ? 'dish' : 'option', name: mc.names[id] || 'Something no longer on the menu', lines: 0, qty: 0, net_pence: 0 })
          const t = byTarget.get(key)
          t.lines++; t.qty += Number(l.qty) || 0; t.net_pence += p.net_pence
        }
      }
      const same = a.state === b.state && a.rule_id === b.rule_id && a.item_id === b.item_id && a.combo_id === b.combo_id
        && a.option_id === b.option_id && a.section_id === b.section_id && JSON.stringify(a.parts.map(p => [p.item_id, p.option_id, p.combo_id, p.net_pence]))
          === JSON.stringify(b.parts.map(p => [p.item_id, p.option_id, p.combo_id, p.net_pence]))
      if (same) return
      changed++
      if (changes.length < 100) {
        changes.push({
          check: l.number, business_date: l.business_date, line_kind: l.line_kind, name: soldName(l), net_pence: l.net_pence,
          before: { state: a.state, target: targetOf(a, mc.names) }, after: { state: b.state, target: targetOf(b, mc.names) },
        })
      }
    })
  }
  return {
    days: RECENT_DAYS, checks: ids.length, lines: lines.length, changed, before, after,
    by_target: [...byTarget.values()].sort((x, y) => y.net_pence - x.net_pence),
    changes,
  }
}

/**
 * Mapping coverage for the last RECENT_DAYS days, from the stored lines:
 * by venue, the item lines' net (sales only, cancelled left out; an item
 * line's net holds its modifiers') mapped, kept as sold, in a section (a
 * bucket rule), ignored and not mapped, and the share decided (mapped, kept
 * or in a section, of what isn't ignored);
 * and the unmapped items by value.
 */
export async function coverage(tx, tenantId, connectionId, { venueId = null } = {}) {
  const [venues, unmapped] = await Promise.all([
    tx`
      SELECT c.venue_id, v.name AS venue_name,
             COALESCE(sum(l.net_pence), 0)::bigint AS total,
             COALESCE(sum(l.net_pence) FILTER (WHERE l.map_state = 'mapped'), 0)::bigint AS mapped,
             COALESCE(sum(l.net_pence) FILTER (WHERE l.map_state = 'kept'), 0)::bigint AS kept,
             COALESCE(sum(l.net_pence) FILTER (WHERE l.map_state = 'bucket'), 0)::bigint AS bucket,
             COALESCE(sum(l.net_pence) FILTER (WHERE l.map_state = 'ignored'), 0)::bigint AS ignored,
             COALESCE(sum(l.net_pence) FILTER (WHERE l.map_state IS NULL OR l.map_state = 'unmapped'), 0)::bigint AS unmapped
        FROM ext_checks c
        JOIN venues v ON v.id = c.venue_id AND v.tenant_id = c.tenant_id
        JOIN ext_check_lines l ON l.check_id = c.id AND l.tenant_id = c.tenant_id AND l.line_kind = 'item'
       WHERE c.tenant_id = ${tenantId} AND c.connection_id = ${connectionId} AND c.kind = 'sale' AND NOT c.cancelled
         AND c.business_date >= current_date - ${RECENT_DAYS}::int
         AND (${venueId}::uuid IS NULL OR c.venue_id = ${venueId}::uuid)
       GROUP BY c.venue_id, v.name ORDER BY v.name`,
    tx`
      SELECT l.item_ref, l.variant_ref, min(l.name) AS name, min(l.variant_name) AS variant_name, min(l.sku) AS sku,
             count(*)::int AS lines, COALESCE(sum(l.qty), 0)::float8 AS qty, COALESCE(sum(l.net_pence), 0)::bigint AS net_pence
        FROM ext_checks c
        JOIN ext_check_lines l ON l.check_id = c.id AND l.tenant_id = c.tenant_id AND l.line_kind = 'item'
       WHERE c.tenant_id = ${tenantId} AND c.connection_id = ${connectionId} AND c.kind = 'sale' AND NOT c.cancelled
         AND c.business_date >= current_date - ${RECENT_DAYS}::int
         AND (${venueId}::uuid IS NULL OR c.venue_id = ${venueId}::uuid)
         AND (l.map_state IS NULL OR l.map_state = 'unmapped')
       GROUP BY l.item_ref, l.variant_ref ORDER BY sum(l.net_pence) DESC NULLS LAST LIMIT 50`,
  ])
  const share = coverageShare
  const rows = venues.map(v => ({
    venue_id: v.venue_id, venue_name: v.venue_name,
    total: Number(v.total), mapped: Number(v.mapped), kept: Number(v.kept), bucket: Number(v.bucket), ignored: Number(v.ignored), unmapped: Number(v.unmapped),
    percent: share(v),
  }))
  const all = rows.reduce((s, v) => ({ total: s.total + v.total, mapped: s.mapped + v.mapped, kept: s.kept + v.kept, bucket: s.bucket + v.bucket, ignored: s.ignored + v.ignored, unmapped: s.unmapped + v.unmapped }),
    { total: 0, mapped: 0, kept: 0, bucket: 0, ignored: 0, unmapped: 0 })
  return {
    days: RECENT_DAYS, venues: rows, all: { ...all, percent: share(all) },
    unmapped: unmapped.map(u => ({ ...u, net_pence: Number(u.net_pence) })),
  }
}

/** The menus a venue sells (the group's shared ones and its own); every menu when no venue. */
export async function venueMenus(tx, tenantId, venueId = null) {
  return tx`
    SELECT m.id, m.name, m.venue_id FROM menus m
     WHERE m.tenant_id = ${tenantId} AND (${venueId}::uuid IS NULL OR m.venue_id IS NULL OR m.venue_id = ${venueId}::uuid)
     ORDER BY m.sort_order, m.name`
}

// ── Suggestions (phase 3) ───────────────────────────────────────────────────

/**
 * Our side at a venue (its menus only), for the suggestions, Pepper, Create
 * missing dishes and Copy: the dishes and combos with their section, codes,
 * option groups and per-dish option prices, and the options of those groups.
 */
export async function venueOurs(tx, tenantId, venueId) {
  const menus = await venueMenus(tx, tenantId, venueId)
  const menuIds = menus.map(m => m.id)
  const items = menuIds.length ? await tx`
    SELECT mi.id, mi.name, mi.native_name, mi.kitchen_name, mi.kind, mi.sku, mi.barcode,
           s.id AS section_id, s.title AS section, m.id AS menu_id, m.name AS menu,
           COALESCE(mi.price_pence, (SELECT min(v.price_pence) FROM menu_item_variants v WHERE v.item_id = mi.id AND v.tenant_id = mi.tenant_id)) AS price_pence
      FROM menu_items mi
      JOIN menu_sections s ON s.id = mi.section_id AND s.tenant_id = mi.tenant_id
      JOIN menus m ON m.id = s.menu_id AND m.tenant_id = mi.tenant_id
     WHERE mi.tenant_id = ${tenantId} AND m.id = ANY(${menuIds}::uuid[])
     ORDER BY m.sort_order, m.name, s.sort_order, mi.sort_order` : []
  const ids = items.map(i => i.id)
  const [links, codes, prices] = ids.length ? await Promise.all([
    tx`SELECT item_id, group_id FROM menu_item_variant_groups WHERE tenant_id = ${tenantId} AND item_id = ANY(${ids}::uuid[]) ORDER BY sort_order`,
    tx`SELECT item_id, option_id, sku, barcode FROM menu_item_option_codes WHERE tenant_id = ${tenantId} AND item_id = ANY(${ids}::uuid[])`,
    tx`SELECT item_id, option_id, price_pence FROM menu_item_variant_prices WHERE tenant_id = ${tenantId} AND item_id = ANY(${ids}::uuid[])`,
  ]) : [[], [], []]
  const groupIds = [...new Set(links.map(l => l.group_id))]
  const [groups, options] = groupIds.length ? await Promise.all([
    tx`SELECT id, name FROM menu_variant_groups WHERE tenant_id = ${tenantId} AND id = ANY(${groupIds}::uuid[]) ORDER BY sort_order, name`,
    tx`SELECT o.id, o.group_id, g.name AS group_name, o.label, o.price_pence
         FROM menu_variant_options o JOIN menu_variant_groups g ON g.id = o.group_id AND g.tenant_id = o.tenant_id
        WHERE o.tenant_id = ${tenantId} AND o.group_id = ANY(${groupIds}::uuid[]) ORDER BY g.sort_order, g.name, o.sort_order`,
  ]) : [[], []]
  const dishes = items.map(i => ({
    ...i, price_pence: i.price_pence == null ? null : Number(i.price_pence),
    group_ids: links.filter(l => l.item_id === i.id).map(l => l.group_id),
    option_codes: codes.filter(c => c.item_id === i.id).map(c => ({ option_id: c.option_id, sku: c.sku, barcode: c.barcode })),
    option_prices: Object.fromEntries(prices.filter(p => p.item_id === i.id).map(p => [p.option_id, Number(p.price_pence)])),
  }))
  return { menus, dishes, groups, options: options.map(o => ({ ...o, price_pence: Number(o.price_pence) || 0 })) }
}

/** The last RECENT_DAYS days' sales of each item / variant and each modifier option (sales only, cancelled left out). */
export async function recentSales(tx, tenantId, connectionId, venueId = null) {
  const [items, options] = await Promise.all([
    tx`
      SELECT l.item_ref, l.variant_ref, count(*)::int AS lines, COALESCE(sum(l.qty), 0)::float8 AS qty, COALESCE(sum(l.net_pence), 0)::bigint AS net_pence
        FROM ext_checks c JOIN ext_check_lines l ON l.check_id = c.id AND l.tenant_id = c.tenant_id AND l.line_kind = 'item'
       WHERE c.tenant_id = ${tenantId} AND c.connection_id = ${connectionId} AND c.kind = 'sale' AND NOT c.cancelled
         AND c.business_date >= current_date - ${RECENT_DAYS}::int AND (${venueId}::uuid IS NULL OR c.venue_id = ${venueId}::uuid)
       GROUP BY l.item_ref, l.variant_ref`,
    tx`
      SELECT l.option_ref, count(*)::int AS lines, COALESCE(sum(l.qty), 0)::float8 AS qty, COALESCE(sum(l.net_pence), 0)::bigint AS net_pence
        FROM ext_checks c JOIN ext_check_lines l ON l.check_id = c.id AND l.tenant_id = c.tenant_id AND l.line_kind IN ('modifier', 'condiment')
       WHERE c.tenant_id = ${tenantId} AND c.connection_id = ${connectionId} AND c.kind = 'sale' AND NOT c.cancelled
         AND c.business_date >= current_date - ${RECENT_DAYS}::int AND (${venueId}::uuid IS NULL OR c.venue_id = ${venueId}::uuid)
       GROUP BY l.option_ref`,
  ])
  return { items, options }
}

export const salesTotal = rows => ({
  lines: rows.reduce((n, r) => n + r.lines, 0), qty: rows.reduce((n, r) => n + Number(r.qty), 0), net_pence: rows.reduce((n, r) => n + Number(r.net_pence), 0),
})

/**
 * The other till's catalogue at a venue as things to match: an item with one
 * variant (kind 'item'), each variant of an item with several ('variant'),
 * each modifier option ('option'), with its name, variant values, SKU,
 * barcode, price at the venue's store, category, state under the rules and
 * last 30 days' sales. Only what is still open (an item unmapped or only in a
 * section by a bucket rule, a modifier
 * option only a note) unless `all`. Biggest sellers first.
 */
export async function openThings(tx, tenantId, connectionId, venueId, { mc = null, all = false } = {}) {
  mc ||= await mappingContext(tx, tenantId, connectionId)
  const [[link], [{ today }], sales] = await Promise.all([
    tx`SELECT location_id FROM pos_connection_venues WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} AND venue_id = ${venueId}`,
    tx`SELECT current_date::text AS today`,
    recentSales(tx, tenantId, connectionId, venueId),
  ])
  const scope = { venue_id: venueId, date: today }
  const live = mc.catalogRows.filter(r => !r.deleted_at)
  const categories = Object.fromEntries(live.filter(r => r.kind === 'category').map(r => [r.external_id, r.name]))
  const priceAt = v => {
    const s = (v?.attrs?.stores || []).find(x => x.store_id === link?.location_id && x.price_pence != null)
    return s ? Number(s.price_pence) : (v?.price_pence ?? null)
  }
  const out = []
  for (const it of live.filter(r => r.kind === 'item')) {
    const variants = live.filter(v => v.kind === 'variant' && v.parent_ref === it.external_id)
    const a = it.attrs || {}
    const axes = [a.option1_name, a.option2_name, a.option3_name].filter(x => x != null && x !== '')
    const category = categories[it.category_ref] || ''
    if (variants.length <= 1) {
      const v = variants[0]
      const state = catalogState({ item_ref: it.external_id, variant_ref: v?.external_id || null, sku: v?.sku, name: it.name }, mc.rules, mc.ctx, scope)
      out.push({
        key: 'i:' + it.external_id, kind: 'item', item_ref: it.external_id, variant_ref: null, option_ref: null,
        name: it.name, variant_name: null, values: [], axes, sku: v?.sku || null, barcode: v?.attrs?.barcode || null,
        price_pence: priceAt(v), category, category_ref: it.category_ref || null, state: state.state,
        sales: salesTotal(sales.items.filter(s => s.item_ref === it.external_id)),
      })
      continue
    }
    for (const v of variants) {
      const va = v.attrs || {}
      const state = catalogState({ item_ref: it.external_id, variant_ref: v.external_id, sku: v.sku, name: it.name, variant_name: v.name }, mc.rules, mc.ctx, scope)
      out.push({
        key: 'v:' + v.external_id, kind: 'variant', item_ref: it.external_id, variant_ref: v.external_id, option_ref: null,
        name: it.name, variant_name: v.name, values: [va.option1_value, va.option2_value, va.option3_value].filter(x => x != null && x !== ''),
        axes, sku: v.sku || null, barcode: va.barcode || null, price_pence: priceAt(v), category, category_ref: it.category_ref || null,
        state: state.state, sales: salesTotal(sales.items.filter(s => s.item_ref === it.external_id && s.variant_ref === v.external_id)),
      })
    }
  }
  for (const m of live.filter(r => r.kind === 'modifier')) {
    for (const o of live.filter(x => x.kind === 'modifier_option' && x.parent_ref === m.external_id)) {
      const state = catalogState({ option_ref: o.external_id, name: o.name }, mc.rules, mc.ctx, scope)
      out.push({
        key: 'o:' + o.external_id, kind: 'option', item_ref: null, variant_ref: null, option_ref: o.external_id, group_ref: m.external_id,
        name: o.name, group: m.name, variant_name: null, values: [], axes: [], sku: null, barcode: null, price_pence: o.price_pence ?? null,
        category: '', category_ref: null, state: state.state, sales: salesTotal(sales.options.filter(s => s.option_ref === o.external_id)),
      })
    }
  }
  const open = all ? out : out.filter(t => (t.kind === 'option' ? t.state === 'note' : (t.state === 'unmapped' || t.state === 'bucket')))
  return open.sort((x, y) => y.sales.net_pence - x.sales.net_pence || x.name.localeCompare(y.name)
    || String(x.variant_name || '').localeCompare(String(y.variant_name || '')))
}

/** A match's target as the exact rule that would save it (a modifier option: an option or one dish, never a combo). */
export function ruleFor(thing, target, venueId) {
  const base = { kind: 'exact', venue_id: venueId, item_ref: thing.item_ref, variant_ref: thing.variant_ref, option_ref: thing.option_ref }
  if (thing.kind === 'option') {
    if (target.combo_id) return null
    return target.item_id ? { ...base, target_item_id: target.item_id } : { ...base, target_option_ids: target.option_ids.slice(0, 1) }
  }
  if (target.combo_id) return { ...base, target_combo_id: target.combo_id }
  return { ...base, target_item_id: target.item_id, target_option_ids: target.option_ids }
}

/** A thing as the page shows it. */
export const thingView = t => ({
  key: t.key, kind: t.kind, item_ref: t.item_ref, variant_ref: t.variant_ref, option_ref: t.option_ref, name: t.name,
  variant_name: t.variant_name, group: t.group || null, sku: t.sku, price_pence: t.price_pence, category: t.category, sales: t.sales,
})

/**
 * Suggested targets for what is still open at a venue (shared/itemMatch.js:
 * codes first, then names, price and category as tie-breakers). Each with
 * its best target as a rule, its score and reason, other candidates, and
 * whether it is ticked to start with (at or above AUTO_MATCH, not tied).
 * Writes nothing: rules are saved only when the person accepts.
 */
export async function suggestions(tx, tenantId, connectionId, venueId) {
  const [things, ours] = await Promise.all([openThings(tx, tenantId, connectionId, venueId), venueOurs(tx, tenantId, venueId)])
  const idx = matchIndex({ dishes: ours.dishes, options: ours.options })
  const found = [], none = []
  for (const t of things) {
    const m = matchThing({ kind: t.kind, name: t.name, values: t.values, sku: t.sku, barcode: t.barcode, price_pence: t.price_pence, category: t.category }, idx)
    const cands = m.candidates.map(c => ({ ...c, rule: ruleFor(t, c.target, venueId) })).filter(c => c.rule)
    if (!cands.length) { none.push(thingView(t)); continue }
    const [best, ...others] = cands
    found.push({
      ...thingView(t), score: best.score, by: best.by, reason: best.reason, label: best.label, rule: best.rule,
      auto: m.auto && best.label === m.best?.label,
      others: others.map(o => ({ score: o.score, by: o.by, reason: o.reason, label: o.label, rule: o.rule })),
    })
  }
  return { venue_id: venueId, threshold: AUTO_MATCH, suggestions: found, unmatched: none }
}
