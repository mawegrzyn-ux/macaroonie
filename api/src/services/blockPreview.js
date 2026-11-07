// src/services/blockPreview.js
//
// Live previews of website blocks in the page builder. Blocks whose look
// comes from live data drawn in the guest's browser (the ordering app, the
// loyalty card, the AI chat, Guestplan's widget, reviews from the reviews
// list) are rendered by the site's own code in a frame, instead of a copy
// in the admin that drifts:
//
//   POST /api/website/block-preview      (routes/website.js) makes a signed
//        link carrying the tenant, the page's venue and the block as the
//        builder has it now (saved or not)
//   GET  /_preview/block?t=<link>        (routes/siteRenderer.js) renders
//        that one block with the draft site (as staging does), on the
//        restaurant's own site address, so the block's scripts reach its
//        public APIs and a third-party script (Guestplan) runs away from
//        the admin
//
// The link is the key: it can't be changed (signed), runs out after
// PREVIEW_HOURS and only renders the kinds in PREVIEW_BLOCK_TYPES (no
// text or HTML blocks).

import { makeLink, readLink } from './previewLinks.js'

export const PREVIEW_BLOCK_TYPES = ['online_ordering', 'loyalty_card', 'ai_chat', 'guestplan_widget', 'reviews_band']
export const PREVIEW_HOURS = 2
// The block's JSON may be this long; the link's payload is base64 of it
// plus the ids, so a few thousand characters (fine in a URL).
export const PREVIEW_MAX_BLOCK = 4000
const MAX_PAYLOAD = 7000

/**
 * A link for one block. t = tenant id, s = the site's slug, v = the
 * page's venue (or null), b = the block, o = options ({ sample: true }
 * shows the loyalty card signed in as a sample member).
 */
export function blockPreviewToken({ tenantId, slug, venueId, block, sample }) {
  return makeLink('block_preview', {
    t: tenantId, s: slug, v: venueId || null,
    b: { id: block.id, type: block.type, data: block.data || {} },
    ...(sample ? { o: { sample: true } } : {}),
  }, PREVIEW_HOURS)
}

/** The link's data, or null for one that is wrong, run out or another kind. */
export async function readBlockPreview(token) {
  const p = await readLink('block_preview', token, { max: MAX_PAYLOAD })
  if (!p || !p.t || !p.s || !p.b || !PREVIEW_BLOCK_TYPES.includes(p.b.type)) return null
  return p
}
