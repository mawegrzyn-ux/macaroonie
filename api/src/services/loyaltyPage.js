// src/services/loyaltyPage.js
//
// The loyalty web app's page (views/site/loyalty.eta), its manifest and its
// service worker, drawn the same on a tenant's own site (/loyalty, routes/
// siteRenderer.js) and on loyalty.{root}/<slug> (routes/loyaltySite.js).
// Only `base` (where the app lives) changes; the page calls
// /loyalty-api/t/<slug> on whatever host it is on.

import { withTenant } from '../config/db.js'
import { ensureProgramme, tenantSite } from './loyaltySvc.js'
import { cardColours } from './walletSvc.js'

const HEX = /^#[0-9a-f]{6}$/i
const pick = (v, d) => (typeof v === 'string' && HEX.test(v) ? v : d)
function lum(hex) {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/** What the page needs, or null when loyalty or its web app is off. */
export async function loyaltyPageData(tenantId, slug, base) {
  return withTenant(tenantId, async tx => {
    const programme = await ensureProgramme(tx, tenantId)
    if (!programme.enabled || !programme.settings.features.web_app) return null
    const site = await tenantSite(tx, tenantId)
    const c = site?.colors || {}
    const primary = pick(c.primary, '#630812')
    const card = cardColours(programme.settings, c)
    return {
      slug, base, apiBase: '/loyalty-api',
      programmeName: programme.settings.name,
      brandName: site?.name || programme.settings.name,
      logoUrl: site?.logo_url || null,
      faviconUrl: site?.favicon_url || null,
      colors: {
        primary, onPrimary: lum(primary) > 0.45 ? '#111111' : '#ffffff',
        bg: pick(c.background, '#f5f5f4'), surface: pick(c.surface, '#ffffff'), text: pick(c.text, '#1f2937'),
        muted: pick(c.muted, '#6b7280'), border: pick(c.border, '#e5e7eb'),
        cardBg: card.background, cardText: card.text, cardAccent: card.accent,
      },
    }
  })
}

export function loyaltyManifest(data) {
  return {
    name: data.programmeName + ' – ' + data.brandName,
    short_name: data.programmeName.slice(0, 20),
    start_url: data.base,
    scope: data.base + '/',
    display: 'standalone',
    background_color: data.colors.bg,
    theme_color: data.colors.primary,
    icons: data.faviconUrl ? [{ src: data.faviconUrl, sizes: 'any' }] : [],
  }
}

// A worker with a fetch handler so the app can be installed; it caches
// nothing (the card must always be the current one).
export const LOYALTY_SW = "self.addEventListener('install', () => self.skipWaiting())\n" +
  "self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))\n" +
  "self.addEventListener('fetch', () => {})\n"

/** Answer a request for the page, its manifest or its worker. */
export async function serveLoyaltyApp(reply, { tenantId, slug, base, what }) {
  const data = await loyaltyPageData(tenantId, slug, base)
  if (!data) return null
  reply.header('Cache-Control', 'no-store')
  if (what === 'manifest') return reply.type('application/manifest+json').send(JSON.stringify(loyaltyManifest(data)))
  if (what === 'sw') return reply.type('text/javascript; charset=utf-8').header('Service-Worker-Allowed', base + '/').send(LOYALTY_SW)
  reply.header('X-Robots-Tag', 'noindex')
  return reply.view('site/loyalty.eta', data)
}
