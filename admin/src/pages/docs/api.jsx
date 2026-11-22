// src/pages/docs/api.jsx
// The Docs page's "API Reference" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'api'
export const label = 'API Reference'
export const order = 120

// ── API REFERENCE ───────────────────────────────
export function Section() {
  return (
    <section id="api" data-doc="">
      <H2>API Reference</H2>

      <P>
        <strong>Errors.</strong> <Mono>errorHandler()</Mono> in <Mono>middleware/error.js</Mono>{' '}
        (set before the route plugins in <Mono>app.js</Mono>) answers every thrown error as{' '}
        <Mono>{'{ error, code?, errors? }'}</Mono>: <Mono>httpError(status, message)</Mono> as
        given, Zod 400 with <Mono>issues</Mono>, Postgres 23505 / 23P01 / 55P03 / 23503 as 409,
        and 22P02 (text that isn&apos;t a valid value for its type) as 404 "Not found" when it is
        a uuid (a malformed id in the address or body is a record that doesn&apos;t exist) else
        400. Anything else is a 500. Only 500s are logged as errors with the stack; a 4xx is one
        warn line (<Mono>Request refused</Mono> with the status, message and code), so refusals
        don&apos;t flood the error log.
      </P>
      <P>
        <strong>Where routes are registered.</strong> <Mono>app.js</Mono> keeps the plugins whose
        place matters: helmet, CORS, rate limits, multipart, JWT, views and static files, the error
        handler, the <Mono>onRoute</Mono> hook, the host sites (<Mono>platformSite</Mono>,{' '}
        <Mono>posSite</Mono>, <Mono>screenSite</Mono>, <Mono>installerSite</Mono>,{' '}
        <Mono>loyaltySite</Mono>: their global <Mono>onRequest</Mono> hooks come before every
        route), the payment webhooks and the tenant site renderer. Every feature route plugin is
        registered from its area&apos;s file, <Mono>api/src/areas/&lt;area&gt;.js</Mono>{' '}
        (<Mono>{"export const routes = [[plugin, { prefix }], ...]"}</Mono>, 22 Nov 2026), which{' '}
        <Mono>app.js</Mono> reads from the folder with a top-level await and registers after the
        rest, area by area in name order (Fastify matches by path, so the order doesn&apos;t
        matter). An area file never imports <Mono>app.js</Mono> or <Mono>server.js</Mono>.
      </P>

      <H3>Holds &amp; Bookings — <span className="font-mono font-normal text-sm">/api/bookings</span></H3>
      <DataTable
        head={['Method', 'Path', 'Min role', 'Description']}
        rows={[
          ['POST', '/holds', 'any', 'Create a hold. UNIQUE (table_id, starts_at) guards concurrent requests.'],
          ['DELETE', '/holds/:id', 'any', 'Release a hold immediately. Cancels attached Stripe PI.'],
          ['POST', '/', 'any', 'Make a booking from a staff hold. Staff bookings take no deposit, even at a deposit venue.'],
          ['GET', '/', 'any', 'List bookings — filter by venue_id, date, status. Returns member_table_ids for combos.'],
          ['GET', '/:id', 'any', 'Single booking detail.'],
          ['PATCH', '/:id/status', 'operator', 'Transition booking status.'],
          ['PATCH', '/:id/move', 'operator', 'Same-table time shift. Preserves actual booking duration.'],
          ['PATCH', '/:id/relocate', 'operator', 'Cross-table drag. Finds best allocation anchored to target table (single → combo → adjacency expansion). Applies allow_cross_section_combo, allow_non_adjacent_combo rules and disallowed_table_pairs. If adjacency expansion finds a multi-table set but no pre-configured combo exists, returns 422 — operator must create the combination first. Cascades conflicts to free tables or Unallocated. Returns { moved, displaced[] }.'],
          ['PATCH', '/:id/duration', 'operator', 'Resize — change ends_at independently of slot_duration_mins.'],
          ['PATCH', '/:id/guest', 'operator', 'Edit guest name, email, phone, covers.'],
          ['PATCH', '/:id/tables', 'operator', 'Reassign table or combination. Pass table_ids[] for ad-hoc multi-table; auto-creates combination if no exact match exists.'],
          ['PATCH', '/:id/notes', 'any', 'Update internal operator notes.'],
          ['POST', '/admin-override', 'operator', 'Create booking directly — bypasses slot resolver, capacity, booking-window, and cutoff checks. Accepts table_ids[] (empty = unallocated row, one = single table, many = auto-creates combination). Fires confirmation email + WS broadcast.'],
        ]}
      />

      <H3>Slots — <span className="font-mono font-normal text-sm">/api/slots</span></H3>
      <DataTable
        head={['Method', 'Path', 'Auth', 'Description']}
        rows={[
          ['GET', '/', 'public', 'Available slots for venue_id + date + covers. Returns table_id or combination_id per slot. Computed by PG function — never from a stored table. Widget calls (unauthenticated) automatically hide slots at/after venue doors_close_time when allow_widget_bookings_after_doors_close rule is off.'],
        ]}
      />

      <H3>Venues — <span className="font-mono font-normal text-sm">/api/venues</span></H3>
      <DataTable
        head={['Method', 'Path', 'Min role', 'Description']}
        rows={[
          ['GET', '/', 'any', 'List venues for tenant'],
          ['POST', '/', 'admin', 'Create venue'],
          ['PATCH', '/:id', 'admin', 'Update venue settings'],
          ['DELETE', '/:id', 'owner', 'Delete venue'],
          ['GET', '/:id/tables', 'any', 'List tables for venue (includes is_unallocated flag)'],
          ['POST', '/:id/tables', 'admin', 'Create table'],
          ['PATCH', '/:id/tables/reorder', 'admin', 'Set table sort order. Accepts { ids: [uuid,...] } — full ordered array. Sets sort_order = array index. Drives Timeline row order and smart-allocate adjacency.'],
          ['GET', '/:id/combinations', 'any', 'List table combinations with member table IDs'],
          ['POST', '/:id/combinations', 'admin', 'Create combination'],
          ['PATCH', '/:id/combinations/:cid', 'admin', 'Update combination name / covers'],
          ['DELETE', '/:id/combinations/:cid', 'admin', 'Delete combination'],
          ['GET | PATCH', '/:id/rules', 'any | admin', 'Get or update booking rules (includes allow_cross_section_combo, allow_non_adjacent_combo, enable_arrived_status flags)'],
          ['GET | PATCH', '/:id/deposit-rules', 'any | admin', 'Get or update deposit rules'],
          ['GET', '/:id/disallowed-pairs', 'any', 'List disallowed table pairs for smart allocation'],
          ['POST', '/:id/disallowed-pairs', 'admin', 'Add a disallowed pair { table_id_a, table_id_b }'],
          ['DELETE', '/:id/disallowed-pairs/:pid', 'admin', 'Remove a disallowed pair'],
        ]}
      />

      <H3>Schedules — <span className="font-mono font-normal text-sm">/api/venues/:id/schedule</span></H3>
      <DataTable
        head={['Method', 'Path', 'Min role', 'Description']}
        rows={[
          ['GET', '/', 'any', 'Full schedule (template + sittings + slot caps + overrides)'],
          ['GET', '/sittings-for-date', 'any', 'Returns the resolved sittings for a specific date (applying exceptions → overrides → weekly template priority). Each sitting includes name (nullable) for use in the stats bar and Timeline session-start lines.'],
          ['PUT', '/template/:dow', 'admin', 'Upsert day template. Accepts is_open, slot_interval_mins, doors_close_time.'],
          ['POST', '/sittings', 'admin', 'Create sitting'],
          ['PATCH', '/sittings/:id', 'admin', 'Update sitting. Accepts name (nullable string) to set the session label shown in the stats bar and Timeline header.'],
          ['DELETE', '/sittings/:id', 'admin', 'Delete sitting'],
          ['POST', '/caps', 'admin', 'Set slot cap override for a specific time'],
          ['POST', '/overrides', 'admin', 'Create date override (e.g. bank holiday closure)'],
          ['DELETE', '/overrides/:date', 'admin', 'Remove date override'],
          ['POST', '/copy-day', 'admin', 'Copy all sittings from source_dow to target_dow'],
          ['GET', '/:venueId/schedule/exceptions', 'any', 'List all exceptions with nested day templates, sittings, and caps'],
          ['POST', '/:venueId/schedule/exceptions', 'admin', 'Create exception (name, date_from, date_to, is_closed, priority)'],
          ['PATCH', '/:venueId/schedule/exceptions/:eid', 'admin', 'Update exception header'],
          ['DELETE', '/:venueId/schedule/exceptions/:eid', 'admin', 'Delete exception and all nested data'],
          ['PUT', '/:venueId/schedule/exceptions/:eid/template/:dow', 'admin', 'Upsert DOW template within exception'],
          ['POST', '/:venueId/schedule/exceptions/:eid/template/:dow/sittings', 'admin', 'Add sitting to exception DOW template'],
          ['PATCH', '/:venueId/schedule/exceptions/:eid/sittings/:sid', 'admin', 'Edit exception sitting'],
          ['DELETE', '/:venueId/schedule/exceptions/:eid/sittings/:sid', 'admin', 'Remove exception sitting'],
          ['PUT', '/:venueId/schedule/exceptions/:eid/sittings/:sid/caps', 'admin', 'Replace slot caps for exception sitting'],
        ]}
      />

      <H3>Payments — <span className="font-mono font-normal text-sm">/api/payments</span></H3>
      <DataTable
        head={['Method', 'Path', 'Auth', 'Description']}
        rows={[
          ['POST', '/:id/refund', 'owner / admin + bookings manage', "Refund a booking deposit: { amount_pence? } (left out = all that is left). 422 over what is left or already refunded. Returns { ok, status, refunded_pence }."],
        ]}
      />

      <H3>Booking deposits (migration 220)</H3>
      <P>
        Guests booking online at a venue whose <Mono>deposit_rules.requires_deposit</Mono> is on pay by card in the
        reservations widget, on the group&apos;s own Stripe account (Connect direct charge, no platform fee). The
        server never books on the browser&apos;s word: it reads the PaymentIntent back from Stripe. Staff bookings
        (<Mono>POST /api/bookings</Mono>, admin-override) take no deposit. The old platform-account flow
        (<Mono>services/paymentService.js</Mono>, <Mono>/api/payments/intent</Mono>, <Mono>/api/payments/webhook</Mono>,{' '}
        <Mono>STRIPE_WEBHOOK_SECRET</Mono>) is gone.
      </P>
      <DataTable
        head={['Piece', 'What it does']}
        rows={[
          ['GET /widget-api/venues/:id', "deposit: { required, online, type, amount_pence, currency, refund_hours_before } from depositPublic(); online = the group's Stripe account can take payments (depositsOnline())."],
          ['POST /widget-api/venues/:id/holds', 'At a deposit venue: 422 when Stripe isn\'t ready ("call them to book") or without an email (the receipt goes there); stores guest_notes on the hold.'],
          ['POST .../holds/:holdId/deposit', "startDeposit(): a PaymentIntent on the group's account (automatic_payment_methods, allow_redirects never, metadata kind deposit + hold, tenant, venue, receipt_email), reused while payable for the same amount; the hold gets stripe_pi_id, stripe_account, deposit_pence and lives at least DEPOSIT_HOLD_SECS (900). Returns client_secret, publishable_key, account, amount_pence, currency, expires_at. 410 hold gone."],
          ['POST .../holds/:holdId/deposit/confirm', "{ payment_intent }: confirmDeposit() reads it from Stripe (404 for another venue's), settleDeposit() books it. 201 booking (+ deposit_pence), 202 still processing (the widget asks again), 402 not paid, 409 { refunded: true } when it can't be booked."],
          ['POST .../holds/:holdId/confirm', '422 at a deposit venue: pay first.'],
          ['settleDeposit()', "Advisory lock per PaymentIntent, then: a payments row already there = booked (idempotent, never refunds); the hold locked FOR UPDATE and booked with confirm_hold(..., p_allow_expired true) (paid but expired still books if the table is free); a hold gone or its table taken = refund with key mcrn-deposit-unbooked-<pi>; an amount or account that doesn't match = mismatch, nothing booked. bookFromHold() + afterNewBooking() (customer, email, reminder, Timeline push) in services/holdBooking.js."],
          ['Webhook', 'POST /webhooks/payments/stripe (the Connect endpoint): parseWebhook() hands PaymentIntents with metadata.kind deposit to depositWebhook(), which books on payment_intent.succeeded only when the metadata venue belongs to the metadata tenant. So a guest who closes the tab after paying still gets the booking.'],
          ['Refunds', "refundDeposit() (services/depositSvc.js) on payments.stripe_account, idempotency key mcrn-deposit-refund-<id>-<refunded so far>-<amount>, refund_ids so a retry isn't counted twice. Guest cancel (guestBookingSvc.cancelBooking()) refunds in full while refundRule() allows (refund_hours_before set and starts_at minus that many hours still ahead), else keeps it; the manage page says which before and after. The booking drawer's Deposit part refunds all or part (owners and admins)."],
          ['Giving up', 'DELETE of a hold (widget or staff) cancels its PaymentIntent (cancelDepositIntent()).'],
          ['Admin', "Rules page Deposit card (deposit-not-ready / deposit-ready from GET /api/venues/:id/deposit-rules' card_payments_ready); BookingDrawer's Deposit part (payment_currency, payment_refunded, payment_refund_hours_before on GET /api/bookings)."],
          ['Widget', "views/site/reservations_widget.eta step 6 (#rpay): Stripe.js with the group's account, the Payment Element, confirmPayment({ redirect: 'if_required' }), then deposit/confirm (finishDeposit() asks again on 202)."],
        ]}
      />

      <H3>Customers — <span className="font-mono font-normal text-sm">/api/customers</span></H3>
      <DataTable
        head={['Method', 'Path', 'Min role', 'Description']}
        rows={[
          ['GET', '/', 'operator', 'Search customers by name/email/phone (?q=term). Returns 20 most-recent if q < 2 chars.'],
          ['GET', '/:id', 'operator', 'Customer detail including full booking history.'],
          ['PATCH', '/:id', 'operator', 'Update name, phone, or notes.'],
          ['POST', '/:id/unsubscribe', 'operator', 'Newsletter off: marketing_opt_in = false, marketing_opt_out_at = now() (migration 125). There is no staff subscribe; only the guest opts in, at online checkout.'],
          ['DELETE', '/:id', 'owner', 'Delete for good (22 Nov 2026, test and demo data; Customers manage and the owner role): the row goes, its bookings, web orders and loyalty membership stay unlinked (ON DELETE SET NULL) with the guest details written on them. Returns { deleted, bookings_kept, orders_kept }. Not erasure: use anonymise.'],
          ['POST', '/:id/anonymise', 'admin', 'GDPR erasure — replaces all PII with placeholders, anonymises linked bookings and web orders (guest fields, notes, allergy_note, consent, order line notes), clears the newsletter fields, and in the same transaction removes their name, email and phone from Pepper\'s chats and audit (eraseFromAi(), see Pepper → Erasure and retention). Never deletes the row.'],
          ['GET', '/:id/export', 'admin', 'GDPR data export — returns a JSON file download with customer, newsletter status, all booking records and all web orders (with items and the consent recorded at checkout).'],
        ]}
      />
      <P>
        Every query filters <Mono>tenant_id</Mono> itself (customers, and the bookings, orders and
        order lines it reads or anonymises), not only through RLS: another tenant's customer id
        returns 404 and is never listed.
      </P>

      <H3>Reviews — <span className="font-mono font-normal text-sm">/api/reviews</span></H3>
      <P>
        Tenant-scoped via RLS (website module: view reads, manage changes). Four ingestion paths:
        recorded off a review site&apos;s page (migration 239, below), Apify Google scraper,
        manual entry, CSV import. Requires <Mono>APIFY_API_TOKEN</Mono> env var for scraping.
        Google Place ID stored on the venue row (<Mono>google_place_id</Mono>). Migration 056.
      </P>
      <DataTable
        head={['Method', 'Path', 'Access', 'Description']}
        rows={[
          ['GET', '/', 'view', 'List reviews. Filter by venue_id, platform, is_approved, is_featured, min_rating, to_check=1 (checked_at IS NULL — the inbox).'],
          ['GET', '/stats', 'view', 'Aggregate stats — total/approved/pending/to_check/featured counts + average rating, per-platform counts.'],
          ['GET', '/latest', 'view', 'Per venue and platform: reviews held, the newest review_date, to_check, and when reviews were last recorded (MAX created_at of source recorded). What a recording client reads to know where to stop.'],
          ['GET', '/scrape-jobs', 'view', 'Recent Apify scrape jobs and their status.'],
          ['GET', '/:id', 'view', 'Single review detail.'],
          ['POST', '/', 'manage', 'Create a manual review. Born checked (checked_at/checked_by set): the person typed it, it never needs the inbox.'],
          ['POST', '/record', 'manage', 'Reviews read off a review site\'s page (google | tripadvisor | justeat | deliveroo | glovo — never manual) by a client that can see it: Claude in Chrome through the staff connector, or Pepper. Body: venue_id, platform, page_url? (http or https only, webLink() in shared/links.js, since it is drawn as a link on the Reviews page), reviews[] (max 40: author?, rating?, text?, date? (YYYY-MM-DD or ISO), date_text? (as written, e.g. "2 weeks ago"), reply?). Dedupe: external_id = "rec:" + md5(venue|platform|author|text, normalised — never the date, which relative wording makes unstable), upserted ON CONFLICT on the existing (tenant_id, platform, external_id) index: a repeat counts as already (a later reply/date/rating fills in blanks, nothing else changes, checked_at untouched so a dismissed review never resurfaces). A review with neither author nor text is counted unusable and skipped. New rows: source recorded, unapproved, unchecked, raw_data { recorded_by, page_url, date_text }. Returns { venue_name, platform, added, already, unusable, to_check, newest_review }.'],
          ['PATCH', '/:id', 'manage', 'Update review fields (approve, feature, edit text, add reply). Setting is_approved (either way), or checked: true alone ("keep off the website"), stamps checked_at/checked_by on the first decision — out of the To check inbox for good.'],
          ['DELETE', '/:id', 'manage', 'Delete a review permanently. Deleting a recorded one also deletes its fingerprint, so it can be recorded again — keep it off with checked instead.'],
          ['POST', '/bulk-approve', 'manage', 'Approve multiple reviews by ID array (stamps checked too).'],
          ['POST', '/scrape', 'manage', 'Enqueue an Apify Google scrape job for a venue. Requires google_place_id on the venue.'],
          ['POST', '/import-csv', 'manage', 'Import reviews from a CSV upload (reviewer_name, rating, review_text, review_date columns).'],
        ]}
      />
      <P>
        <strong>The To check inbox</strong> (migration 239): <Mono>reviews.checked_at</Mono> /{' '}
        <Mono>checked_by</Mono> say a person has looked at a review and decided. Recorded, scraped
        and CSV rows start unchecked; manual rows checked. The Reviews page&apos;s To check filter
        and stats card read them; <Mono>rv-show</Mono> / <Mono>rv-keep-off</Mono> are the per-row
        decisions. Pepper / staff MCP tools in <Mono>ai/tools/site.js</Mono>:{' '}
        <Mono>latest_reviews</Mono> (read) and <Mono>record_reviews</Mono> (change, a confirm card
        in chat and direct through the connector — the Claude in Chrome path). Tests:{' '}
        <Mono>api/test/review-recording.test.mjs</Mono>.
      </P>

      <H3>Dev tools — <span className="font-mono font-normal text-sm">/api/backlog | /api/issues | /api/feature-requests | /api/changelog</span></H3>
      <P>
        Platform-internal tools for tracking development work and communicating with tenants.
        Migration 057. New modules: <Mono>issue_log</Mono> + <Mono>feature_requests</Mono>
        (group: support), <Mono>changelog</Mono> (core).
      </P>
      <DataTable
        head={['Route', 'Auth', 'Description']}
        rows={[
          ['/api/backlog GET /', 'platform admin', 'List all backlog items grouped by status column.'],
          ['/api/backlog POST /', 'platform admin', 'Create backlog item (title, type, priority, story_points, labels).'],
          ['/api/backlog PATCH /:id', 'platform admin', 'Update item fields.'],
          ['/api/backlog DELETE /:id', 'platform admin', 'Delete item.'],
          ['/api/backlog PATCH /:id/move', 'platform admin', 'Move item to a new status column (Kanban drag).'],
          ['/api/issues GET /', 'tenant', 'List issues for tenant. A platform admin in a tenant\'s view sees that tenant\'s issues like everyone else; ?scope=all (the page\'s All restaurant groups button, platform admins only) or no tenant lists every tenant\'s, with tenant_name. scope is ignored for anyone else.'],
          ['/api/issues POST /', 'tenant', 'Create issue. Priority auto-derived from impact × urgency matrix.'],
          ['/api/issues PATCH /:id', 'tenant / platform', 'Update issue. Platform admin can update status, resolution_notes, promoted_to_backlog_id.'],
          ['/api/issues POST /:id/promote', 'platform admin', 'Promote issue to backlog — creates a backlog_item and links it.'],
          ['/api/feature-requests GET /', 'tenant', 'List feature requests. Includes upvoted_by_me flag per request.'],
          ['/api/feature-requests POST /', 'tenant', 'Submit a feature request.'],
          ['/api/feature-requests PATCH /:id', 'platform admin', 'Update status, admin_notes.'],
          ['/api/feature-requests POST /:id/upvote', 'tenant', 'Toggle upvote (insert or delete from feature_request_upvotes). user_id holds the Auth0 user id as text (migration 161; it was uuid, so every list and upvote failed).'],
          ['/api/feature-requests POST /:id/promote', 'platform admin', 'Promote to backlog item.'],
          ['/api/changelog GET /', 'any', 'List changelog entries. Tenants see published only; platform admin sees all.'],
          ['/api/changelog POST /', 'platform admin', 'Create a changelog entry (draft by default).'],
          ['/api/changelog PATCH /:id', 'platform admin', 'Update entry fields.'],
          ['/api/changelog DELETE /:id', 'platform admin', 'Delete entry.'],
          ['/api/changelog PATCH /:id/publish', 'platform admin', 'Publish or unpublish a changelog entry.'],
        ]}
      />
    </section>
  )
}
