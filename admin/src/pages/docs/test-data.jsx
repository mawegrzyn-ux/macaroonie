// src/pages/docs/test-data.jsx
// The Docs page's "Test Data Tools" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'test-data'
export const label = 'Test Data Tools'
export const order = 470

// ── DEPLOYMENT ──────────────────────────────────
export function Section() {
  return (
    <section id="test-data" data-doc="">
      <H2>Test data tools</H2>
      <P>
        Pre-prod QA tooling on the Test data page, routes in <Mono>routes/testData.js</Mono>
        (mounted at <Mono>/api/venues</Mono>, all gated by <Mono>test_data</Mono> manage).
        Bookings: <Mono>POST /:venueId/test-data/seed</Mono> and <Mono>/clear</Mono>.
        Health &amp; safety logs (migration 139): <Mono>services/hsTestDataSvc.js</Mono>.
        Till sales (migration 245): <Mono>services/tillSalesGen.js</Mono> (one day, pure) and
        <Mono> services/tillTestDataSvc.js</Mono> (plan, store, clear); see Till sales below.
      </P>
      <DataTable
        head={['Route', 'Body', 'Notes']}
        rows={[
          ['POST /:venueId/test-data/hs/generate', 'date_from, date_to, kinds[], issue_pct (0-30), skip_closed, checklist_template_ids (null = all), dry_run', 'date_to may not be after the venue local today; at most 366 days. Returns counts per kind, days_filled, out_of_range, checklists_completed_existing and notes (e.g. no hold stations set up).'],
          ['POST /:venueId/test-data/hs/clear', 'date_from, date_to, kinds[], dry_run, confirm', 'Deletes rows with is_generated = true only. confirm: true required unless dry_run.'],
          ['POST /:venueId/test-data/till/generate', 'date_from, date_to, per_day (1-1000), skip_closed (default true), seed (40 chars), dry_run', 'date_to before the trading day open now (businessDate() with the venue\'s day_starts_at, so a real till never opens a day on a test day\'s date; tillRangeProblem(): 31 days a request, 1,100 days back at most; 422 code range); more than 10,000 orders = 422 code too_many; no priced dish = 422 no_dishes; no till staff = 422 no_staff. Returns days, orders, closed_days, real_days, replaced { days, checks }, left_out, refused (first 20) and refused_count.'],
          ['POST /:venueId/test-data/till/clear', 'date_from, date_to or all, dry_run, confirm', 'Deletes pos_days and pos_checks with is_generated only (their lines, payments, discounts, charges and VAT rows go with them). confirm: true required unless dry_run. Returns { days, checks }.'],
        ]}
      />
      <H3>Till sales</H3>
      <P>
        <Mono>generateDay({'{'} config, date, dayId, staff, count, seed {'}'})</Mono> in
        <Mono> services/tillSalesGen.js</Mono> makes one trading day the way the till makes
        it: every change is a till event run through <Mono>applyEvent()</Mono>
        (<Mono>shared/pos/checks.js</Mono>) with the venue's settings, priced by
        <Mono> priceItem()</Mono> with the venue's own till config (<Mono>tillConfig()</Mono>,
        so its menus on at each hour, prices, order types, the charges matrix, the discounts
        list), with automatic offers from <Mono>checkOffers(..., {'{'} at {'}'})</Mono> and the
        promotions as they could have been on those days. Numbers come from each till's and
        kiosk's own range (<Mono>nextNumbers()</Mono>); approvals from the venue's real roles
        (someone whose role can't void gets a manager's PIN, as on the till). A table in a
        floor area with its own revenue stream sells in that stream, and a dish's course goes
        on its line only where the till or its stream uses courses (<Mono>coursesFor()</Mono>).
        The day's figures are <Mono>dayFigures()</Mono> of its checks, as a Z makes them.
        A table party sits at a free table big enough for it, and the table is free again
        <Mono> TABLE_TURN_MS</Mono> (5 minutes) after that party's bill is paid or the order
        cancelled; every event's time is held inside the trading day (<Mono>clamp()</Mono>).
        A venue with no till gets two stand-ins (<Mono>id</Mono> null, so their checks have
        no <Mono>opened_device_id</Mono>): T1 at the counter with order numbers, T2 at
        tables. Random numbers come from <Mono>seededRandom()</Mono> keyed by seed, venue and date,
        and <Mono>dayCount()</Mono> sets each day's orders (weekday, month, ±15%), so the same
        request makes the same sales (ids apart). An order the rules refuse is left out and
        said in <Mono>refused</Mono> (code <Mono>error</Mono> for an unexpected fault).
      </P>
      <P>
        <Mono>generateTillSales()</Mono> takes a per-venue advisory lock
        (<Mono>pos-test:</Mono> + venue id), leaves out dates with a real trading day and,
        with <Mono>skip_closed</Mono>, dates <Mono>openDatesOrNull()</Mono> says are closed,
        gives each day the staff still working then (nobody after their
        <Mono> cash_staff.left_on</Mono>), deletes the test days already in the range and
        inserts the days
        (<Mono>pos_days.is_generated</Mono>, <Mono>z_number</Mono> null, closed) and every
        check's rows through <Mono>projectionRows()</Mono> (<Mono>services/posSvc.js</Mono>,
        the sequencer's own projection: <Mono>proj_v</Mono> = <Mono>CHECK_BREAKDOWNS_V</Mono>,
        <Mono>last_seq</Mono> 0, <Mono>is_generated</Mono>). No events, kitchen orders, print
        jobs, loyalty or card machine payments are made. The page asks a few weeks at a time
        (<Mono>tillChunks()</Mono> in <Mono>TestData.jsx</Mono>: at most 31 days and about
        8,000 orders a request).
      </P>
      <P>
        Generated rows stay out of real trading: the sequencer's <Mono>loadChecks()</Mono>,
        the device routes <Mono>/pos-api/checks</Mono>, <Mono>/checks/:id</Mono> and
        <Mono> /days</Mono> say <Mono>NOT is_generated</Mono>; device and hub syncs never
        carry them (closed, <Mono>last_seq</Mono> 0, not on the open day);
        <Mono> fillReconFromDay()</Mono> refuses a test day (422 code <Mono>test_day</Mono>);
        Till reports' days list and day detail carry <Mono>is_generated</Mono> and the page
        marks them. The report catalogue skips the column on purpose
        (<Mono>till.days</Mono>, <Mono>till.checks</Mono>): reports read test sales like real
        ones. Tests: <Mono>api/test/till-test-data.test.mjs</Mono>; the fixtures make and
        clear a few days so the tenant sweep replays both routes.
      </P>
      <H3>What each kind writes</H3>
      <DataTable
        head={['Kind', 'Table', 'Rule']}
        rows={[
          ['temps', 'fs_temp_logs', 'Per active equipment x active fs_capture_times (one 09:00 reading a day when there are none). Cold units: up to 1.5°C below max; hot: 1.5-13.5°C above min; defaults by type when a limit is missing. is_within_range from the row limits, as POST /temp-logs does.'],
          ['holds', 'fs_hold_checks', 'Per active station x fs_hold_capture_times, same value rule.'],
          ['cooking', 'fs_cooking_checks', 'Per session: required_items_count minus checks already logged (a fresh session sometimes gets one extra). Dishes from loadCookingPicker() (services/cookingItems.js), the same list the cooking picker shows: menus, the venue\'s own list or both. Core 76-92°C.'],
          ['orders', 'purchase_orders + purchase_order_lines', 'Items on the venue\'s active order lists, each on its chooseQuote() pick, grouped by supplier; one PO per supplier per delivery day (venue override first; suppliers without delivery days are skipped), 60-85% of that supplier\'s items, qty = par packs x 0.7-1.3 (else 1-4), fitQty(). Status received (sent when deliveries are not generated), numbers continue the tenant\'s sequence.'],
          ['deliveries', 'fs_delivery_checks', 'One per received purchase order in range with no check yet (purchase_order_id, unique). vendor_name = supplier; items jsonb = the lines that arrived with temp_c by storage; chilled 1-5°C, frozen -22 to -18°C, product_temp_c = chilled else frozen.'],
          ['checklists', 'checklist_instances + checklist_instance_items', 'Every period the range touches (daily skips closed days), status completed, all active items ticked, completed_at on the last day of the period in range. An in_progress instance is completed and ticked but keeps is_generated = false.'],
        ]}
      />
      <P>
        <Mono>issue_pct</Mono> moves that share of readings 0.5-3°C past the limit that
        matters (or a core temp of 68-74.5°C, or a warm delivery, which is then not
        accepted) and writes a corrective action. Existing readings are never overwritten:
        slots with a row are skipped. <Mono>recorded_by</Mono> is a random active
        <Mono>cash_staff</Mono> name for the venue, else the caller email. Times are
        venue local (<Mono>zonedToUtc()</Mono>). Rows are bulk inserted in chunks of 500
        inside the request transaction; dry_run builds the same rows and inserts nothing,
        so its counts are exact except for the random extra cooking check.
      </P>
    </section>
  )
}
