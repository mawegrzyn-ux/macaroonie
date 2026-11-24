// src/pages/docs/integrations.jsx
// The Docs page's "Integrations" section: sales from other tills, phases 1 and 2
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
        Phases 1 and 2 of the sales import (migrations 288 to 292, 24 Nov 2026; plan in{' '}
        <Mono>docs/SALES_IMPORT.md</Mono>). Pipeline:{' '}
        <Mono>connector -&gt; raw store -&gt; normalised sales + master data -&gt; mapping</Mono>;
        suggestions (3) and the readers (4: "every till" report subjects, Cash Recon from stored checks)
        are still to come, so Cash Recon&apos;s Loyverse fill reads <Mono>/receipts</Mono> live as before.
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
        decisions: <Mono>ext_documents</Mono> left out (raw copies), the normalised tables and{' '}
        <Mono>ext_line_parts</Mono> planned (phase 4 subjects), <Mono>pos_connections</Mono> secrets,{' '}
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
      <InfoBox>
        Loyverse field names come from what the Cash Recon fill already reads and the plan&apos;s section 2;
        Loyverse&apos;s documentation site couldn&apos;t be reached when this was built, so updated_at_min,
        show_deleted, /dining_options and POST /webhooks are as remembered and want checking against a real
        account (outstanding item 47). Tests: api/test/sales-import.test.mjs and
        api/test/sales-mapping.test.mjs against the stand-in api/test/support/fake-loyverse.mjs, which
        the cash fixtures also sync from (with two mapping rules); shared/test/itemMapping.test.mjs. Phase 3:
        api/test/sales-suggest.test.mjs (with the stand-in model, support/fake-claude.mjs),
        shared/test/itemMatch.test.mjs, shared/test/itemMappingPatterns.test.mjs.
      </InfoBox>
    </section>
  )
}
