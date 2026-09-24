// src/config/defaultDashboardTiles.js
//
// Canonical default Overview tile layout — mirrors migration 093's
// one-time seed for existing tenants. Used for brand-new tenants (see
// platform.js's tenant creation route) and the Overview page's future
// "reset to defaults" action, if one is ever added. Keep in sync with
// the migration's seed by hand — the migration itself never re-runs.

export const DEFAULT_DASHBOARD_TILES = [
  { tile_type: 'quick_access',      col_span: 4, height_px: 200 },
  { tile_type: 'stats_today',       col_span: 4, height_px: 180 },
  { tile_type: 'upcoming_bookings', col_span: 2, height_px: 420 },
  { tile_type: 'venues_status',     col_span: 2, height_px: 280 },
]

/** Insert the default tile set for one tenant. Caller decides whether to clear existing rows first. */
export async function seedDefaultDashboardTiles(tx, tenantId) {
  for (let i = 0; i < DEFAULT_DASHBOARD_TILES.length; i++) {
    const tile = DEFAULT_DASHBOARD_TILES[i]
    await tx`
      INSERT INTO dashboard_tiles (tenant_id, tile_type, col_span, height_px, sort_order)
      VALUES (${tenantId}, ${tile.tile_type}, ${tile.col_span}, ${tile.height_px}, ${i})
    `
  }
}
