// src/pages/docs/combos.jsx
// The Docs page's "Combos" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, Code, DataTable } from './parts.jsx'

export const id = 'combos'
export const label = 'Combos'
export const order = 400

// ── COMBOS ───────────────────────────────────────
export function Section() {
  return (
    <section id="combos" data-doc="">
      <H2>Combos</H2>
      <P>
        Migration 171. A combo is a <Mono>menu_items</Mono> row with <Mono>kind = 'combo'</Mono> and a{' '}
        <Mono>combo</Mono> jsonb: steps with choices, conditions and repeats, used by the till, online
        ordering, the kitchen, the website, printed menus and menu screens. It replaced the till-only meal
        deal slots (<Mono>{'{ slots: [...] }'}</Mono>), which the migration turned into steps in the menu
        tables and in every <Mono>menu_releases</Mono> snapshot (choice ids from{' '}
        <Mono>md5(slot id + dish / section id)</Mono>, so drafts and releases match; hashes blanked and
        recomputed at start by <Mono>rehashReleases()</Mono>).
      </P>
      <Code>{`menu_items.combo = {
  mode: 'manual' | 'auto',
  steps: [{
    id, name, min, max,          // min 0 = optional; max up to 20
    repeat,                      // the same choice more than once
    auto,                        // fill (and skip) a step with one open choice
    ask: 'always' | 'button',    // 'button' only when min = 0
    when: null | { step_id, option_ids },   // an EARLIER step; [] = anything picked there
    options: [{ id, type: 'item' | 'section' | 'custom',
                item_id, section_id, label, kitchen_name, price_pence,
                photo_url,               // only when set (the meal's picture, migration 199)
                groups }],               // only when set: the dish's options in this deal (below)
  }],
}
selection.combo = { [stepId]: [{ option_id, item_id, choices }] }   // item_id null for a custom choice`}</Code>
      <H3>One set of rules: shared/combos.js</H3>
      <DataTable
        head={['Function', 'What it does']}
        rows={[
          ['normaliseCombo(raw), comboOf(item)', 'The stored shape, cleaned; comboOf caches it on the item (non-enumerable _combo).'],
          ['menuCtx(menu), sectionItemsOf(menus)', 'ctx = { itemsById, sectionItems } that every function below takes to find a step\'s dishes.'],
          ['stepChoices(step, ctx)', 'A step\'s choices: items, every dish of a section (key option.id + ":" + itemId), custom ones; never a combo or the combo itself; sold out flagged.'],
          ['resolveSteps(item, picks, ctx)', '{ picks, steps: [{ step, choices, shown, auto }] }: drops picks on steps whose condition no longer holds (in step order), fills single-choice auto steps.'],
          ['priceCombo(item, selection, ctx, partPrice)', '{ ok, parts, upcharge, extras, picks } or { ok: false, error, step_id }. partPrice(part, choices) is the caller\'s option engine; a part\'s base options never change the deal price, its extras do.'],
          ['comboFromPrice(item, base, ctx)', '{ pence, varies }: own price + cheapest picks of unconditional required steps; varies when any choice has a charge. Wrapped by fromPrice() / priceVaries() / comboMenuPrice() in shared/orderPricing.js.'],
          ['comboGuide(item, ctx)', 'The steps in words for a menu screen\'s How to order view.'],
          ['findAutoCombos(lines, combos, ctx, base)', 'Automatic combos in a set of separate lines: greedy, biggest saving first, only when cheaper than the lines; a line with picks ({ groupKey: [optionId] }) only fills a choice whose deal options it fits (dealFits(), the cheapest such choice); returns [{ combo_id, name, count, saving, lines: { key: pence } }] with the saving spread by spreadCapped() (never more than a line\'s own price).'],
          ['combosWithItem(), stepWithItem()', 'Which combos offer a dish and where it goes (the till\'s Make it a combo).'],
          ['comboProblems(combo, { itemIds, sectionIds })', 'What stops a combo working (the editor\'s amber list).'],
          ['countParts(parts)', 'For display only: the same pick twice in a step as one entry with a count ("2 x Ketchup pot"). Works on till, online and kitchen part shapes.'],
          ['normaliseDealGroups(raw), dealChoices(choices, groups, swap), dealSwapIds(item), dealFits(groups, picks)', 'A dish choice\'s options in the deal (next heading): the stored shape cleaned, the rule applied to a dish\'s choice list, the library groups a combo swaps in, and whether a dish ordered on its own could have been asked that way.'],
        ]}
      />
      <H3>A dish&apos;s options in a deal</H3>
      <P>
        A dish or section choice can change what its dish asks inside the deal, one option group at a
        time (Edit steps &rarr; Options in this deal). The choice keeps <Mono>item_id</Mono> /{' '}
        <Mono>section_id</Mono>, so routing, stock, allergens, photos and sold out still follow the menu
        dish; only the dish&apos;s choice list changes. No migration: <Mono>groups</Mono> lives in the
        combo jsonb, stored only when set (never on a custom choice), so a plain save publishes nothing.
      </P>
      <Code>{`option.groups = {
  [groupKey]: {                  // a library group id, or 'variants' for the dish's own one-off options ('v:<label>' ids)
    use: 'all' | 'off' | 'only' | 'swap',
    option_ids,                  // 'only': the options kept (none left = 'off')
    group_id,                    // 'swap': the library group asked instead (not itself)
    max, min,                    // optional limits in the deal
    prices,                      // optional { optionId: pence } (0-100000): the deal's own extra charge per option
  },                             // 'all' with no limits and no prices is dropped
}`}</Code>
      <P>
        <Mono>dealChoices(choices, groups, swap)</Mono> in shared/combos.js is the one rule, applied to a
        dish&apos;s choice list in the caller&apos;s shape: off drops the group, only filters its options,
        swap asks <Mono>swap(groupId, choice)</Mono> for the other group in the same shape (null = left
        out), then the limits (max capped at the options left unless the group repeats; a group with min
        &gt; 0 is never on request). A group with no options left is dropped. A group the deal changes
        that ends with one option and needs a pick (min &ge; 1; a repeating group only when min = max;
        not an option with a child_group_id) comes back with <Mono>fixed</Mono> (that option&apos;s id,
        min times for a repeating group): the deal picks it and nobody is asked. A group with{' '}
        <Mono>prices</Mono> is asked as extras (<Mono>withDealPrices()</Mono>: <Mono>mode: 'extra'</Mono>,
        each option at its deal price, else its own price in an extra group or 0 in a base group, whose
        prices are dish prices the deal&apos;s price replaces), so every engine charges it with no code of
        its own and <Mono>optionPriceText()</Mono> shows &ldquo;+£0.50&rdquo;. Each surface wraps it:
      </P>
      <DataTable
        head={['Where', 'How']}
        rows={[
          ['Pricing', 'priceCombo() passes the choice\'s groups as partPrice(part, picks, groups); priceItem() (till, kiosk) prices with partChoices(part, groups, groupsById) and priceLine() (online) with partOptions(combo, part, groups), so a pick the deal doesn\'t ask is refused and another group charges its own prices.'],
          ['Till and kiosk', 'partChoices() in shared/pos/pricing.js builds a swapped group as if attached (posChoices with variant_rules); dealItem(config, id, groups) in shared/pos/offers.js is the part with deal pos_choices, used by ItemModal ComboSteps, the kiosk Builder (comboPages), bundleParts() and comboStartFrom(). Make it a combo trims carried picks with picksWithin().'],
          ['Online', 'loadOrderingMenu() loads dealSwapIds() of the live combos from the library (COALESCE(display_name, name)) and gives each combo deal_groups { id: choice } (itemChoices with the menu\'s variant rules); ordering.eta asks partOptions() for every part page and the summary.'],
          ['What the deal picks (fixed)', 'withDealPicks(choices, picks) in shared/combos.js fills each fixed group in, replacing whatever was sent; the part callbacks of priceItem() and priceLine() call it, so the pick is priced and is in the part\'s modifiers / options and on kitchen tickets whatever a device sent. Surfaces ask only askedChoices(choices): the till\'s ComboSteps shows the pick as text (combo-fixed); the kiosk makes no part page for a dish with nothing left to ask and fills its picks with fillDealPicks(config, steps, picks) (shared/pos/offers.js) before its pictures and the basket line, so the meal\'s picture shows the deal\'s flavour; online, partChoices() is askedChoices(dealOptions()) and the summary lists withDealPicks(). The admin window says "always X" (deal-asked data-fixed) and, for an optional group left with one option, how to include it (deal-one-optional).'],
          ['Automatic combos', 'findAutoCombos() fills a choice with a separate dish only when dealFits(choice.groups, picks): picks in a group the deal narrows must be its options and within its how many; groups it leaves out or swaps don\'t count (those picks stay paid on the dish). The till passes each line\'s top-level picks from its modifiers (linePicks() in shared/pos/offers.js, not "No" or nested ones), online priceBasket() each line\'s choices.'],
          ['Saving', 'cleanCombo() in upsertMenuTree() keeps, per choice, only groups its dishes have (a section: any of its dishes), only option ids those dishes offer, and a swap group in the tenant\'s library (cleanDealGroups()); prices only for options the deal asks (only: the kept ids; swap: the other group\'s options); another tenant\'s ids are dropped. A group taken off the dish drops out on the next save. moveDealGroup() (own options turned into a group) carries prices to the new option ids.'],
          ['Extra charges', 'DealPrices in ComboEditor.jsx (Extra charges in the deal, folded until one is set; a div toggle so View users can open it), a PriceInput per option of the group as asked (empty = as on the dish, the placeholder its own charge; 0.00 = free); askedText() and dealSummary() (pricesText()) name the charges. comboFromPrice() says varies when any choice has a deal price over 0. A step that picks itself shows its choice\'s charge beside Included (ItemModal ComboSteps, ordering.eta stepHtml autoCharge).'],
          ['Releases, copies, AI', 'releaseContent() keeps the combo whole and contentKey() sorts keys, so a draft and a release compare equal; menuSaveBody() and /duplicate carry it; Pepper\'s get_menu says "(its options changed for this deal)".'],
          ['Admin', 'ComboEditor.jsx: DealOptionsButton (summary from dealSummary()) under each dish / section choice, DealOptionsModal / DealGroupRow (modes, option chips, swap select with Make a copy through POST /menus/variant-groups/:id/copy, how many), comboPayload() normalises.'],
        ]}
      />
      <P>
        Tested: 16 shared unit tests (shared/test/dealOptions.test.mjs, automatic combos on the till and
        online included, and the deal&apos;s own picks: when a group is fixed, filling, asking, the kiosk&apos;s
        picks and picture, till and online prices), 5 API tests
        (api/test/deal-options.test.mjs: cleaning, section unions, detached groups, publish, copy, kiosk
        config and pricing, the online menu and quote, another tenant), the fixtures&apos; meal deal in
        the tenant sweep, 67 browser checks (the window at 1280, 1015 and 390 px and for a viewer, the
        kiosk upright and wide, a real till with Make it a combo, online ordering at 1280 and 390 px) and
        34 more for a group left with one option (the window and its hint, the kiosk upright and wide, a
        real till, online ordering at 1280 and 390 px). Extra charges: 6 more shared tests (stored shape,
        the rule, till and kiosk, online, from, moveDealGroup), an API test (kept only for asked options,
        400 for a bad price, nothing to publish after a plain save, the kiosk config and online quote
        charging it), the fixtures&apos; meal deal with a charge in the sweep, 63 browser checks (the window
        at 1280 and 390 px and for a viewer, the kiosk upright and wide, a real till, online ordering at
        1280 and 390 px).
      </P>
      <H3>Where combos are read</H3>
      <DataTable
        head={['Surface', 'How']}
        rows={[
          ['Menus API', 'routes/menus.js: ComboBody Zod; cleanCombo() inside upsertMenuTree() drops choices for dishes / sections not on the menu, combos and itself, and conditions on later or unknown steps; remapCombo() on /duplicate; menuSaveBody() carries kind + combo.'],
          ['Till', 'posSvc tillConfig(): items carry kind + combo, config.section_items. shared/pos/pricing.js priceItem() prices through priceCombo(); line.combo = parts { step_id, step, option_id, item_id, name, kitchen_name, section_id, course_id, upcharge, modifiers, extras, custom }. pos/src/lib/checkOps.js: comboCtx(), autoCombosFor() (refreshed on every line change by Check.jsx), combosForLine() / comboStartFrom() (Make it a combo).'],
          ['Automatic combos on the till', 'Stored as promotions.set entries { promotion_id: comboItemId, name, kind: "combo", count, lines } (checks.js accepts kind combo and count). checkTotals() names them "X x N" and flags combo: true. promotionsFor() applies combos first, promotions on what is left.'],
          ['Online ordering', 'orderSvc loadOrderingMenu(): items carry kind, combo, from_pence, from_varies; partsById (every dish of the menus in shown sections, orderable or not) as combo_parts and section_items in GET /order-api/venues/:id; basketCombos(menu) gives priceBasket() its combos. priceBasket() applies automatic combos before promotions (promotions run on line_total minus the combo saving) and returns combos[] + combo_discount_pence. order_items.parts; order_promotions rows with promotion_id NULL and combo_item_id for automatic combos. /order-api/combos.js serves shared/combos.js to the guest page.'],
          ['Kitchen', 'shared/pos/kitchen.js: a combo line is the header with parts; each part routes by its own dish (a custom part like the combo), the item route is mergeRoutes(parts); stations see only their own parts. kitchenSvc onlineSnapshot() sends parts for online orders. printing.js: parts print on their own printers under the combo\'s name; a custom part prints where the combo does.'],
          ['Website, print, canvas', 'comboMenuPrice(item, menu) in menu_inline.eta (it.siteBlocks), menu_print.eta, shared/menuLayout.js and MenuInlineCanvas: the description and the price, "from" when it varies; no steps.'],
          ['Menu screens', 'screenSvc slimItem() keeps kind + combo; shared/screenLayout.js menu and dish blocks take opts.combo_view: "menu" | "steps" (comboStepsHtml(), .sl-steps); combos.js is in PLAYER_LIBS and the player\'s sw.js shell.'],
          ['AI menu tools', 'get_menu shows a combo\'s steps (comboText()); removing dishes or a section lists the combos that lose those choices (comboRefs()). The tools don\'t edit steps.'],
        ]}
      />
      <H3>Option groups: repeat and on request</H3>
      <P>
        <Mono>menu_variant_groups.allow_repeat</Mono> (the same option more than once; max is not capped
        at the number of options) and <Mono>on_request</Mono> (an optional group waits behind a button;
        ignored when min &gt; 0). Both reach the till through <Mono>posChoices()</Mono> /{' '}
        <Mono>groupChoice()</Mono> and online through <Mono>itemChoices()</Mono> as{' '}
        <Mono>choice.repeat</Mono> / <Mono>choice.on_request</Mono>; <Mono>menuDiff.js</Mono> drops them
        when false so existing releases don&apos;t read as changed. The till keeps one modifier per pick
        and groups them for display with <Mono>groupModifiers()</Mono> (shared/pos/pricing.js,{' '}
        <Mono>modifierText()</Mono> prints &ldquo;2 x Cheese&rdquo;); online orders store a repeated pick
        once with the count in its label and the summed price (<Mono>priceChoiceSet()</Mono>).
      </P>
      <P>
        Tested: 92 shared unit tests (combos, pricing, auto matching, kitchen, grouping), 30 API checks
        against Postgres (save, clean, copy, publish, migration, ordering menu, quote, order, print), the
        admin editor in Chromium at 1280 and 1015 px, the till (steps, repeats, on-request groups, auto
        combo, Make it a combo, send, kitchen screen), the guest ordering page at 1280 and 390 px, a menu
        screen board in both views and the website Menu block.
      </P>
    </section>
  )
}
