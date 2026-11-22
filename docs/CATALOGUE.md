# Menus as catalogues: food, retail goods and services

**Status: step 1 of 4.6 built 22 Nov 2026 (migration 267); steps 2 to 6 not built. The user agreed all four decisions in section 7 as recommended (22 Nov 2026).**
ask: "I would like flexibility how we use menu. In a non-food retail scenario, we don't need all
the allergen info, we would also call the menu a catalogue. To accommodate it we would need a flag
indicating which menus (catalogues) or categories within menus are food, which retail goods, which
services. Before doing the flexibility change, research best practices and recommend structure."

The recommendation is section 4; the decisions to make are section 7. It meets the sales import
plan (`docs/SALES_IMPORT.md`) at the mapping tool: imported items land on catalogue items, and
Square already marks services (`product_type`).

## 1. What there is today

- `menus` → `menu_sections` → `menu_items` (migration 048). A menu is company-wide
  (`venue_id` null) or one venue's; an item sits in one section of one menu; a save replaces the
  whole tree (`upsertMenuTree`). Guests and devices read published releases (`menu_releases`
  snapshots; a new item column must go through `shared/menuDiff.js`).
- One price per item (`price_pence`). Options are a library of groups and options
  (`menu_variant_groups` / `menu_variant_options`) attached to dishes, with per-dish prices
  (`menu_item_variant_prices`), min / max, prefixes, nesting. Combos are items with
  `kind = 'combo'`.
- Allergens and diet tags: `menu_dietary_tags` (`kind` dietary | allergen, the 14 UK allergens by
  `standard_key`) and `menu_item_dietary` (contains / may contain / removable). Calories on items.
- Tax already **inherits**: `menus.tax`, `menu_sections.tax`, `menu_items.tax`; the dish's setting
  beats its section's, which beats the menu's (`shared/tax.js`).
- Menus has no type of its own. Items have no SKU, PLU or barcode.
- Allergens show or act in: the kiosk ("No allergens listed", the guest's filters), the till's
  dish window and allergy flag, the online ordering page and its allergen notice, website and
  printed menus, the Deliveroo file (a tag without a Deliveroo code blocks the download), the
  allergen matrix and lookup (`/allergens`, phone, widget), Pepper's `find_dishes`, the AI menu
  reader, combos (the union of their dishes').

## 2. What good practice says (sources at the end)

- **One sellable object for goods and services.** Square's catalogue item is "a product for sale
  (a latte) or a service for hire (dog walking)", with a `product_type` on the item (REGULAR,
  APPOINTMENTS_SERVICE; FOOD_AND_BEV now legacy). Prices and SKUs live on variations; a service's
  variation carries its duration and who can perform it. The retail standard model (ARTS) also
  treats items and services sold as one entity, with scan codes attached to the item.
- **The type belongs to the item; categories organise.** Retail models keep the item as the base
  unit and allow several category hierarchies over the same items; commerce platforms advise
  shallow category trees and setting shared attributes at the category level so items inherit
  them, with a small global attribute set for everything and type-specific sets on top.
- **Customisation differs by type.** Food and drink lean on variations *and* modifiers (high
  customisation); services use variations (length, level) and rarely modifiers; retail goods use
  variations for size and colour, each with its own SKU and barcode.
- **Food law applies to food.** In the UK the Food Information Regulations 2014 require the 14
  allergens to be declared for food (restaurants, takeaways, loose food in shops, delis); drinks
  are food for this purpose (sulphites in wine). Prepacked food has its own labelling rules. None
  of it applies to non-food goods or services.
- **Tax follows the thing sold.** Food, goods and services can carry different VAT (hot versus
  cold food, zero-rated goods); our tax inheritance already allows that per menu, section and item.

## 3. Why a flag on the menu alone isn't enough

A menu-level flag (the user's starting idea) covers a shop catalogue and a food menu, but real
venues mix: a café sells coffee and cakes (food), bags of beans and mugs (goods) and a latte-art
class (a service) from one till and often one menu; a bar sells drinks and merchandise; a spa
café sells treatments and lunch. Reports split sales by type (franchise fees and VAT often differ),
allergens must be complete for every food item even in a mixed menu, and the kitchen should never
get a mug. So the type must be known **per item**, while being **set once** where it is shared.

## 4. Recommended structure

### 4.1 Type, inherited like tax

- A sold item's type is one of **`food`** (food and drink: allergen rules), **`goods`** (retail
  goods: codes, variants, stock) or **`service`** (time or labour: duration, who, booking).
- Set at three levels, the most specific winning, exactly as tax does:
  `menus.item_type` (the default, required, `food` for every menu now), `menu_sections.item_type`
  (null = the menu's), `menu_items.item_type` (null = the section's). One rule,
  `itemType(item, section, menu)` in a shared `shared/catalogue.js`, used everywhere (rule 12).
- Named `item_type`, not `kind`: `menu_items.kind` already means dish or combo. A combo's type is
  its own (a meal deal of food is food; a gift bundle is goods).
- The published release carries each item's resolved type, so tills, kiosks and the website read
  it without working it out.

### 4.2 What the type switches

| | food | goods | service |
|---|---|---|---|
| Allergens and diet tags (matrix, lookup, kiosk line, till window, order page notice, print key, Deliveroo column) | yes, completeness checked | hidden | hidden |
| Calories | yes | hidden | hidden |
| Kitchen screens, tickets, courses | yes | no (unless switched on for the section) | no |
| SKU / barcode, brand | optional | **yes** | optional (a service code) |
| Variants with their own SKU, barcode, price | as now (options) | yes (4.3) | yes (length, level) |
| Stock (purchasing item link) | via recipes | per item / variant | no |
| Duration, staff role | no | no | yes (for bookings later) |
| Reports | "Type" on every dish and sales line | | |

Nothing is deleted when a type changes: hidden fields keep their values, so switching back loses
nothing.

### 4.3 Codes and retail variants

- `menu_items.sku`, `menu_items.barcode` (GTIN / EAN, checked digit), unique per menu when set.
  Needed for retail and for the sales mapping (SKU-first matching).
- Retail variants (a T-shirt in S / M / L, each with a barcode and maybe a price) fit the existing
  option model: an option group with `variation_type` set is the axis, and the per-dish option row
  (`menu_item_variant_prices`) gains `sku` and `barcode`, so each size of that item has its own
  codes. The till's barcode scan looks up item or item + option. No second variant system.

### 4.4 The words: menu or catalogue

- A catalogue's word follows its default type: a `food` menu is a **Menu**; a `goods` or
  `service` one is a **Catalogue** (in the menu list, its editor, the website and Pepper's words).
- The main menu's section name follows the group: **Menus** when every one is food, **Catalogues**
  when none is, **Menus & catalogues** when mixed; a group setting can fix the word instead. Code,
  tables and addresses keep `menus` (no rename: words only).
- Pepper is told the group's word and each catalogue's, so "add a mug to the shop catalogue" works.

### 4.5 Data changes (one migration)

- `menus.item_type text NOT NULL DEFAULT 'food' CHECK (item_type IN ('food','goods','service'))`;
  `menu_sections.item_type` and `menu_items.item_type` nullable with the same check.
- `menu_items.sku`, `menu_items.barcode`; `menu_item_variant_prices.sku`, `.barcode`.
- `tenant_settings` (or the existing group settings): `catalogue_word` null | 'menu' | 'catalogue' |
  'menus_and_catalogues'.
- Release snapshots rewritten to carry `item_type` (as migration 170 did for tax); `shared/menuDiff.js`
  learns the new fields. Every existing menu is `food` (pre-production: no other path).

### 4.6 Work, in order

1. Migration, `shared/catalogue.js` (`itemType()`, the switches of 4.2 as one table), release and
   diff, the menu editor's type pickers (menu, section, item) and field visibility.
2. The allergen surfaces of section 1 read the type (one helper: `needsAllergens(item)`).
3. Kitchen routing and courses skip non-food by default.
4. Codes and retail variants; barcode lookup on the till.
5. Words (4.4) across the admin, website, Pepper.
6. Reports: Type on dishes and sales lines; the Overview and dashboards split by type where they
   show sales.

## 5. What it doesn't do (yet)

- Stock control for goods beyond the purchasing link (counts, reorder points per variant).
- Services as bookings (staff calendars, durations on the timeline): the type and duration are
  the hook for it.
- Gift cards: they are a liability, not a sale, so they need their own handling (not a type).
- Prepacked food labelling (PPDS): out of scope; allergen data on items covers what menus show.

## 6. Risks

- Every place that reads allergens must use the one helper, or a goods item shows "No allergens
  listed". A test lists the surfaces (as the help-heading test does for Help).
- The release shape change touches tills, kiosks and the website at once: do it in one release
  with the readers.

## 7. Decisions for the user

- **D1** Type per item with menu and section defaults (recommended, like tax), or per menu only?
- **D2** Three types (food, goods, service), or more (e.g. split drink from food, or a "fees"
  type for packaging and deposits)?
- **D3** Words follow each catalogue's type with an automatic section name (recommended), or one
  group-wide word set in Settings?
- **D4** Codes and retail variants (4.3) in the first step, or after the type switch?

Answered 22 Nov 2026 ("agree all"): D1 per item with menu and section defaults; D2 three types; D3
words follow each catalogue's type, with the automatic section name; D4 codes after the type switch
(step 4).

Built in step 1, one difference from 4.1: the release carries the raw types (menu, section, dish),
not each item's resolved type. Readers call `itemType(item, section, menu)` from `shared/catalogue.js`,
which every app can import, and a release made before migration 267 (no types) reads as food.

## Sources

- Square, Catalog API: [design a catalog](https://developer.squareup.com/docs/catalog-api/design-a-catalog),
  [CatalogItemProductType](https://developer.squareup.com/reference/square/enums/CatalogItemProductType),
  [CatalogItemVariation](https://developer.squareup.com/reference/square/objects/CatalogItemVariation)
- OMG ARTS retail data model: [Items and services sold](https://www.omg.org/retail-depository/arts-odm-73/product_items_and_services_sol.htm)
- commercetools: [category management best practices](https://docs.commercetools.com/learning-model-your-product-catalog/categorization/best-practices-and-advanced-category-management)
- Wisepim: [product attribute modelling](https://wisepim.com/guides/catalog-management/attribute-modeling)
- UK Food Standards Agency: [allergen information for non-prepacked foods](https://www.food.gov.uk/business-guidance/allergen-information-for-non-prepacked-foods-best-practice-introduction),
  [allergen labelling technical guidance](https://www.gov.uk/government/publications/food-allergen-labelling-and-information-requirements-technical-guidance/food-allergen-labelling-and-information-requirements-technical-guidance)
