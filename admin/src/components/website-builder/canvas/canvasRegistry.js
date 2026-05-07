// canvas/canvasRegistry.js
//
// Maps block.type → canvas component used in the new page builder.

import {
  HeroCanvas, TextCanvas, ImageCanvas, TwoColumnCanvas,
  CtaStripCanvas, DividerCanvas, FaqCanvas, DataPlaceholderCanvas,
  ColumnsCanvas,
} from './blockCanvas'

export const CANVAS_BY_TYPE = {
  hero:           HeroCanvas,
  text:           TextCanvas,
  image:          ImageCanvas,
  two_column:     TwoColumnCanvas,
  cta_strip:      CtaStripCanvas,
  divider:        DividerCanvas,
  faq:            FaqCanvas,
  columns:        ColumnsCanvas,
  // All "live data" blocks share one placeholder.
  gallery:        DataPlaceholderCanvas,
  opening_hours:  DataPlaceholderCanvas,
  find_us:        DataPlaceholderCanvas,
  contact:        DataPlaceholderCanvas,
  booking_widget: DataPlaceholderCanvas,
  menu_pdfs:      DataPlaceholderCanvas,
  allergens:      DataPlaceholderCanvas,
}

export function getCanvasComponent(type) {
  return CANVAS_BY_TYPE[type] || null
}
