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
//                     editor's live preview (no pairing needed, 12 hours)
//
// Every query filters tenant_id itself.

import crypto from 'node:crypto'
import { sql } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { ensureSettings, settingsView, ownVenue, tillMenuData, sha256 } from './posSvc.js'
import { venuePromotions, publicPromotion } from './promoSvc.js'
import { soldOutRows } from './soldOut.js'
import { ensureTaxDefaults, loadTaxRates, loadOrderTypes, loadStreams } from './taxSvc.js'
import { loadAllergenNotice } from '../routes/menus.js'
import { normaliseDesign, LANG_CODES } from '../../../shared/kiosk.js'
import { menuTags } from '../../../shared/menuTags.js'
import { venueNow } from '../../../shared/promotions.js'
import { seal, unseal } from './vault.js'

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
 * (the editor's preview) replaces the stored design's settings.
 */
export async function kioskConfig(tx, tenantId, venueId, device, { designOverride = null, preview = false } = {}) {
  const venue = await ownVenue(tx, tenantId, venueId)
  const settings = await ensureSettings(tx, tenantId, venueId)
  await ensureTaxDefaults(tx, tenantId)
  const ds = device.settings || {}
  const [streams, orderTypes, taxRates, groups, design] = await Promise.all([
    loadStreams(tx, tenantId, venueId, { activeOnly: true }),
    loadOrderTypes(tx, tenantId),
    loadTaxRates(tx, tenantId),
    tx`SELECT g.id, g.name, g.price_mode, g.min_select, g.max_select, g.pos_prefixes, g.allow_repeat, g.on_request,
              g.kiosk_display, g.scale_low, g.scale_high,
              COALESCE(json_agg(json_build_object('id', o.id, 'label', o.label, 'price_pence', o.price_pence, 'child_group_id', o.child_group_id,
                                                  'image_url', o.image_url, 'description', o.description, 'level', o.level)
                ORDER BY o.sort_order, o.label) FILTER (WHERE o.id IS NOT NULL), '[]') AS options
         FROM menu_variant_groups g
         LEFT JOIN menu_variant_options o ON o.group_id = g.id AND o.tenant_id = g.tenant_id
        WHERE g.tenant_id = ${tenantId}
        GROUP BY g.id`,
    loadDesign(tx, tenantId, ds.design_id || null),
  ])
  const stream = streams.find(r => r.id === ds.revenue_stream_id) || streams[0] || null
  const { menus, items, section_items, dietary } = await tillMenuData(tx, tenantId, venueId, stream ? [stream] : [], { guest: true, allStreams: streams })
  const tz = venue.timezone || 'Europe/London'
  const soldOut = (await soldOutRows(tx, tenantId, venueId)).map(r => ({ item_id: r.item_id, until: r.sold_out_until }))
  const promotions = (await venuePromotions(tx, { id: venueId, tenant_id: tenantId }, venueNow(tz).date, 'pos'))
    .map(p => ({ ...publicPromotion(p, { withCode: false }), max_uses: p.max_uses ?? null }))
    .filter(p => p.apply_mode === 'auto')
  const finalDesign = designOverride ? { id: design.id, name: design.name, ...normaliseDesign(designOverride) } : design
  const config = {
    kind: 'kiosk',
    preview,
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
    translations: await loadTranslations(tx, tenantId, finalDesign.languages.enabled),
    device: { id: device.id, kind: 'kiosk', name: device.name, short_code: device.short_code, venue_id: venueId, settings: ds },
  }
  config.version = sha256(JSON.stringify(config)).slice(0, 16)
  return config
}

// ── Preview links ────────────────────────────────────────────────

const PREVIEW_SECRET = 'kiosk_preview_key'
const PREVIEW_HOURS = 12
let secretCache = null

/** The key preview links are signed with: made once, kept in platform_secrets (sealed, migration 179). */
async function previewSecret() {
  if (secretCache) return secretCache
  const [row] = await sql`SELECT value FROM platform_secrets WHERE name = ${PREVIEW_SECRET}`
  if (row) return (secretCache = unseal(row.value))
  const value = crypto.randomBytes(32).toString('base64url')
  await sql`
    INSERT INTO platform_secrets (name, value, hint, updated_by)
    VALUES (${PREVIEW_SECRET}, ${seal(value)}, 'kiosk previews', 'system')
    ON CONFLICT (name) DO NOTHING`
  const [again] = await sql`SELECT value FROM platform_secrets WHERE name = ${PREVIEW_SECRET}`
  return (secretCache = unseal(again.value))
}

const sign = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url')

/** A link token for previewing a design at a venue (with one of its revenue streams). */
export async function previewToken({ tenantId, venueId, designId, streamId = null }) {
  const payload = Buffer.from(JSON.stringify({
    t: tenantId, v: venueId, d: designId, s: streamId, e: Date.now() + PREVIEW_HOURS * 3600_000,
  })).toString('base64url')
  return payload + '.' + sign(await previewSecret(), payload)
}

/** { tenantId, venueId, designId, streamId } for a valid, unexpired token, else null. */
export async function readPreviewToken(token) {
  const m = /^([A-Za-z0-9_-]{20,600})\.([A-Za-z0-9_-]{40,60})$/.exec(String(token || ''))
  if (!m) return null
  const want = sign(await previewSecret(), m[1])
  if (want.length !== m[2].length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]))) return null
  let p
  try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')) } catch { return null }
  if (!p || !(p.e > Date.now())) return null
  return { tenantId: p.t, venueId: p.v, designId: p.d, streamId: p.s || null }
}

/** The preview's device: not paired, test card reader, the stream and design the editor picked. */
export function previewDevice({ designId, streamId }) {
  return { id: PREVIEW_DEVICE_ID, kind: 'kiosk', name: 'Preview', short_code: 'KS', settings: { revenue_stream_id: streamId, design_id: designId, card_reader: 'test' } }
}

export async function checkDesign(tx, tenantId, id) {
  const [d] = await tx`SELECT id, name, settings FROM kiosk_designs WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!d) throw httpError(404, 'Kiosk design not found')
  return d
}
