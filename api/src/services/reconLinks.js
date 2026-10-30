// Which systems fill each Cash Recon field of a venue, and with what: the
// income sources, payment channels and SC sources that tills and kiosks,
// Loyverse or GloriaFood write into when a day is filled. Read by the
// Cash Recon settings tabs (GET /api/venues/:id/cash-recon/links), so an
// operator sees which fields are typed in and which come from elsewhere.
//
// One entry per system in LINK_SOURCES. A new system that fills Cash
// Recon (through fillReconDay() in reconFill.js) adds its entry here,
// with where it is set up, and the settings page shows it with no change.

import { TENDERS } from '../../../shared/pos/checks.js'
import { isValidTerm as loyverseValid, termLabel as loyverseLabel } from '../../../shared/loyverse.js'
import { isValidTerm as gloriaValid, termLabel as gloriaLabel } from '../../../shared/gloriafood.js'

export const LINK_GROUPS = ['income', 'takings', 'sc']

/** { group: { fieldId: terms[] } } → { 'group:fieldId': [{ label, sign }] }, empty ones left out. */
function describe(map, label) {
  const out = {}
  for (const group of LINK_GROUPS) {
    for (const [id, terms] of Object.entries(map?.[group] || {})) {
      const shown = (Array.isArray(terms) ? terms : []).map(t => label(group, t)).filter(Boolean)
      if (shown.length) out[group + ':' + id] = shown
    }
  }
  return out
}

/** Store's own Loyverse / GloriaFood mapping terms: { sign, kind, ref?, label? }. */
const signedTerm = (valid, text) => t => (valid(t) ? { label: text(t), sign: t.sign === -1 ? -1 : 1 } : null)

export const LINK_SOURCES = [
  {
    key: 'pos',
    label: 'Tills and kiosks',
    where: { route: '/pos/recon', label: 'Store tech → Cash Recon link' },
    async load(tx, tenantId, venueId) {
      const [s] = await tx`
        SELECT recon_map, recon_auto_fill, tenders FROM pos_settings
         WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
      if (!s) return null
      const streams = await tx`SELECT id, name FROM pos_revenue_streams WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
      const streamName = new Map(streams.map(r => [r.id, r.name]))
      const tenderName = key => (s.tenders || []).find(t => t.key === key)?.label
        || TENDERS.find(t => t.key === key)?.label || key
      const fields = describe(s.recon_map, (group, t) => {
        if (typeof t !== 'string') return null
        if (group === 'income') {
          if (t === 'all') return { label: 'All sales', sign: 1 }
          if (t === '-refunds') return { label: 'Refunds', sign: -1 }
          return { label: 'Sales: ' + (streamName.get(t) || 'a revenue stream no longer there'), sign: 1 }
        }
        if (group === 'takings') return { label: tenderName(t), sign: 1 }
        return { label: t === 'tips' ? 'Tips' : 'Service charge', sign: 1 }
      })
      return {
        fields,
        note: s.recon_auto_fill ? 'Filled when the day is closed on the till' : 'Filled from Till reports when the day is closed',
      }
    },
  },
  {
    key: 'loyverse',
    label: 'Loyverse',
    where: { tab: 'loyverse', label: 'the Loyverse tab' },
    async load(tx, tenantId, venueId) {
      const [link] = await tx`SELECT mappings FROM loyverse_venue_links WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
      if (!link) return null
      return { fields: describe(link.mappings, (_, t) => signedTerm(loyverseValid, loyverseLabel)(t)), note: 'Filled with Fill from Loyverse' }
    },
  },
  {
    key: 'gloriafood',
    label: 'GloriaFood',
    where: { tab: 'gloriafood', label: 'the GloriaFood tab' },
    async load(tx, tenantId, venueId) {
      const [link] = await tx`SELECT mappings FROM gloriafood_venue_links WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
      if (!link) return null
      return { fields: describe(link.mappings, (_, t) => signedTerm(gloriaValid, gloriaLabel)(t)), note: 'Filled with Fill from GloriaFood' }
    },
  },
]

/**
 * { sources: [{ key, label, where, note, fields: n }] (only systems set up at
 *   the venue), fields: { 'income:<id>': [{ source, label, terms: [{ label, sign }] }] } }
 */
export async function reconLinks(tx, tenantId, venueId) {
  const sources = []
  const fields = {}
  for (const src of LINK_SOURCES) {
    const got = await src.load(tx, tenantId, venueId)
    if (!got) continue
    const keys = Object.keys(got.fields)
    sources.push({ key: src.key, label: src.label, where: src.where, note: got.note || null, fields: keys.length })
    for (const key of keys) (fields[key] ||= []).push({ source: src.key, label: src.label, terms: got.fields[key] })
  }
  return { sources, fields }
}
