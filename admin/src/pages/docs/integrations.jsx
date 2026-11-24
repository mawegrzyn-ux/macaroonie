// src/pages/docs/integrations.jsx
// The Docs page's "Integrations" section: sales from other tills, phase 1
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
        Phase 1 of the sales import (migrations 288 to 291, 24 Nov 2026; plan in{' '}
        <Mono>docs/SALES_IMPORT.md</Mono>). Pipeline:{' '}
        <Mono>connector -&gt; raw store -&gt; normalised sales + master data</Mono>; mapping (phase 2),
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
          ['ext_check_lines', 'Item lines and their modifiers (parent_line_id); line_kind; external refs (item, variant, option, SKU); names as sold; qty, unit price, gross, discount, tax, net, cost in pence; note. An item line\'s money includes its modifiers (as Loyverse records it): add up item lines only. item_id / option_id / combo_id / rule_id / allocated_net_pence are for the mapping (phase 2).'],
          ['ext_check_payments / ext_check_discounts / ext_check_taxes', 'Tenders as named (card brand only from the card details); discounts and taxes on the check (line_id null) or a line, tax type INCLUDED | ADDED.'],
          ['ext_catalog', 'Master data, one row per external object: item, variant (option values, SKU, per-store prices), modifier, modifier_option, category, tax, discount, payment_type, store, employee, pos_device, dining_option.'],
        ]}
      />
      <P>
        Every new table has <Mono>tenant_id</Mono> with RLS forced and the standard policy. Report
        decisions: <Mono>ext_documents</Mono> left out (raw copies), the normalised tables planned
        (phase 4 subjects), <Mono>pos_connections</Mono> secrets, <Mono>pos_connection_venues</Mono> settings.
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
        ]}
      />
      <InfoBox>
        Loyverse field names come from what the Cash Recon fill already reads and the plan&apos;s section 2;
        Loyverse&apos;s documentation site couldn&apos;t be reached when this was built, so updated_at_min,
        show_deleted, /dining_options and POST /webhooks are as remembered and want checking against a real
        account (outstanding item 47). Tests: api/test/sales-import.test.mjs against the stand-in
        api/test/support/fake-loyverse.mjs, which the cash fixtures also sync from.
      </InfoBox>
    </section>
  )
}
