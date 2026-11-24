// src/pages/docs/integrations.jsx
// The Docs page's "Integrations" section: sales from other tills, phases 1 to 5
// (docs/SALES_IMPORT.md). Docs.jsx gathers every file in this folder (except
// parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'integrations'
export const label = 'Integrations (sales from other tills)'
export const order = 145

export function Section() {
  return (
    <section id="integrations" data-doc="">
      <H2>Integrations: sales from other tills</H2>
      <P>
        Phases 1 to 5 of the sales import (migrations 288 to 294, 24 Nov 2026; plan in{' '}
        <Mono>docs/SALES_IMPORT.md</Mono>). Pipeline:{' '}
        <Mono>connector -&gt; raw store -&gt; normalised sales + master data -&gt; mapping -&gt; readers</Mono>.
        Since phase 4 (no migration) nothing reads Loyverse&apos;s <Mono>/receipts</Mono> but the sync:
        Cash Recon, reports, Today and Pepper read the stored sales (see Readers below).
      </P>
      <H3>Tables</H3>
      <DataTable
        head={['Table', 'What it holds']}
        rows={[
          ['pos_connections', 'Was loyverse_connections (288, renamed in place). system (loyverse; square, simphony later), sealed access_token (vault SEALED), status active | paused | error, last_sync_at / last_sync_ok_at / last_sync_error / last_sync_counts, sync_requested_at, sync_claimed_until (one process at a time), sales_synced_to and catalog_synced_to (the catch-up high-water marks), webhook_token_hash (sha256) + hint, webhook_id (Loyverse\'s), webhook_last_at.'],
          ['pos_connection_venues', 'Was loyverse_venue_links. location_id / location_name (the Loyverse store; unique per connection), day_starts_at, the Cash Recon mappings, and the history import: history_from / history_to (13 months), history_next_from, history_cursor, history_count, history_done_at.'],
          ['ext_documents', 'The raw store (289): every document as received with personal data stripped, unique (connection, kind, external id), sha256 hash (an unchanged copy is not normalised again), fetched_at; kept 400 days after the last fetch (RAW_KEEP_DAYS, cleared by the sync job).'],
          ['ext_checks', 'One per receipt (290): venue, business_date (businessDate() in shared/pos/reports.js with the link\'s day_starts_at, from receipt_date), kind sale | refund, refund_for_ref + refund_for_id, cancelled / cancelled_at, order type, device / employee / customer as external refs only, gross / discount / charge / tax / tip / total in pence.'],
          ['ext_check_lines', 'Item lines and their modifiers (parent_line_id); line_kind; external refs (item, variant, option, SKU); names as sold; qty, unit price, gross, discount, tax, net, cost in pence; note. An item line\'s money includes its modifiers (as Loyverse records it): add up item lines only. Mapped columns (292): map_state mapped | ignored | kept | note | in_combo | unmapped, rule_id (references ext_map_rules, set null on delete), item_id (the dish), combo_id, option_id (a modifier line mapped to an option), allocated_net_pence (the main part\'s share on an item line, the modifier\'s share on a modifier line). Dish, option and combo ids are plain ids: a menu save re-inserts its dishes.'],
          ['ext_check_payments / ext_check_discounts / ext_check_taxes', 'Tenders as named (card brand only from the card details); discounts and taxes on the check (line_id null) or a line, tax type INCLUDED | ADDED.'],
          ['ext_catalog', 'Master data, one row per external object: item, variant (option values, SKU, per-store prices), modifier, modifier_option, category, tax, discount, payment_type, store, employee, pos_device, dining_option.'],
          ['ext_map_rules', 'The item mapping (292). connection_id, venue_id (null = every venue on the connection), kind exact | combination | axis | ignore | keep; the match: item_ref, variant_ref, option_ref, option_refs (combination), axis_kind variant | modifier, axis_name, axis_group_ref, axis_values [{ from, option_id }]; the target: target_item_id, target_item_ids (a bundle), target_option_ids, target_combo_id, target_group_id; ext_sku / ext_name (the fallback when the other till makes an item again under a new id), match_key (ruleKey(): unique per connection, venue and match), effective_from, note, created_by.'],
          ['ext_line_parts', 'What each mapped item line became (292): part_no, role main | option | dish, item_id / option_id / combo_id, rule_id, source_line_id (the modifier line a part came from), qty, net_pence. The parts of a line add up to its net_pence exactly; replaced whenever the line is mapped.'],
        ]}
      />
      <P>
        Every new table has <Mono>tenant_id</Mono> with RLS forced and the standard policy. Report
        decisions: <Mono>ext_documents</Mono> left out (raw copies); <Mono>ext_checks</Mono>,{' '}
        <Mono>ext_check_lines</Mono>, <Mono>ext_line_parts</Mono>, <Mono>ext_check_payments</Mono> and{' '}
        <Mono>pos_connections</Mono> (its system only) read by the sales.* subjects;{' '}
        <Mono>ext_check_discounts</Mono>, <Mono>ext_check_taxes</Mono> and <Mono>ext_catalog</Mono> planned;{' '}
        <Mono>pos_connection_venues</Mono> and <Mono>ext_map_rules</Mono> settings.{' '}
        <Mono>pos_connections.remap_from</Mono> / <Mono>remap_requested_at</Mono> (292) mark a re-map waiting.
      </P>
      <H3>Item mapping (phase 2)</H3>
      <P>
        The rule is <Mono>shared/itemMapping.js</Mono>: <Mono>mapCheck(check, rules, ctx)</Mono> decides
        every line of one check and returns, per line, its state, rule, dish, option, combo, allocated net
        and (item lines) its parts. Order: a ref match beats the SKU / name fallback; then venue before
        connection; then combination, exact variant, exact item; then the later effective_from. Ignore and
        keep match as exact rules. Once the dish is known, variant axis rules add options from the
        variant&apos;s option values and modifier axis rules map modifier options, for groups the dish has
        no option for yet; a modifier with no rule is a note; a combination&apos;s modifiers are in_combo.{' '}
        <Mono>catalogContext()</Mono> (axes, values, option groups and the refs still on the till, from{' '}
        <Mono>ext_catalog</Mono>), <Mono>ourContext()</Mono> (list prices, a dish&apos;s own option prices from{' '}
        <Mono>menu_item_variant_prices</Mono>), <Mono>catalogState()</Mono> (one catalogue entry&apos;s state for
        the page, through mapCheck), <Mono>ruleKey()</Mono>. Money: <Mono>allocateNet(net, weights)</Mono> in{' '}
        <Mono>shared/externalSales.js</Mono> spreads an item line&apos;s net (which holds its modifiers&apos;)
        over its parts by our list prices, each other part rounded toward zero and the remainder on the
        main part, so they add up exactly (combos.js spreadPence() puts its remainder on the largest
        fractions instead). Money columns never change.
      </P>
      <P>
        <Mono>services/itemMappingSvc.js</Mono>: <Mono>mappingContext()</Mono>, <Mono>mapChecks()</Mono>{' '}
        (one UPDATE from jsonb_to_recordset for the lines, parts deleted and inserted),{' '}
        <Mono>requestRemap()</Mono> (marks remap_from, the earliest asked wins) and <Mono>queueRemap()</Mono>{' '}
        (a remap job on the sales-sync queue, added after the transaction, never awaited),{' '}
        <Mono>remapConnection()</Mono> (checks from remap_from in batches of 400, each holding the
        connection&apos;s row; clears the mark only when no newer ask came in), <Mono>sweepRemaps()</Mono>{' '}
        (from <Mono>sweepDue()</Mono>, every minute), <Mono>previewMapping()</Mono>, <Mono>coverage()</Mono>,{' '}
        <Mono>venueMenus()</Mono> (the group&apos;s shared menus and the venue&apos;s own). The sync maps each
        page&apos;s new or changed checks in the same transaction (<Mono>savePage()</Mono>).
      </P>
      <H3>Connector</H3>
      <P>
        <Mono>api/src/services/connectors/loyverse.js</Mono>: <Mono>connector({'{ token }'})</Mono> gives{' '}
        <Mono>listLocations()</Mono>, <Mono>fetchCatalog(since)</Mono> (items with variants split out,
        modifiers, the short lists; a list Loyverse answers 404 for is skipped),{' '}
        <Mono>fetchSales({'{ from, to, by, locationId, cursor }'})</Mono> (one page; by created for history,
        by updated for the catch-up), <Mono>registerWebhook(url)</Mono> / <Mono>deleteWebhook(id)</Mono>;
        plus <Mono>verifyWebhook()</Mono>, <Mono>normalise(doc, venue)</Mono> and <Mono>catalogRows(doc)</Mono>.
        Requests are paced (<Mono>timing.paceMs</Mono>) and a 429 waits (Retry-After, else doubling) and
        tries again. Personal data goes before anything is stored: <Mono>stripPersonal()</Mono> in{' '}
        <Mono>shared/externalSales.js</Mono> (customer objects, names, emails, phones, addresses) and, for
        receipts, the ticket name (<Mono>order</Mono>), the receipt note and the card details but the brand.
        Money is <Mono>toPence()</Mono> (from the digits, never a float multiply), the one rule
        shared with <Mono>shared/loyverse.js</Mono>.
      </P>
      <H3>Sync</H3>
      <P>
        <Mono>services/salesImportSvc.js</Mono> <Mono>syncConnection()</Mono>: claims the connection
        (<Mono>sync_claimed_until</Mono>, so one process at a time), reads master data changed since{' '}
        <Mono>catalog_synced_to</Mono>, receipts updated since <Mono>sales_synced_to</Mono> less 5 minutes
        (every store), then each linked venue&apos;s history in 31-day windows by created time, saving the
        cursor after every page (resumable). Each page: raw copies upserted (<Mono>storeDocuments()</Mono>),
        then the new, changed or not yet normalised receipts of linked stores written by{' '}
        <Mono>saveSale()</Mono> (check upserted by connection and external id, children replaced, refunds
        linked both ways). A run stops starting history pages after 4 minutes and queues the next.
      </P>
      <DataTable
        head={['Trigger', 'What happens']}
        rows={[
          ['The sales-sync job', 'api/src/jobs/sales-sync.js, every minute: sweepDue() (system mode only to find connections) syncs each one whose last run is 15 minutes old, that was asked for, or has history left; also clears raw copies older than 400 days. On the Platform Status as "Sales from other tills".'],
          ['A sync job', 'requestSync() adds a "sync" job (jobId per connection, never awaited in a request); sync_requested_at is also set, so the sweep catches it if Redis lost the add.'],
          ['POST /webhooks/loyverse/:token', 'Registered with Loyverse on connecting (receipts.update) or pasted from the page. The token\'s sha256 finds the connection (system mode), compared in constant time; the body is never read; it only asks for a sync. 404 for an unknown token.'],
          ['Linking a venue', 'PUT /api/loyverse/venues/:id/link with a new store starts its history (startHistory()) and a sync.'],
        ]}
      />
      <H3>Routes</H3>
      <DataTable
        head={['Route', 'What it does']}
        rows={[
          ['GET /api/integrations/connections', 'Every connection with sync state, late flag (syncLate()), webhook state, catalogue counts, and its venues with history progress (historyProgress()) and checks kept. Cash reconciliation view.'],
          ['POST /api/integrations/connections/:id/sync', 'Sync now: marks and queues. Manage.'],
          ['POST /api/integrations/connections/:id/venues/:venueId/history', 'Starts the venue\'s history again. Manage.'],
          ['POST /api/integrations/connections/:id/webhook', 'A new token and address, registered with Loyverse when it allows (the old registration removed); returns { url, registered, error }, the only time the address is shown. Owner/admin + Manage.'],
          ['PATCH /api/integrations/connections/:id', '{ status: active | paused }. Owner/admin + Manage.'],
          ['POST/PATCH/DELETE /api/loyverse/connections', 'The account (unchanged, now on pos_connections). Creating one also sets up the webhook and a first sync; deleting it removes Loyverse\'s webhook and, by cascade, every ext_* row.'],
          ['PUT /api/loyverse/venues/:id/link', '{ connection_id, store_id, day_starts_at }: the store link only; the mapping is kept.'],
          ['PUT /api/loyverse/venues/:id/mappings', '{ mappings }: the Cash Recon mapping only (Cash Recon settings > Loyverse).'],
          ['GET /api/integrations/mapping/:connectionId?venue_id=', 'The catalogue (items with axes, variants with values; modifiers with options), each with its state at that scope today (catalogState()) and its last 30 days\' sales; the linked venues; the rules with their targets in words; remap_pending. View.'],
          ['GET /api/integrations/mapping/:connectionId/menu?venue_id=', 'The menus the venue sells (every menu without a venue): sections, dishes and combos with their option groups; the option group library. View.'],
          ['GET /api/integrations/mapping/:connectionId/coverage?venue_id=', 'Last 30 days, sales only, cancelled left out, item lines: total, mapped, kept, ignored, unmapped by venue and all; percent = (mapped + kept) / (total - ignored); the 50 unmapped items by value. Also on each connection in GET /connections as mapping { rules, percent }. View.'],
          ['POST /api/integrations/mapping/:connectionId/preview', '{ venue_id?, rules: [draft, with id to replace a saved one], remove: [ids] }: the saved rules with these changes, applied to the last 30 days\' lines beside the saved rules: before / after by state, by_target, changed and the first 100 changes. Writes nothing. View (each draft checked as a save is).'],
          ['POST /api/integrations/mapping/:connectionId/rules', 'A rule (cleanRule(): what each kind needs, refs in this connection\'s ext_catalog, the venue linked to the connection, dishes, combos, options and group the tenant\'s, a venue rule\'s dish on a menu it sells; effective_from defaults to the first stored day). 409 when the match already has a rule at that scope. Marks and queues a re-map. Manage.'],
          ['PUT / DELETE /api/integrations/mapping/:connectionId/rules/:ruleId', 'The whole rule / removes it; re-maps from the earlier of the old and new effective_from. Manage.'],
          ['GET /api/integrations/mapping/:connectionId/suggestions?venue_id=', 'Phase 3. openThings() (items with one variant, each variant of the others, modifier options; unmapped, only in a bucket, or a note) matched by matchThing() (shared/itemMatch.js) against venueOurs() (the venue\'s menus only): codes first (menu_items.sku / barcode and menu_item_option_codes), then nameScore() with a variant\'s values matched to the dish\'s own options, price and category breaking ties; each with score, reason, the rule it would save (ruleFor()) and up to two others; auto when at or above AUTO_MATCH (0.9) and not tied. Writes nothing. View.'],
          ['POST /api/integrations/mapping/:connectionId/rules/bulk', '{ rules: [rule] } (up to 200): saveRules(), each through cleanRule() and saveRule() in a savepoint of its own (one refused rule reported, the others saved), one re-map from the earliest day. Returns { saved, failed, offers }: offers are learnOffers() (shared/itemMapping.js). Manage.'],
          ['POST /api/ai/sales-mapping/:connectionId/propose', '{ venue_id, keys? }: Pepper\'s proposals (services/itemMappingAi.js proposeMappings()): one askForJson() call (use item_mapping, two system parts, so two cache marks) for up to 40 open things without a ticked suggestion; refs E (their items, variants, modifier groups and options), D (dishes and combos on the venue\'s menus), G / O (groups, options); names inside <our_menu> / <their_items> as data, angle brackets taken out. toRule() maps refs back and drops an unknown ref or kind, two options of one group, an option not on the dish; then cleanRule() (read only) drops what a save would refuse. Returns { proposals, dropped, couldnt, asked }; nothing saved. Cash reconciliation manage + Pepper view; pepperOn().'],
          ['POST /api/integrations/mapping/:connectionId/create-dishes', '{ venue_id, section_id, keys }: services/itemMappingMake.js createMissing(). The section must be on a menu the venue sells; things still open; a dish of the same name in the section is skipped. New option groups (price_mode extra) through POST /api/menus/variant-groups, then GET /api/menus/:id, menuSaveBody() (shared/menuSave.js) with the new dishes added to the section and the whole-tree PATCH, all in-process as the person (callApi()); then exact rules (variant -> dish + option) through saveRules(). Dish price = the lowest variant price at the venue\'s store; each option\'s per-dish price = the difference. Cash reconciliation manage + Menus manage (and the menus routes check again).'],
          ['POST /api/integrations/mapping/:connectionId/copy-preview, /copy', '{ from_venue_id, to_venue_id } (both linked to the connection, not the same): copyPlan() takes the source venue\'s own rules, keeps a target the other venue already sells and re-points the rest by normalised name (a dish: one on the venue\'s own menu first; an option: group name + label; a group; a section: title), skipping a rule whose match the venue already has. Preview: { copy, unmatched (with why), existing }, View. Copy works the plan out again and saves it through saveRules(); Manage.'],
        ]}
      />
      <H3>Pattern rules and learning (phase 3, migration 293)</H3>
      <P>
        <Mono>ext_map_rules.kind</Mono> gains <Mono>pattern</Mono> (<Mono>pattern_field</Mono> code | name |
        category, <Mono>pattern_op</Mono> equals | starts_with | contains, <Mono>pattern_value</Mono>, and an
        exact rule&apos;s targets) and <Mono>bucket</Mono> (a category ref to <Mono>target_section_id</Mono>);
        <Mono> ext_check_lines</Mono> gains <Mono>section_id</Mono> and the state <Mono>bucket</Mono> (counted as
        decided in coverage). <Mono>mapCheck()</Mono> tries them only when no rule matches the line by ref or
        by its SKU / name fallback: code equals (the SKU or the variant&apos;s barcode), code starts with (longer
        first), name contains (on the sold name, longer first), category, bucket; a venue&apos;s before the
        connection&apos;s at each step. Axis rules still add options to a pattern&apos;s dish.{' '}
        <Mono>learnOffers(added, rules, catalog, optionInfo)</Mono>: LEARN_MIN (3) exact variant rules at one
        scope whose variants share a value of one variant option and whose targets hold the same option of ours
        give one axis rule per option name and scope (merged into an existing one: <Mono>replaces</Mono>); three
        exact rules to the same target whose SKUs share a prefix (2+), else a name word, else a category, give a
        pattern rule. Only groups holding a rule just added; never a rule that exists.
      </P>
      <H3>Readers (phase 4)</H3>
      <DataTable
        head={['Part', 'How it works']}
        rows={[
          ['The day figure rule', 'dayFiguresFromStored(checks, itemCategory) in shared/externalSales.js: a trading day\'s Cash Recon figures (sales, refund_receipts, gross_sales, refunds, discounts, taxes, tips, surcharges, total_collected, net_sales = gross - refunds - discounts; items, categories and payment_types by ref) from stored checks with their item lines and payments. Cancelled left out; a refund\'s amounts taken as positive and counted against its own day. It replaced summariseReceipts() (shared/loyverse.js), and api/test/sales-every-till.test.mjs holds it to that rule (kept in the test) on the stand-in\'s receipts.'],
          ['Synced or not', 'dayCovered(cover, { start, end }) in shared/externalSales.js: the catch-up (pos_connections.sales_synced_to) past the day\'s end and, for a day inside the 13 months the history import reads, the import past the day (history_next_from or history_done_at). A day older than the history is covered.'],
          ['services/storedSales.js', 'venueLink(tx, tenantId, venueId) (the link, its connection\'s system, sync marks and the venue\'s time zone) and storedDays(tx, tenantId, link, dates, { categories }) = { date: figures + checks, covered, not_synced } (not_synced: nothing stored and not covered). Categories for category terms come from ext_catalog items.'],
          ['Cash Recon fill', 'routes/loyverse.js preview / apply read storedDays(); no Loyverse call. Preview gives synced_to, last_sync_ok_at, connection_id and each day\'s synced. Apply never fills a not_synced day: 422 (NOT_SYNCED) when it is the only day asked, else skipped as not_synced (not_yet for a future day in a Retrieve). POST /api/loyverse/venues/:venueId/sync (Cash Recon use) marks the connection and queues a sync. The fill window (LoyverseFillModal) shows Not synced yet and Sync now; ReconFillModal takes fillable(day) and names skip reasons.'],
          ['GET /api/integrations/venues/:venueId/day?date=', 'Till reports view. { linked: false } or { linked, system, label, connection_name, location_name, currency, date (default: the latest stored day), synced, covered, synced_to, last_sync_ok_at, figures (pence: receipts, refund_receipts, gross_sales, refunds, discounts, net_sales, taxes, tips, surcharges, total_collected), payments [{ name, amount }], items [{ name, amount }] (top 20 by value) }. Another tenant\'s venue is refused.'],
          ['Pepper till_day', 'Reads the route above: a date with no trading day on our till but a linked other till answers from it (source "Loyverse (stored sales, synced to ...)", sales in Loyverse\'s terms, takings by payment type, top items by value, a note when not synced); our till\'s day gains other_till when the venue has both.'],
          ['Today', 'opsToday summary.sales (services/opsToday.js daySales(), for pos_reports view, which joins OPS_MODULES): { total_pence, currency, sources: [{ key, label, net_pence, synced }] } from our till\'s day figures (net) and the route above (Loyverse net sales, after refunds), read as the person with callApi. Home\'s Glance shows it as one chip.'],
          ['Report subjects', 'reports/catalogue/sales.js (area Till sales, module pos_reports, order 25): sales.checks, sales.dishes, sales.tenders, each a UNION ALL of our projections (pos_checks / pos_check_lines / pos_payments with pos_days for the trading day) and the stored sales, with source (SALE_SOURCES: macaroonie, loyverse, ...). Counted as our till counts: closed checks, receipts not cancelled; dishes of closed checks not voided; another till\'s refund receipts and refunded lines are rows of their own (kind refund), counted by Refunded, never taken off sales. sales.dishes: a mapped line is one row per ext_line_parts part (net = its share; gross and discount on the main part; an option part carries its dish\'s id and name, so a dish adds up with its options as on our till; qty_sold leaves option rows out), other item lines by their name as sold (soldName), bucket lines with their section_id, ignored lines not counted. Mapping coverage = mapped_value / other_till_sales by COVERAGE_DECIDED / COVERAGE_LEFT_OUT (shared/itemMapping.js; coverageShare() is the Item mapping page\'s). sales.tenders: another till\'s tip sits on the receipt\'s biggest payment (amount less the tip), a refund\'s amount positive.'],
        ]}
      />
      <H3>Square (phase 5, migration 294)</H3>
      <P>
        Square runs through the same pipeline: <Mono>salesImportSvc.js</Mono> picks the connector by{' '}
        <Mono>pos_connections.system</Mono> (<Mono>connectorFor()</Mono>), makes its client with{' '}
        <Mono>clientFor(conn)</Mono> (a connector&apos;s <Mono>prepare()</Mono> may renew an OAuth token
        first; the new tokens are sealed and stored), finds a sale&apos;s venue by{' '}
        <Mono>doc.location_id</Mono> and hands <Mono>normalise(doc, venue, refs)</Mono> what the stored
        catalogue knows (<Mono>saleRefs()</Mono>: a variation&apos;s item and SKU, a modifier&apos;s list
        name). The catch-up passes the linked locations (<Mono>locationIds</Mono>). Shared helpers
        moved to <Mono>connectors/common.js</Mono> (<Mono>ConnectorError</Mono>, <Mono>hashToken()</Mono>,{' '}
        <Mono>tokenMatches()</Mono>, <Mono>sameSecret()</Mono>).
      </P>
      <DataTable
        head={['Part', 'What it does']}
        rows={[
          ['connectors/square.js', 'connector({ token, environment }): merchant() (GET /v2/merchants/me, the token check), listLocations() (GET /v2/locations, inactive left out), fetchCatalog(since) (POST /v2/catalog/search for ITEM, ITEM_VARIATION, MODIFIER_LIST, MODIFIER, CATEGORY, TAX, DISCOUNT, deleted ones too when since is set; one copy per object; a lone changed MODIFIER reads its list again with batch-retrieve; the locations as store documents), fetchSales({ from, to, by, locationIds, cursor }) (POST /v2/orders/search, COMPLETED and CANCELED, date_time_filter and sort on created_at (history) or updated_at (catch-up), at most 10 locations a search, the group walked inside the cursor "<group>:<square cursor>"), registerWebhook(url) / deleteWebhook(id) (webhook subscriptions: order.created, order.updated, catalog.version.updated; the answer carries the signature key). Square-Version header SQUARE_VERSION; BASE_URLS production / sandbox (tests point both at the stand-in); 429 waits Retry-After, else doubling.'],
          ['normalise()', 'An ITEM_VARIATION is the sold thing: variant_ref = catalog_object_id, item_ref = its item from refs.variantItem. Money with moneyPence() (shared/externalSales.js: Square\'s Money is already in pence, never divided). Line net = gross_sales_money less total_discount_money (an added tax is not in it, an included one is, as Loyverse\'s). Modifiers are lines under their item; service charges are charge lines (no parent) and charge_pence; applied taxes and discounts per line plus the order\'s own; tax types ADDITIVE / INCLUSIVE stored as ADDED / INCLUDED. An order with returns[] and no line items is a refund check, refund_for = source_order_id, amounts from return_amounts, payments from refunds[] (name Refund). State CANCELED: cancelled, cancelled_at = updated_at. Tenders: payment_type_ref = the tender type (CARD, CASH, ...), amount includes the tip, card brand only.'],
          ['Personal data', 'saleDoc() drops ticket_name, metadata, each fulfilment\'s details (recipient, notes, addresses: only uid, type, state kept), a tender\'s note and every card field but the brand; stripPersonal() also takes recipient, email_address, buyer_email_address, shipping_address, billing_address, given_name, family_name, nickname anywhere. A location document drops its email, phone, address and links. The customer is customer_id only.'],
          ['catalogRows()', 'item (category from reporting_category / categories / category_id; attrs.option1_name "Variation" when it has more than one variation, so an axis rule can map them), variant (parent_ref the item, sku, price, attrs.option1_value its name, location overrides as stores), modifier (the list) + modifier_option rows, category, tax, discount, store.'],
          ['OAuth', 'oauthConfig() is null unless SQUARE_APPLICATION_ID and SQUARE_APPLICATION_SECRET are set (a sandbox app\'s id starts with "sandbox-"). signState() / readState(): base64url JSON { tenant, person, name, expiry 15 min, nonce } + HMAC-SHA256 with the app secret; refused when changed, expired, or for another tenant or person. authorizeUrl() (scopes MERCHANT_PROFILE_READ ITEMS_READ ORDERS_READ PAYMENTS_READ), obtainToken(), refreshToken(), revokeToken() (Authorization: Client <secret>), prepare() refreshes an OAuth token a week before token_expires_at, revoke() on disconnect.'],
          ['Webhook', 'verifyWebhook(): the address\'s token against its sha256, then, when the connection has webhook_signature_key, x-square-hmacsha256-signature = base64(HMAC-SHA256(key, notification URL + raw body)) in constant time. salesWebhookRoutes parses JSON as a Buffer (that plugin only) and loops over WEBHOOK_SYSTEMS. Still only a trigger.'],
        ]}
      />
      <DataTable
        head={['Route', 'What it does']}
        rows={[
          ['GET /api/square/oauth', 'Cash Recon view: { available, environment, redirect_url } (or { available: false }).'],
          ['POST /api/square/oauth/start', 'Owner/admin + Cash Recon manage: { name } -> { url } (Square\'s authorize page with the signed state).'],
          ['GET /api/square/oauth/callback', 'No sign-in (Square\'s redirect URL): only renames code and state (or error) onto /integrations as square_code / square_state / square_error and redirects. The admin\'s Auth0 provider takes any ?code=&state= as its own callback, which is why they can\'t land on the page directly.'],
          ['POST /api/square/oauth/finish', '{ code, state }: readState() must give this tenant and person (403 before Square is asked otherwise); ObtainToken; the merchant read; a new connection (auth_kind oauth) or new tokens on the tenant\'s connection for that merchant; webhook set up, first sync queued.'],
          ['POST /api/square/connections', '{ name, access_token, environment }: checked with merchant(), sealed; the same merchant twice by token is 409.'],
          ['PATCH /api/square/connections/:id', '{ access_token?, environment?, signature_key? (null clears) }.'],
          ['POST /api/square/connections/:id/test', 'Checks the stored token (renewing an OAuth one if due).'],
          ['PATCH /api/integrations/connections/:id', 'Now also { name } (any system).'],
          ['DELETE /api/integrations/connections/:id', 'disconnect(): webhook removed at the other till and revoke() where the connector has it (best effort), then the connection, its links and sales.'],
          ['GET /api/integrations/connections/:id/locations', 'The other till\'s locations, asked live with the connection\'s token.'],
          ['PUT / DELETE /api/integrations/connections/:id/venues/:venueId', '{ location_id, day_starts_at }: links a venue to one of the account\'s locations (checked live; one venue per location; a new or moved link starts the history; moving to another system clears the Cash Recon mapping). DELETE unlinks; sales kept stay.'],
          ['POST /webhooks/square/:token', 'Square\'s webhook (signed when the key is set).'],
        ]}
      />
      <P>
        pos_connections gains environment (production | sandbox), auth_kind (token | oauth), refresh_token and
        webhook_signature_key (both sealed: vault SEALED) with webhook_signature_hint, and token_expires_at; a unique
        index on (tenant, system, merchant_id) for Square. Cash Recon&apos;s fill stays Loyverse&apos;s:{' '}
        <Mono>reconLinks.js</Mono> and <Mono>reconRetrieve.js</Mono> now join <Mono>system = &apos;loyverse&apos;</Mono>,
        so a Square venue is not offered it. The every-till subjects, Today and till_day read Square&apos;s stored
        sales with Source Square unchanged. Tests: api/test/sales-square.test.mjs against
        api/test/support/fake-square.mjs. Square&apos;s developer site couldn&apos;t be reached when this was built: the
        field names are from API v2 as remembered (outstanding item 47).
      </P>
      <InfoBox>
        Loyverse field names come from what the Cash Recon fill already reads and the plan&apos;s section 2;
        Loyverse&apos;s documentation site couldn&apos;t be reached when this was built, so updated_at_min,
        show_deleted, /dining_options and POST /webhooks are as remembered and want checking against a real
        account (outstanding item 47). Tests: api/test/sales-import.test.mjs and
        api/test/sales-mapping.test.mjs against the stand-in api/test/support/fake-loyverse.mjs, which
        the cash fixtures also sync from (with two mapping rules); shared/test/itemMapping.test.mjs. Phase 3:
        api/test/sales-suggest.test.mjs (with the stand-in model, support/fake-claude.mjs),
        shared/test/itemMatch.test.mjs, shared/test/itemMappingPatterns.test.mjs. Phase 4:
        api/test/sales-every-till.test.mjs (the fixtures&apos; Loyverse sync beside two days of our till),
        shared/test/externalSales.test.mjs.
      </InfoBox>
    </section>
  )
}
