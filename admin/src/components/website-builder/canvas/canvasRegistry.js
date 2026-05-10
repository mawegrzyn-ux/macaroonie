// canvas/canvasRegistry.js
//
// Maps block.type → canvas component used in the new page builder.

import {
  HeroCanvas, TextCanvas, ImageCanvas,
  CtaStripCanvas, DividerCanvas, FaqCanvas,
  ColumnsCanvas,
} from './blockCanvas'
import {
  HeaderCanvas, FooterCanvas, ScrollingTextCanvas,
  StoryWithStampCanvas, DishListCanvas, ReviewsBandCanvas,
  OrderOptionsCanvas,
} from './siteBlocks'
import {
  GalleryCanvas, OpeningHoursCanvas, FindUsCanvas, ContactCanvas,
  ReservationsWidgetCanvas, MenuPdfsCanvas, AllergensCanvas, MenuInlineCanvas,
} from './dataBlocks'

export const CANVAS_BY_TYPE = {
  // Site shell
  header:           HeaderCanvas,
  footer:           FooterCanvas,
  // Themed content
  scrolling_text:   ScrollingTextCanvas,
  story_with_stamp: StoryWithStampCanvas,
  dish_list:        DishListCanvas,
  reviews_band:     ReviewsBandCanvas,
  order_options:    OrderOptionsCanvas,
  // Layout / generic
  hero:           HeroCanvas,
  text:           TextCanvas,
  image:          ImageCanvas,
  cta_strip:      CtaStripCanvas,
  divider:        DividerCanvas,
  faq:            FaqCanvas,
  columns:        ColumnsCanvas,
  // Live-data blocks — each has its own faithful preview
  // (canvas/dataBlocks.jsx). Read from the actual venue config /
  // website tables / chosen menu and render the same shape the SSR
  // partial does.
  gallery:        GalleryCanvas,
  opening_hours:  OpeningHoursCanvas,
  find_us:        FindUsCanvas,
  contact:        ContactCanvas,
  reservations_widget: ReservationsWidgetCanvas,
  menu_pdfs:      MenuPdfsCanvas,
  allergens:      AllergensCanvas,
  menu_inline:    MenuInlineCanvas,
}

export function getCanvasComponent(type) {
  return CANVAS_BY_TYPE[type] || null
}
