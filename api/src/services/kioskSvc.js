// src/services/kioskSvc.js
//
// Self-order kiosks, cloud side (docs/POS.md section 10, shared/kiosk.js).
//
//   kioskConfig()     everything a kiosk needs: its revenue stream's menus
//                     (live versions, photos, calories), the option group
//                     library with the kiosk fields, order types it offers
//                     with what to ask, tax rates, promotions (channel 'pos',
//                     the same as the tills, so the price holds at the
//                     counter), sold out, tags and the allergen notice, its
//                     design and the translations for the design's languages.
//                     No staff and no PINs: a kiosk is a public screen.
//   loadDesign()      the design a kiosk uses (its own, else the tenant's first)
//   previewToken() / readPreviewToken()   a signed link for the design
//                     editor's live preview (no pairing needed, 12 hours),
//                     with the menu as published or with its changes not
//                     published yet (migration 188 for share links)
//   unpricedDishes()  dishes a preview's menus list that the kiosk leaves off
//                     (no price of their own, no priced option)
//   menuChanges()     the menus a preview shows whose draft differs from
//                     what is published
//
// Every query filters tenant_id itself.

import { httpError } from '../middleware/error.js'
import { ensureSettings, settingsView, ownVenue, tillMenuData, tillMenus, sha256 } from './posSvc.js'
import { contentKey } from '../../../shared/menuDiff.js'
import { variantRules, itemChoices, isPriced } from '../../../shared/orderPricing.js'
import { venuePromotions, publicPromotion } from './promoSvc.js'
import { soldOutRows } from './soldOut.js'
import { ensureTaxDefaults, loadTaxRates, loadOrderTypes, loadStreams } from './taxSvc.js'
import { loadAllergenNotice } from '../routes/menus.js'
import { normaliseDesign, LANG_CODES } from '../../../shared/kiosk.js'
import { menuTags } from '../../../shared/menuTags.js'
import { venueNow } from '../../../shared/promotions.js'
import { makeLink, readLink } from './previewLinks.js'
import { printLayouts } from './printDesignSvc.js'
import { cardMachineOf } from './cardSvc.js'

// The device id a preview runs as (never a real device).
export const PREVIEW_DEVICE_ID = '00000000-0000-4000-8000-00000000000a'

/** The order types a stream offers, in the tenant's order, with what to ask (as the till's streamTypes()). */
function streamOrderTypes(stream, types) {
  const active = types.filter(t => t.is_active !== false)
  if (!stream) return active.map(t => ({ id: t.id, name: t.name, colour: t.colour || null, ask_name: 'off', ask_tent: 'off' }))
  const set = Object.fromEntries((stream.order_types || []).filter(x => x.enabled).map(x => [x.order_type_id, x]))
  return active.filter(t => set[t.id]).map(t => ({
    id: t.id, name: t.name, colour: t.colour || null,
    ask_name: set[t.id].ask_name || 'off', ask_tent: set[t.id].ask_tent || 'off',
    is_default: stream.default_order_type_id === t.id,
  }))
}

/** A kiosk's design: the one it names, else the tenant's first, else the defaults. */
export async function loadDesign(tx, tenantId, designId) {
  const rows = designId
    ? await tx`SELECT id, name, settings, updated_at FROM kiosk_designs WHERE id = ${designId} AND tenant_id = ${tenantId}`
    : []
  const [row] = rows.length ? rows
    : await tx`SELECT id, name, settings, updated_at FROM kiosk_designs WHERE tenant_id = ${tenantId} ORDER BY created_at LIMIT 1`
  return row
    ? { id: row.id, name: row.name, ...normaliseDesign(row.settings) }
    : { id: null, name: 'Standard', ...normaliseDesign({}) }
}

/** Translations for these languages: { lang: { key: text } }. */
export async function loadTranslations(tx, tenantId, langs) {
  const list = (langs || []).filter(l => LANG_CODES.includes(l))
  if (!list.length) return {}
  const rows = await tx`
    SELECT lang, key, text FROM menu_translations
     WHERE tenant_id = ${tenantId} AND lang = ANY(${list}::text[])`
  const out = Object.fromEntries(list.map(l => [l, {}]))
  for (const r of rows) out[r.lang][r.key] = r.text
  return out
}

/**
 * Everything a kiosk works from. device: { id, kind, name, short_code,
 * settings: { revenue_stream_id, design_id, card_reader } }. designOverride
 * (the editor's preview) replaces the stored design's settings. menuVersion
 * 'draft' (previews only) shows the menus with changes not published yet.
 */
export async function kioskConfig(tx, tenantId, venueId, device, { designOverride = null, preview = false, menuVersion = 'live' } = {}) {
  const version = preview && menuVersion === 'draft' ? 'draft' : 'live'
  const venue = await ownVenue(tx, tenantId, venueId)
  const settings = await ensureSettings(tx, tenantId, venueId)
  await ensureTaxDefaults(tx, tenantId)
  const ds = device.settings || {}
  const [streams, orderTypes, taxRates, groups, design] = await Promise.all([
    loadStreams(tx, tenantId, venueId, { activeOnly: true }),
    loadOrderTypes(tx, tenantId),
    loadTaxRates(tx, tenantId),
    tx`SELECT g.id, COALESCE(g.display_name, g.name) AS name, g.price_mode, g.min_select, g.max_select, g.pos_prefixes, g.allow_repeat, g.on_request,
              g.kiosk_display, g.scale_low, g.scale_high, g.kiosk_pick_photo, g.kiosk_pick_scale,
              g.kiosk_tiles, g.kiosk_pictures, g.kiosk_entrance,
              COALESCE(json_agg(json_build_object('id', o.id, 'label', o.label, 'price_pence', o.price_pence, 'child_group_id', o.child_group_id,
                                                  'image_url', o.image_url, 'photo_url', o.photo_url, 'description', o.description, 'level', o.level)
                ORDER BY o.sort_order, o.label) FILTER (WHERE o.id IS NOT NULL), '[]') AS options
         FROM menu_variant_groups g
         LEFT JOIN menu_variant_options o ON o.group_id = g.id AND o.tenant_id = g.tenant_id
        WHERE g.tenant_id = ${tenantId}
        GROUP BY g.id`,
    loadDesign(tx, tenantId, ds.design_id || null),
  ])
  const stream = streams.find(r => r.id === ds.revenue_stream_id) || streams[0] || null
  const { menus, items, section_items, dietary } = await tillMenuData(tx, tenantId, venueId, stream ? [stream] : [], { guest: true, allStreams: streams, version })
  const tz = venue.timezone || 'Europe/London'
  const soldOut = (await soldOutRows(tx, tenantId, venueId)).map(r => ({ item_id: r.item_id, until: r.sold_out_until }))
  const promotions = (await venuePromotions(tx, { id: venueId, tenant_id: tenantId }, venueNow(tz).date, 'pos'))
    .map(p => ({ ...publicPromotion(p, { withCode: false }), max_uses: p.max_uses ?? null }))
    .filter(p => p.apply_mode === 'auto')
  const finalDesign = designOverride ? { id: design.id, name: design.name, ...normaliseDesign(designOverride) } : design
  const config = {
    kind: 'kiosk',
    preview,
    menu_version: version,
    venue: { id: venue.id, name: venue.name, timezone: tz },
    settings: settingsView(settings),
    stream: stream ? { id: stream.id, name: stream.name } : null,
    order_types: streamOrderTypes(stream, orderTypes),
    all_order_types: orderTypes.map(t => ({ id: t.id, name: t.name })),
    tax_rates: taxRates.map(r => ({ ...r, values: r.values[venueId] != null ? { [venueId]: r.values[venueId] } : {} })),
    menus,
    items,
    section_items,
    groups: Object.fromEntries(groups.map(g => [g.id, g])),
    dietary_tags: menuTags(dietary || []).map(t => ({
      code: t.code, label: t.label, kind: t.kind, colour: t.colour, glyph: t.glyph, standard_key: t.standard_key || null,
    })),
    allergen_notice: await loadAllergenNotice(tx, tenantId),
    promotions,
    sold_out: soldOut,
    design: finalDesign,
    // The kiosk receipt design (migration 190): null = the built-in layout.
    print_layouts: { receipt: (await printLayouts(tx, tenantId, venueId)).kiosk_receipt },
    translations: await loadTranslations(tx, tenantId, finalDesign.languages.enabled),
    device: { id: device.id, kind: 'kiosk', name: device.name, short_code: device.short_code, venue_id: venueId, settings: ds },
    // Its card machine (migration 193, services/cardSvc.js). Previews take
    // no money: their card step has its own pretend Approve and Decline.
    card_machine: preview ? null : await cardMachineOf(tx, tenantId, venueId, ds.card_reader),
  }
  config.version = sha256(JSON.stringify(config)).slice(0, 16)
  return config
}

// ── Preview links (services/previewLinks.js) ─────────────────────

const PREVIEW_HOURS = 12

/** A link token for previewing a design at a venue (with one of its revenue streams; menu 'live' | 'draft'). */
export function previewToken({ tenantId, venueId, designId, streamId = null, menu = 'live' }) {
  return makeLink('kiosk', { t: tenantId, v: venueId, d: designId, s: streamId, ...(menu === 'draft' ? { m: 'draft' } : {}) }, PREVIEW_HOURS)
}

/** { tenantId, venueId, designId, streamId, menuVersion } for a valid, unexpired token, else null. */
export async function readPreviewToken(token) {
  const p = await readLink('kiosk', token)
  return p ? { tenantId: p.t, venueId: p.v, designId: p.d, streamId: p.s || null, menuVersion: p.m === 'draft' ? 'draft' : 'live' } : null
}

/**
 * The menus a kiosk preview at this venue (as this revenue stream, else the
 * first) shows, as published or as the draft, whose draft isn't what is
 * published: [{ id, name }]. A menu only in one of the two (new, not
 * published yet, or no longer shown here) counts.
 */
export async function menuChanges(tx, tenantId, venueId, streamId) {
  const streams = await loadStreams(tx, tenantId, venueId, { activeOnly: true })
  const stream = streams.find(r => r.id === streamId) || streams[0] || null
  const list = stream ? [stream] : []
  const [live, draft] = await Promise.all([
    tillMenus(tx, tenantId, venueId, list, 'live'),
    tillMenus(tx, tenantId, venueId, list, 'draft'),
  ])
  const liveBy = new Map(live.map(m => [m.id, m]))
  const draftBy = new Map(draft.map(m => [m.id, m]))
  const out = []
  for (const m of draft) {
    const l = liveBy.get(m.id)
    if (!l || contentKey(l) !== contentKey(m)) out.push({ id: m.id, name: m.name })
  }
  for (const m of live) if (!draftBy.has(m.id)) out.push({ id: m.id, name: m.name })
  return out
}

/**
 * The dishes a kiosk at this venue leaves off its menu because it can't
 * price them (tillMenuData() with guest: no price of their own and no
 * priced option to choose), in the menus it shows: [{ id, name, menu }].
 * The design editor names them, so a dish missing from the kiosk isn't a
 * mystery.
 */
export async function unpricedDishes(tx, tenantId, venueId, streamId, version = 'live') {
  const streams = await loadStreams(tx, tenantId, venueId, { activeOnly: true })
  const stream = streams.find(r => r.id === streamId) || streams[0] || null
  const out = []
  const seen = new Set()
  for (const m of await tillMenus(tx, tenantId, venueId, stream ? [stream] : [], version)) {
    const rules = variantRules(m)
    for (const s of m.sections || []) {
      if ((s.visibility || 'show') !== 'show') continue
      for (const it of s.items || []) {
        if (seen.has(it.id) || isPriced(it, itemChoices(it, rules))) continue
        seen.add(it.id)
        out.push({ id: it.id, name: it.name, menu: m.name })
      }
    }
  }
  return out
}

/** The preview's device: not paired, test card reader, the stream and design the editor picked. */
export function previewDevice({ designId, streamId }) {
  return { id: PREVIEW_DEVICE_ID, kind: 'kiosk', name: 'Preview', short_code: 'KS', settings: { revenue_stream_id: streamId, design_id: designId, card_reader: 'preview' } }
}

/**
 * A design as saved: normalised, with the sections, dishes, order types and
 * option groups it names kept only when they are the tenant's (sections left
 * off, section tiles, banner and tile links, "Anything else?" dishes, order
 * type buttons, option groups with their own look).
 */
export async function ownDesign(tx, tenantId, raw) {
  const d = normaliseDesign(raw)
  const m = d.menu
  const links = [...m.banners, ...m.featured].map(x => x.link)
  const sectionIds = [...new Set([...m.hidden_section_ids, ...m.section_tiles.map(t => t.section_id), ...links.filter(l => l.kind === 'section').map(l => l.id)])]
  const itemIds = [...new Set([...d.checkout.upsell_item_ids, ...links.filter(l => l.kind === 'item').map(l => l.id)])]
  const typeIds = [...new Set([...Object.keys(d.start.type_cards), ...d.done.types.map(x => x.order_type_id)])]
  const groupIds = d.options.group_looks.map(x => x.group_id)
  const [sections, items, types, groups] = await Promise.all([
    sectionIds.length ? tx`SELECT id FROM menu_sections WHERE tenant_id = ${tenantId} AND id = ANY(${sectionIds}::uuid[])` : [],
    itemIds.length ? tx`SELECT id FROM menu_items WHERE tenant_id = ${tenantId} AND id = ANY(${itemIds}::uuid[])` : [],
    typeIds.length ? tx`SELECT id FROM order_types WHERE tenant_id = ${tenantId} AND id = ANY(${typeIds}::uuid[])` : [],
    groupIds.length ? tx`SELECT id FROM menu_variant_groups WHERE tenant_id = ${tenantId} AND id = ANY(${groupIds}::uuid[])` : [],
  ])
  const okSection = new Set(sections.map(r => r.id))
  const okItem = new Set(items.map(r => r.id))
  const okType = new Set(types.map(r => r.id))
  const okGroup = new Set(groups.map(r => r.id))
  const keepLink = l => ((l.kind === 'section' ? okSection : okItem).has(l.id) || l.kind === 'none' ? l : { kind: 'none', id: null })
  return {
    ...d,
    start: { ...d.start, type_cards: Object.fromEntries(Object.entries(d.start.type_cards).filter(([id]) => okType.has(id))) },
    menu: {
      ...m,
      hidden_section_ids: m.hidden_section_ids.filter(id => okSection.has(id)),
      section_tiles: m.section_tiles.filter(t => okSection.has(t.section_id)),
      banners: m.banners.map(b => ({ ...b, link: keepLink(b.link) })),
      featured: m.featured.map(f => ({ ...f, link: keepLink(f.link) })),
    },
    checkout: { ...d.checkout, upsell_item_ids: d.checkout.upsell_item_ids.filter(id => okItem.has(id)) },
    options: { ...d.options, group_looks: d.options.group_looks.filter(x => okGroup.has(x.group_id)) },
    done: { ...d.done, types: d.done.types.filter(x => okType.has(x.order_type_id)) },
  }
}

export async function checkDesign(tx, tenantId, id) {
  const [d] = await tx`SELECT id, name, settings FROM kiosk_designs WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!d) throw httpError(404, 'Kiosk design not found')
  return d
}
