// shared/menuSave.js
//
// A loaded menu (loadMenuFull() in api/src/routes/menus.js, what
// GET /api/menus/:id returns) as the whole-tree PATCH body, every field kept
// and every id kept, so a save of an unchanged body changes nothing. The one
// implementation, used by the menus routes (/duplicate, restore), the AI menu
// tools (src/ai/tools/menus.js) and the item mapping's Create missing dishes
// (api/src/services/itemMappingMake.js), which edit this body and PATCH it
// back. Moved here from routes/menus.js (which still exports it) so other
// areas can build on the menu without importing the menus area's routes.
//
// A new menu, section or dish field must be added here as well as to the
// Menus page's save payload, or every caller drops it on every save.

import { cleanTax } from './tax.js'
import { cleanItemType, cleanSku, cleanBarcode } from './catalogue.js'

export function menuSaveBody(full) {
  return {
    name: full.name, slug: full.slug, venue_id: full.venue_id ?? null,
    tagline: full.tagline ?? null, service_times: full.service_times ?? null, intro_line: full.intro_line ?? null,
    is_published: !!full.is_published, sort_order: full.sort_order ?? 0,
    print_columns: full.print_columns ?? 4, print_orientation: full.print_orientation ?? 'landscape',
    print_paper_size: full.print_paper_size ?? 'A4',
    print_hide_variant_group_headers: !!full.print_hide_variant_group_headers,
    print_settings: full.print_settings ?? {},
    hide_zero_priced_variants: !!full.hide_zero_priced_variants,
    hide_unpriced_variants: !!full.hide_unpriced_variants,
    tax: cleanTax(full.tax),
    item_type: cleanItemType(full.item_type) || 'food',
    sections: (full.sections || []).map((s, si) => ({
      id: s.id,
      title: s.title, subtitle: s.subtitle ?? null, highlight: !!s.highlight, image_url: s.image_url ?? null, sort_order: si,
      print_break_before: s.print_break_before ?? 'none', print_keep_together: !!s.print_keep_together,
      tax: cleanTax(s.tax),
      item_type: cleanItemType(s.item_type),
      visibility: s.visibility || 'show',
      pos_course_id: s.pos_course_id ?? null, pos_colour: s.pos_colour ?? null,
      items: (s.items || []).map((it, ii) => ({
        id: it.id,
        kind: it.kind === 'combo' ? 'combo' : 'dish', kitchen_name: it.kitchen_name ?? null,
        pos_course_id: it.pos_course_id ?? null, pos_colour: it.pos_colour ?? null,
        combo: it.kind === 'combo' ? (it.combo ?? null) : null,
        name: it.name, native_name: it.native_name ?? null, description: it.description ?? null,
        price_pence: it.price_pence ?? null, calories: it.calories ?? null, notes: it.notes ?? null,
        is_featured: !!it.is_featured, image_url: it.image_url ?? null, sort_order: ii,
        is_orderable: it.is_orderable !== false,
        tax: cleanTax(it.tax),
        item_type: cleanItemType(it.item_type),
        sku: cleanSku(it.sku), barcode: cleanBarcode(it.barcode),
        option_codes: (it.option_codes || []).map(oc => ({ option_id: oc.option_id, sku: cleanSku(oc.sku), barcode: cleanBarcode(oc.barcode) })),
        min_order_qty: it.min_order_qty > 1 ? it.min_order_qty : null,
        variants: (it.variants || []).map((v, vi) => ({ label: v.label, price_pence: v.price_pence, sort_order: vi })),
        // loadMenuFull() shapes attached groups as { options: [{ overridden, price_pence, option_id }] };
        // the PATCH wants { overrides: [{ option_id, price_pence }] } (only the overridden ones).
        variant_groups: (it.variant_groups || []).map((g, gi) => ({
          group_id: g.group_id,
          sort_order: gi,
          overrides: g.overrides ?? (g.options || [])
            .filter(o => o.overridden)
            .map(o => ({ option_id: o.option_id, price_pence: o.price_pence })),
        })),
        dietary: [...(it.dietary || [])],
        allergen_levels: { ...(it.allergen_levels || {}) },
      })),
    })),
    callouts: (full.callouts || []).map((c, ci) => ({
      id: c.id, kind: c.kind || 'custom', title: c.title, body: c.body ?? null, sort_order: ci,
    })),
  }
}
