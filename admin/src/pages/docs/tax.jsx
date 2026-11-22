// src/pages/docs/tax.jsx
// The Docs page's "Tax, Order Types & Streams" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'tax'
export const label = 'Tax, Order Types & Streams'
export const order = 410

// ── TAX, ORDER TYPES & REVENUE STREAMS ─────────────
export function Section() {
  return (
    <section id="tax" data-doc="">
      <H2>Tax, Order Types &amp; Revenue Streams</H2>
      <P>
        Migration 170. Tax rates are a tenant list with values per location; order types are a tenant
        list; revenue streams (renamed from revenue centres) are per-venue till groupings that decide
        which order types a till offers and what each asks for, never tax. A dish&apos;s tax is a setting
        on its menu, section and dish with exceptions per order type, location and revenue stream. One
        resolver, <Mono>shared/tax.js</Mono>, is used by the till, online ordering, the Deliveroo file,
        the admin Tax box and the Tax rates check.
      </P>
      <DataTable
        head={['Table', 'What it holds']}
        rows={[
          ['tax_rates', 'Tenant list: name, rate numeric(5,2), is_default (one per tenant, partial unique index), is_active (removing archives; the default or a rate a draft menu uses can\'t be removed), sort_order. Seeded Standard 20 (default) and Zero 0 by the migration and ensureTaxDefaults() (new tenants: POST /api/platform/tenants).'],
          ['tax_rate_values', 'A location\'s own % for a rate: (tax_rate_id, venue_id, rate). ratePercent(rate, venueId) = values[venueId] ?? rate.rate.'],
          ['order_types', 'Tenant list: name, colour, sort_order, is_active (archived, never deleted: checks, orders and kitchen orders point at them). Seeded Eat in, Take out, Delivery, Collection.'],
          ['pos_revenue_streams', 'Renamed from pos_revenue_centres; vat_mode dropped, default_order_type_id added (from vat_mode: eat_in -> Eat in, takeaway -> Take out).'],
          ['pos_stream_order_types', '(stream_id, order_type_id, enabled, ask_name, ask_tent), ask_* off | ask | required. No row = the stream doesn\'t offer the type. Migrated streams offer Eat in and Take out, asking for a name.'],
          ['menus.tax, menu_sections.tax, menu_items.tax', 'jsonb { rate: tax_rate_id | null, rules: [{ venues: [], streams: [], types: [], rate }] }, {} = not set. The migration turned each eat-in % into the rate and each takeaway % into an exception for Take out, Delivery and Collection (making "VAT x%" rates for %s not in the list), rewrote published release snapshots the same way and set their content_hash to \'\' so rehashReleases() (backfillFirstReleases at API start) re-hashes them.'],
          ['pos_checks / pos_check_lines', 'Checks: revenue_stream_id (renamed), order_type_id, tent (customer name stays tab_name). Lines: revenue_stream_id (renamed), tax_rate_id next to vat_rate.'],
          ['orders, ordering_settings, deliveroo_settings', 'orders.order_type_id + revenue_stream_id; ordering_settings.order_type_ids { collection, delivery, eat_in } + revenue_stream_id (VAT defaults dropped); deliveroo_settings.order_type_id + revenue_stream_id.'],
          ['kds_orders.state, kds_flow_edges.targets, pos_print_routes', 'Kitchen orders: type = order type id, type_name, tent. Flow targets kind revenue_stream / order_type (an id). Print route target_kind revenue_stream.'],
        ]}
      />
      <H3>Resolving a rate (shared/tax.js)</H3>
      <P>
        <Mono>taxFor(levels, ctx, rates)</Mono> takes the levels <Mono>[dish, section, menu]</Mono> and the
        sale context <Mono>{'{ venue_id, order_type_id, revenue_stream_id }'}</Mono> and returns{' '}
        <Mono>{'{ tax_rate_id, vat_rate, name, from, rule }'}</Mono>. Level first: the first level whose
        setting gives a rate for the context wins (a matching exception, else its own rate); a blank level
        passes up; nothing anywhere = the default rate (<Mono>FALLBACK_PERCENT</Mono> 20 if a tenant has
        none). Within a setting the matching exception with the highest weight wins
        (<Mono>RULE_WEIGHTS</Mono>: streams 4, types 2, venues 1; a rule names venues or streams, not
        both). <Mono>taxProblems(tax, lookups)</Mono> refuses unknown ids, a rule with no rate, a stream
        of another location next to a venue, and two rules of the same weight that can match the same sale
        at different rates, so the winner is never ambiguous. <Mono>cleanTax()</Mono> normalises before
        saving (sorted, de-duplicated, empty = <Mono>{'{}'}</Mono>).
      </P>
      <H3>Where it is used</H3>
      <DataTable
        head={['Surface', 'How']}
        rows={[
          ['Till', 'tillConfig() sends revenue_streams (with order_types and prompts), order_types, tax_rates (values trimmed to the venue) and each item\'s tax levels (rules for other venues dropped by taxForVenue()). posTax(item, check, config) sets vat_rate + tax_rate_id on every line. check.order_type_set and check.stream_set carry a lines map { lineId: { vat_rate, tax_rate_id } } (rerateLines() in pos/src/lib/checkOps.js) that applyEvent() writes to the lines; check.tent_set sets the tent. Required prompts are enforced on the till at counter start, Send and Pay (missingDetails()).'],
          ['Online ordering', 'loadOrderingMenu() resolves each dish with orderContext(venueId, settings, fulfilment); createOrder() stores order_type_id and revenue_stream_id.'],
          ['Deliveroo file', 'loadDishes() resolves each dish for the settings\' order type (default: the type named Delivery) and stream; dishValues() writes dish.vat.'],
          ['Kitchen', 'headerFromCheck() / onlineSnapshot() put type, type_name and tent on the kitchen order; flow links can name order types and revenue streams (linkRank()); the kitchen screen\'s filter tabs are the tenant\'s types (kdsConfig().order_types).'],
          ['Reports', 'dayFigures() adds revenue_streams and order_types [{ id, checks, net, total }]; GET /api/pos/venues/:id/days/:dayId names them (names.revenue_streams / order_types / tax_rates); the checks list joins order_type_name and tent; GET /api/pos/checks/:id returns names for its events. Z tickets print both.'],
          ['Admin', 'components/menus/TaxBox.jsx (menu Settings, SectionDrawer, ItemDrawer; useTaxLookups() = GET /api/tax-rates), pages/MenuTax.jsx (/menus/tax: rates + Check), components/pos/OrderTypesSection.jsx and RevenueStreamsSection.jsx (Store tech tabs types and streams), OrderingSettings.jsx and MenuDeliveroo.jsx selects, KitchenFlow.jsx chips.'],
          ['AI menu tools', 'New sections and dishes carry tax; update_section takes tax_rate (a rate name) and sets the section\'s rate.'],
        ]}
      />
      <H3>API</H3>
      <DataTable
        head={['Route', 'Notes']}
        rows={[
          ['GET /api/tax-rates', '{ rates (with values), venues, order_types, streams }: what a tax setting may name. Open to readers (menus pages, Tax box).'],
          ['POST / PATCH / DELETE /api/tax-rates[/:id], PUT /api/tax-rates/order, PUT /api/tax-rates/:id/values', 'Menus manage. PATCH takes name, rate, is_default (moves the default), is_active. DELETE archives; refused for the default and for a rate a draft menu uses (names the menus). values: { venueId: % | null }.'],
          ['GET /api/tax-rates/check?venue_id&stream_id&menu_id', 'Every draft dish\'s rate per active order type in that context (the Check card).'],
          ['GET / POST / PATCH / DELETE /api/order-types[/:id], PUT /api/order-types/order', 'Changes need pos_setup or web_ordering_setup manage. DELETE archives, keeps at least one active, clears stream defaults pointing at it; its charge rules stay (an archived type is offered nowhere, so they put nothing on checks; a location\'s Charges matrix shows a rule left on one as order type removed, to take off). Order types carry no charges since migration 231 (Store tech → Charges); a charges key in the body is ignored.'],
          ['POST /api/pos/venues/:id/revenue-streams, PATCH / DELETE /api/pos/revenue-streams/:id, PUT /api/pos/venues/:id/revenue-streams/order', 'Body: name, menu_ids, colour, is_active, default_order_type_id, order_types [{ order_type_id, enabled, ask_name, ask_tent }], covers off | ask | must, courses (migration 231). A new stream offers every active type. The default must be an enabled type (422). DELETE archives a stream with sales.'],
          ['GET / POST /api/pos/charges, PATCH / DELETE /api/pos/charges/:id, PUT /api/pos/charges/order, GET /api/pos/charges/catalog, GET / PUT /api/pos/venues/:venueId/charge-rules', 'Migration 231: the company\'s till charges and each venue\'s matrix. Charge body: name, kind percent | amount, value (percent to 50, two decimals; amount in whole pence to 100000), optional, min_covers, tax_rate_id, basis check | dishes, per check | dish, item_ids, section_ids. Rules body: { rules: [{ charge_id, revenue_stream_id, order_type_id }] }, the whole matrix. Store tech view to read, manage to change; at most 40 charges. Changes tell the tills (config).'],
          ['GET / POST /api/pos/discounts, PATCH / DELETE /api/pos/discounts/:id, PUT /api/pos/discounts/order', 'Migration 225: the company\'s till discounts. Body: name, kind percent | amount, value (percent to 100, two decimals; amount in whole pence to 100000), scope any | check | line, needs_manager. Store tech view to read, manage to change; at most 50. Changes tell the tills (config).'],
        ]}
      />
      <InfoBox type="info">
        Every tax-rate, order-type and stream query filters <Mono>tenant_id</Mono>; ids in a tax setting are
        checked to be the tenant&apos;s (<Mono>checkMenuTax()</Mono> on every menu save). Setup changes push{' '}
        <Mono>pos.config</Mono> to the tills (<Mono>notifyTillsOnWrite</Mono> on the tax routes).
      </InfoBox>
    </section>
  )
}
