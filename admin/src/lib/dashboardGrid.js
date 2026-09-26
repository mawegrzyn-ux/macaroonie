// src/lib/dashboardGrid.js
//
// Shared row-spanning grid for every customisable dashboard (H&S
// Dashboard, Cash Recon Dashboard, Overview tiles).
//
// The grid has fixed-height implicit rows (ROW_UNIT px) and packs with
// `grid-auto-flow: row dense`. A widget's stored `height_px` is snapped
// to a whole number of rows, so a tall widget spans several rows and the
// smaller widgets beside it stack into the space next to it instead of
// leaving a gap the height of the tallest card in the row.
//
// Stored values stay in px (the existing `height_px` columns), so no
// migration is needed: heightForRows() is what the resize controls
// write back, and rowSpanFor() reads any older free-form value.

export const ROW_UNIT  = 120
export const GRID_GAP  = 16
export const MIN_ROWS  = 2
export const MAX_ROWS  = 8

/** Card height in px for a whole number of rows, including the gaps it spans. */
export function heightForRows(rows) {
  return rows * ROW_UNIT + (rows - 1) * GRID_GAP
}

/** Number of grid rows a stored height_px occupies (snapped, clamped). */
export function rowSpanFor(heightPx) {
  const rows = Math.round((Number(heightPx || 0) + GRID_GAP) / (ROW_UNIT + GRID_GAP))
  return Math.min(MAX_ROWS, Math.max(MIN_ROWS, rows))
}

/** Grid container style: fixed-height rows, dense packing. */
export function gridStyle(columns) {
  return {
    display: 'grid',
    gap: GRID_GAP,
    gridAutoRows: `${ROW_UNIT}px`,
    gridAutoFlow: 'row dense',
    ...(columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : {}),
  }
}
