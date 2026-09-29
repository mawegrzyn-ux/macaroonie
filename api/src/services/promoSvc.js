// src/services/promoSvc.js
//
// Loading promotions (migration 131) for the ordering API and the admin
// page. The discount rules themselves are shared/promotions.js; this file
// only reads rows, counts uses and decides what the guest may see.
//
// A use is an order that took the promotion and has not been rejected,
// cancelled or expired, so a failed or cancelled order gives its use back.
// createOrder() locks the promotion rows it applies (lockUses) before
// counting, so two guests can't both take the last use.

const FREE_STATUSES = ['rejected', 'cancelled', 'expired']

const PROMO_COLS = `
  p.id, p.name, p.description, p.badge_text, p.is_active, p.kind,
  p.discount_type, p.discount_value, p.item_ids, p.section_ids,
  p.buy_qty, p.get_qty, p.get_percent, p.min_subtotal_pence, p.required_item_ids,
  p.max_discount_pence, p.apply_mode, p.code, p.max_uses, p.schedule, p.venue_ids,
  p.exclusive, p.sort_order, p.bundle, p.bundle_price_pence, p.tiers,
  p.show_in_box, p.box_bg, p.box_text, p.box_image_url, p.created_at, p.updated_at`

/**
 * Every promotion of the tenant, with uses and total discount so far.
 * Filters by tenant_id itself: RLS alone is not enough (the app's database
 * role may bypass it), same as every other route.
 */
export async function listPromotions(tx, tenantId) {
  return tx.unsafe(`
    SELECT ${PROMO_COLS},
           COALESCE(u.uses, 0)::int AS uses,
           COALESCE(u.discount_pence, 0)::int AS discount_given_pence
      FROM promotions p
      LEFT JOIN LATERAL (
        SELECT count(*) AS uses, sum(op.discount_pence) AS discount_pence
          FROM order_promotions op JOIN orders o ON o.id = op.order_id
         WHERE op.promotion_id = p.id AND o.status <> ALL($1::text[])
      ) u ON true
     WHERE p.tenant_id = $2
     ORDER BY p.sort_order, p.created_at
  `, [FREE_STATUSES, tenantId])
}

/**
 * The promotions that can apply at a venue now or later: switched on, for
 * this venue, not ended (date range) and not used up. `today` is the
 * venue-local date.
 */
export async function venuePromotions(tx, venue, today) {
  const venueId = venue.id
  const rows = await listPromotions(tx, venue.tenant_id)
  return rows.filter(p => p.is_active
    && (!p.venue_ids?.length || p.venue_ids.includes(venueId))
    && !(p.schedule?.until && p.schedule.until < today)
    && !(p.max_uses && p.uses >= p.max_uses))
}

/** What the guest page gets. The code only goes out to a guest who typed it. */
export function publicPromotion(p, { withCode = false } = {}) {
  return {
    id: p.id, name: p.name, description: p.description || null, badge_text: p.badge_text || null,
    is_active: true, kind: p.kind, discount_type: p.discount_type, discount_value: p.discount_value,
    item_ids: p.item_ids || [], section_ids: p.section_ids || [],
    buy_qty: p.buy_qty, get_qty: p.get_qty, get_percent: p.get_percent,
    min_subtotal_pence: p.min_subtotal_pence, required_item_ids: p.required_item_ids || [],
    max_discount_pence: p.max_discount_pence, apply_mode: p.apply_mode,
    code: withCode ? p.code : null,
    schedule: p.schedule || {}, venue_ids: p.venue_ids || [],
    exclusive: p.exclusive, sort_order: p.sort_order,
    bundle: p.bundle || [], bundle_price_pence: p.bundle_price_pence, tiers: p.tiers || [],
    show_in_box: !!p.show_in_box && p.apply_mode !== 'code',
    box_bg: p.box_bg || null, box_text: p.box_text || null, box_image_url: p.box_image_url || null,
  }
}

export const normCode = c => String(c || '').trim().toLowerCase()

/** The code promotion a guest's code opens at this venue, or null. */
export function findByCode(promos, code) {
  const c = normCode(code)
  if (!c) return null
  return promos.find(p => p.apply_mode === 'code' && normCode(p.code) === c) || null
}

/**
 * Inside createOrder()'s transaction: lock the applied promotions that have
 * a use limit and make sure each still has a use left. Returns the name of
 * the first one that has run out, or null.
 */
export async function lockUses(tx, tenantId, promoIds) {
  if (!promoIds.length) return null
  const rows = await tx`
    SELECT id, name, max_uses FROM promotions
     WHERE id = ANY(${promoIds}::uuid[]) AND tenant_id = ${tenantId} AND max_uses IS NOT NULL
     ORDER BY id
       FOR UPDATE
  `
  for (const p of rows) {
    const [{ n }] = await tx`
      SELECT count(*)::int AS n
        FROM order_promotions op JOIN orders o ON o.id = op.order_id
       WHERE op.promotion_id = ${p.id} AND o.status <> ALL(${FREE_STATUSES})
    `
    if (n >= p.max_uses) return p.name
  }
  return null
}
