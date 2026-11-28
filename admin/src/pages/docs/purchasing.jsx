// src/pages/docs/purchasing.jsx
// The Docs page's "Purchasing" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'purchasing'
export const label = 'Purchasing'
export const order = 250

// ── PURCHASING ────────────────────────────────
export function Section() {
  return (
    <section id="purchasing" data-doc="">
      <H2>Purchasing</H2>
      <P>
        Ordering from suppliers (migration 153), replacing order sheets (their tables and data were
        dropped: pre-prod, start fresh). Modelled on the COGS tool's inventory: an item never stores a
        cost; what it costs comes from its supplier quotes. Three API files, every query filtering{' '}
        <Mono>tenant_id</Mono> itself: <Mono>routes/inventory.js</Mono> (<Mono>/api/inventory</Mono>:
        categories, items, quotes, venue prices, preferred quotes, price history, import),{' '}
        <Mono>routes/suppliers.js</Mono> (<Mono>/api/suppliers</Mono>) and{' '}
        <Mono>routes/purchasing.js</Mono> (<Mono>/api/purchasing</Mono>: lists, orders, purchase
        orders, receiving). Shared logic in <Mono>services/purchasingSvc.js</Mono>; the pack maths,
        quote choice, totals and delivery dates in <Mono>shared/procurement.js</Mono>, used by the API
        and the admin alike.
      </P>
      <DataTable
        head={['Table', 'What it holds']}
        rows={[
          ['inv_categories', 'Tenant-wide, reorderable. 12 defaults (migration 153 for existing tenants, seedInventoryCategories() for new ones).'],
          ['inv_items', 'name, category, base_unit (g | ml | each), storage (ambient | chilled | frozen), code, notes, is_active. No price.'],
          ['suppliers', 'Contact, email + cc_emails, account_ref, send_method (email | print | excel | pdf), email_attachment (none | pdf | excel), cutoff_time, lead_days, delivery_days int[] (0 = Sunday), min_order, delivery_charge, ref_required (migration 233: marking an order sent needs their supplier_ref).'],
          ['supplier_venues', 'Per-venue account_ref, delivery_days, cutoff_time, lead_days (migration 233, 0-30); null = the supplier\'s own. Delivery details that exist only per venue (migration 233): delivery_phone, driver_instructions, slot_from / slot_to (time; either may be null, from < to).'],
          ['inv_quotes', 'An item as one supplier sells it: supplier_code, product_name (the supplier\'s own name or brand, migration 197; copied onto PO lines and printed on the supplier\'s copy), pack_name, pack_count x pack_qty pack_unit, pack_base_qty (base units per pack, computed by packBaseQty()), price per pack ex VAT, vat_rate, min_qty, order_multiple, is_active. Several per supplier allowed (two brands = two quotes).'],
          ['inv_quote_venue_prices', 'A venue\'s own price for a quote.'],
          ['inv_price_history', 'Every price a quote had (venue_id null = company price), source manual | import | invoice; po_id for a change made from a delivery\'s invoice (migration 197); pack_base_qty, the pack it was for (migration 315: a pack change is a row of its own; recordPrice(..., packBaseQty)). Every route that writes a price calls priceChanged() after its row (inventory phase 7b, Docs: Price creep and cost alerts).'],
          ['inv_preferred', 'Chosen quote per item: venue_id null = company default, else per venue. Partial unique indexes.'],
          ['order_lists / order_list_venues / order_list_items / order_list_pars', 'Mixed-supplier lists, the venues on each, items in order, par per venue in BASE units (so a pack change keeps it).'],
          ['supply_orders / supply_order_lines', 'A venue filling in a list: draft, requested (waiting for approval, migration 180) or submitted. requested_by / requested_at, requested_lines ({ item_id: { qty, quote_id } }: what was asked for), supplier_options ({ supplier_id: { delivery_date, notes } } wanted), returned_by / returned_at / return_note (last sent back), split_from, added_to_po_ids uuid[] (open purchase orders its lines were added to when placed, migration 233). Lines keep qty in packs of quote_id (null = the resolved choice).'],
          ['purchase_orders', 'One per supplier per submitted order. number (per tenant, PO-00012), status to_send | sent | received | cancelled, delivery_date, totals, sent_at/by/via/to, send_error, received_at/by, is_generated; requested_by (who asked, when it went through approval), amended_at / amended_by (changed after sending: a split), split_from (migration 180); supplier_ref (the supplier\'s own order reference, migration 233, indexed on lower()); sent_via email | print | excel | pdf | phone | website | other.'],
          ['purchase_order_lines', 'Copies of name, category, storage, product_name, pack label, pack_base_qty, price, VAT at ordering time; qty; received_qty, receive_status, receive_note. Migration 197: invoice_id, invoice_name, invoice_code, invoice_pack, invoice_price (per pack ex VAT), invoice_vat_rate (what the invoice said); added_on_receipt (arrived but not ordered: qty 0, the qty CHECK allows 0 only for these); pack_spec { name, count, qty, unit } (the pack as invoiced, for adding it to the price list).'],
          ['purchasing_settings', 'One row per tenant (migration 238, forced RLS; no row = defaults): receive_without_order off | anyone | approvers, updated_by / updated_at.'],
          ['purchase_orders.no_order', 'Migration 238: made when a delivery was booked in without an order. Received from the start, never sent; its lines are what arrived (qty = received_qty), its totals at the prices paid, delivery_date the day it arrived.'],
          ['purchase_invoices', 'An invoice read by Pepper while booking in (migration 197, forced RLS; po_id NULL with venue_id + supplier_id for a delivery without an order until it is saved, migration 238): po_id, files [{ name, url, media_type, bytes }] (storage kind invoices), supplier_name, invoice_number, invoice_date, prices_include_vat, subtotal, vat, delivery_charge, total, lines (jsonb, toInvoice() output), notes, read_by / read_at, applied_by / applied_at (set when a receive uses it).'],
          ['fs_delivery_checks.purchase_order_id', 'The H&S delivery check written by receiving (unique per PO).'],
        ]}
      />
      <H3>Which quote is ordered</H3>
      <P>
        <Mono>chooseQuote(quotes, venueId, preferred)</Mono>: the venue's preferred quote, else the
        company default, else the cheapest per base unit at that venue (<Mono>quotePrice()</Mono>: a
        venue price wins over the company price). Only active quotes of active suppliers count
        (<Mono>loadItemQuotes()</Mono>). A draft line can pin another quote (<Mono>quote_id</Mono>);
        <Mono> resolveQuotes()</Mono> does the rest.
      </P>
      <H3>Lines stay on their price (migration 232)</H3>
      <P>
        A line with a quantity on a draft or requested order is always pinned to a quote:{' '}
        <Mono>PUT /orders/:id/lines</Mono> stores the <Mono>quote_id</Mono> given, else the one the line
        already has, else the venue's usual one at that moment (migration 232 pinned lines saved before
        this the same way: the venue's preferred quote, the company's, then the cheapest per base unit).
        A later change of preferred quote never moves it. When the pinned quote, its supplier or the item
        is switched off, <Mono>loadOrder()</Mono> gives the line{' '}
        <Mono>{"gone: { why: 'price_off' | 'supplier_off', quote } | { why: 'item_off' }"}</Mono> (the old
        quote from <Mono>loadQuotesById()</Mono>, any state) and <Mono>quote: null</Mono>;{' '}
        <Mono>orderLines()</Mono> (submit, request, split) refuses with 422 code{' '}
        <Mono>order_lines</Mono> and <Mono>gone_items</Mono> / <Mono>off_items</Mono> /{' '}
        <Mono>missing_items</Mono>. The order is never placed on another price by itself. Deleting a
        quote, or a supplier with quotes, that an open order has a quantity on is a 409 code{' '}
        <Mono>on_open_order</Mono> naming the venues (<Mono>openOrderVenues()</Mono>); an item on any
        order (a PO line, or an open line with a quantity), in a recipe, or in stock (a{' '}
        <Mono>stock_count_lines</Mono> or <Mono>stock_adjustments</Mono> row, which cascade with the item) is switched
        off instead (<Mono>{'{ archived: true }'}</Mono>).
      </P>
      <P>
        Changing a quote's pack size (<Mono>PATCH /inventory/quotes/:id</Mono>, or the import matching a
        quote by supplier code) runs <Mono>keepOpenAmounts()</Mono>: open lines on it, and requests'{' '}
        <Mono>requested_lines</Mono>, are converted with <Mono>convertQty()</Mono> (the same amount or
        more in whole new packs, then <Mono>fitQty()</Mono> to the new minimum and steps); the import
        reports <Mono>order_lines_converted</Mono>. The order form does the same when a line is switched to
        another supplier or pack (<Mono>setQuote()</Mono>), and the switch window says what the quantity
        becomes. The import takes <Mono>Minimum order</Mono> and <Mono>Order in steps of</Mono> columns
        (aliases min qty, minimum, step, steps, order multiple; in packs, above 0; blank keeps the stored
        value). The quantity stepper (<Mono>QtyStepper</Mono> with <Mono>min</Mono>) goes from 0 straight
        to the minimum and below it back to 0.
      </P>
      <H3>Delivery days</H3>
      <P>
        One rule, <Mono>deliveryDayProblem(settings, date, now, name)</Mono> in{' '}
        <Mono>shared/procurement.js</Mono>, used by the screens and the API: <Mono>past</Mono> (before the
        venue's today), <Mono>not_delivery_day</Mono> (the supplier lists delivery days and this isn't
        one) or <Mono>late</Mono> (the order deadline has passed: <Mono>orderDeadline()</Mono> = the date
        minus <Mono>lead_days</Mono>, at the cutoff, or the end of that day without one; at the cutoff
        minute it has passed). <Mono>deadlineText()</Mono> words it ("order by 18:00 today"); a shared test
        checks that <Mono>nextDeliveryDate()</Mono> is always the first day from today with no problem.
        The API's <Mono>checkDeliveryDay()</Mono> (<Mono>routes/purchasing.js</Mono>) runs on submit
        (each supplier's day, a request's wanted day included), <Mono>PATCH /pos/:id</Mono> (a new date),
        and both splits: a past day is always refused; the other two pass when the body says{' '}
        <Mono>agreed: true</Mono> (per supplier in <Mono>suppliers</Mono>, at the top level on PO routes),
        else 422 code <Mono>delivery_day</Mono> with <Mono>problem</Mono>, <Mono>supplier_id</Mono>,{' '}
        <Mono>delivery_date</Mono>. <Mono>/request</Mono> only refuses past days (the approver decides).
        Orders and PO detail carry <Mono>timezone</Mono> (and POs <Mono>cutoff_time</Mono> /{' '}
        <Mono>lead_days</Mono>) so the admin's <Mono>DayCheck</Mono> can show the same result before
        anything is sent; Pepper's place, split and change tools take <Mono>agreed_with_supplier</Mono>.
      </P>
      <H3>Placing an order</H3>
      <P>
        <Mono>POST /orders</Mono> reuses an open draft for the same venue and list. Lines save through{' '}
        <Mono>PUT /orders/:id/lines</Mono> (autosave, changed lines only; leaving <Mono>quote_id</Mono>{' '}
        out keeps the stored one). <Mono>POST /orders/:id/submit</Mono> groups the lines with a quantity
        by their supplier, rounds each up with <Mono>fitQty()</Mono> (minimum and step), and creates one
        purchase order per supplier via <Mono>createPurchaseOrder()</Mono> (number from{' '}
        <Mono>nextPoNumber()</Mono> under an advisory lock) for the delivery date sent, else{' '}
        <Mono>nextDeliveryDate()</Mono>: at or past the cutoff counts as ordering tomorrow, then lead days,
        then the next delivery day (venue override first). The Place order window offers the next four
        delivery days as one-tap choices (<Mono>deliveryDateChoices()</Mono> in{' '}
        <Mono>shared/procurement.js</Mono>, starting from <Mono>next_delivery</Mono>) next to the date
        button for any other date from today on. After the transaction commits, suppliers
        with <Mono>send_method = email</Mono> are emailed (<Mono>emailPo()</Mono>); a failure is kept
        in <Mono>send_error</Mono> and the PO stays <Mono>to_send</Mono>. <Mono>orderLines()</Mono>{' '}
        (lines with a quantity, each with its quote, grouped by supplier) and <Mono>emailNew()</Mono>{' '}
        (email after commit) are shared by submit, request and split.
      </P>
      <H3>Approval (migration 180)</H3>
      <P>
        Module <Mono>purchasing_approve</Mono> (Purchasing approval; owner, admin and operator manage by
        default; the migration gave every role with its own Purchasing level the same level here).{' '}
        <Mono>POST /orders/:id/submit</Mono> needs it. Without it, <Mono>POST /orders/:id/request</Mono>{' '}
        (Purchasing manage, draft only) sets status <Mono>requested</Mono> with <Mono>requested_lines</Mono>,{' '}
        <Mono>supplier_options</Mono> (days must not be past) and the note (<Mono>notes</Mono>).
        A request changes only through an approver: <Mono>assertEditable()</Mono> on{' '}
        <Mono>PUT /orders/:id/lines</Mono>, <Mono>PATCH</Mono>, line and order <Mono>DELETE</Mono> (draft:
        Purchasing manage; requested: Purchasing approval). <Mono>POST /orders/:id/return</Mono>{' '}
        (approval, a reason is required) makes it a draft with <Mono>return_note</Mono>;{' '}
        <Mono>POST /orders/:id/withdraw</Mono> (the person who asked, or an approver) makes it a draft
        without one. Placing a request starts from its <Mono>supplier_options</Mono> (the body's days
        and notes win) and copies <Mono>requested_by</Mono> onto the POs. <Mono>orderActions()</Mono>{' '}
        puts <Mono>can_edit</Mono>, <Mono>can_request</Mono>, <Mono>can_place</Mono>,{' '}
        <Mono>can_return</Mono>, <Mono>can_split</Mono>, <Mono>can_withdraw</Mono>,{' '}
        <Mono>can_delete</Mono> on every order the API returns; the admin shows only those.{' '}
        <Mono>GET /orders?status=requested</Mono> lists them oldest first; <Mono>/meta</Mono> has{' '}
        <Mono>can_approve</Mono>. On POs: <Mono>PUT /pos/:id/lines</Mono>, <Mono>/cancel</Mono> and{' '}
        <Mono>/split</Mono> need approval; <Mono>PATCH /pos/:id</Mono> (date, notes),{' '}
        <Mono>/send</Mono>, <Mono>/mark-sent</Mono> and <Mono>/receive</Mono> take Purchasing or
        Purchasing approval (manage).
      </P>
      <H3>Splitting (migration 180)</H3>
      <P>
        <Mono>POST /orders/:id/split</Mono> (a request only; approval):{' '}
        <Mono>{'{ lines: [{ item_id, qty }], suppliers: { [supplier_id]: { delivery_date, notes? } } }'}</Mono>,
        a day for every supplier of a moved line, not past and not the first order's day (its{' '}
        <Mono>supplier_options</Mono> date, else <Mono>next_delivery</Mono>). Refuses moving more than a
        line holds or the whole order, and (<Mono>splitProblem()</Mono>, 422 code{' '}
        <Mono>split_qty</Mono>) a move that would leave either part of a line below the quote's minimum
        or between its steps. The new days go through <Mono>checkDeliveryDay()</Mono>. The moved
        quantities become a new <Mono>requested</Mono> order
        (same list, notes, <Mono>requested_by</Mono> / <Mono>_at</Mono>, <Mono>split_from</Mono>); both
        orders' <Mono>requested_lines</Mono> are split the same way. <Mono>POST /pos/:id/split</Mono>{' '}
        (<Mono>to_send</Mono> or <Mono>sent</Mono>; approval): <Mono>{'{ lines: [{ id, qty }], delivery_date }'}</Mono>{' '}
        makes a new PO (new number, same supplier, supply order, notes, delivery charge,{' '}
        <Mono>requested_by</Mono>, the lines' copied prices, <Mono>split_from</Mono>) and takes the
        quantities off the original (a line moved in full is deleted); both totals are recalculated. A{' '}
        <Mono>sent</Mono> original goes back to <Mono>to_send</Mono> with <Mono>amended_at</Mono> /{' '}
        <Mono>amended_by</Mono>, and when the supplier takes email both are emailed after commit
        (<Mono>results</Mono>). <Mono>poChangeNotes()</Mono> puts "Amended ... replaces any earlier copy"
        and "Split off PO-..." on the HTML, PDF and Excel copies; <Mono>emailPo()</Mono>'s subject says
        Amended order. <Mono>GET /pos/:id</Mono> adds <Mono>delivery_choices</Mono>,{' '}
        <Mono>split_from_po</Mono> and <Mono>split_into</Mono>.
      </P>
      <H3>Sending and documents</H3>
      <P>
        <Mono>poFile(tenantId, poId, format)</Mono> renders the same document as HTML (print, through a
        hidden iframe in the admin), Excel (<Mono>xlsx</Mono> package) or PDF (<Mono>services/pdfDoc.js</Mono>,
        a small dependency-free writer with the standard Helvetica fonts), or the supplier's quick order as a CSV
        (<Mono>csv</Mono>: code, name, qty, no prices). <Mono>GET /pos/:id/file?format=</Mono> (anything else is the PDF).
        Emails go through the venue's provider (<Mono>venue_email_settings</Mono>,{' '}
        <Mono>emailCredentials()</Mono>); <Mono>sendEmail()</Mono> now takes <Mono>cc</Mono> and{' '}
        <Mono>attachments</Mono> for every provider (SES switches to a raw MIME message when there are
        attachments). <Mono>POST /pos/:id/mark-sent</Mono> records print / PDF / Excel / phone / website
        sends, with the supplier's reference and an earlier send time (below).
      </P>
      <H3>Delivery details, the duplicate guard and sent tracking (migration 233)</H3>
      <P>
        <Mono>supplierForVenue(supplier, venueRow)</Mono> (<Mono>shared/procurement.js</Mono>) gives the
        venue's <Mono>lead_days</Mono> before the supplier's, so <Mono>nextDeliveryDate()</Mono>,{' '}
        <Mono>deliveryDayProblem()</Mono> and the order form follow a venue that needs more (or less)
        notice, and adds <Mono>delivery_phone</Mono>, <Mono>driver_instructions</Mono>,{' '}
        <Mono>slot_from</Mono> / <Mono>slot_to</Mono> (HH:MM). <Mono>slotText()</Mono> words the slot
        ("07:00-10:00", "from 07:00", "by 10:00"). <Mono>loadSuppliersForVenue()</Mono> and{' '}
        <Mono>loadPo()</Mono> carry them (the PO with the venue's details as they are now);{' '}
        <Mono>poHtml()</Mono> / <Mono>poXlsx()</Mono> / <Mono>poPdf()</Mono> and the email print the slot,
        the delivery phone (<Mono>deliveryPhone()</Mono>: the venue row's, else the venue's own phone from
        its website settings) and "Your ref". <Mono>GET /pos/:id</Mono> adds <Mono>deliver_to</Mono>{' '}
        (name, address lines, city, postcode, phone from <Mono>loadVenue()</Mono>) for{' '}
        <Mono>checkoutText(po, venue)</Mono>: Account, Deliver to, Delivery (day, slot), Phone, Instructions
        (the PO's notes, else the driver instructions), Our order, one per line.
      </P>
      <P>
        <strong>Notes.</strong> On submit a supplier whose options (the request's, then the body's) have no{' '}
        <Mono>notes</Mono> key gets the venue's <Mono>driver_instructions</Mono>; a key set to empty stays
        empty. <Mono>/request</Mono> stores the key only when the body sends it, so a cleared note survives
        approval. The admin's Place order window starts the note the same way (<Mono>noteFor()</Mono>).
      </P>
      <P>
        <strong>Duplicate guard.</strong> Per supplier, after <Mono>checkDeliveryDay()</Mono>,{' '}
        <Mono>openPoFor()</Mono> takes an advisory lock on venue + supplier and looks for a{' '}
        <Mono>to_send</Mono> or <Mono>sent</Mono> PO for that day (<Mono>to_send</Mono> first, then the
        lowest number). Without an answer in <Mono>suppliers[id].existing</Mono> nothing is placed: 409 code{' '}
        <Mono>po_exists</Mono> with <Mono>{'conflicts: [{ supplier_id, po_id, po_number, po_status, delivery_date }]'}</Mono>{' '}
        for every such supplier. <Mono>existing: 'separate'</Mono> places a new PO as before;{' '}
        <Mono>'add'</Mono> runs <Mono>addToPo()</Mono> (422 code <Mono>po_sent</Mono> once that PO has
        gone): a quote already on it (not <Mono>added_on_receipt</Mono>) is topped up to{' '}
        <Mono>fitQty(qty + added)</Mono>, others are new lines copied like{' '}
        <Mono>createPurchaseOrder()</Mono>, the note is appended unless already there, totals recalculated;
        its id goes into the order's <Mono>added_to_po_ids</Mono> and the reply's <Mono>added_to</Mono>, and
        it is emailed whole after commit when the supplier takes email. <Mono>poList()</Mono> by supply
        order and <Mono>GET /orders</Mono>'s <Mono>po_count</Mono> include the POs added to.{' '}
        <Mono>loadOrder()</Mono> returns <Mono>open_pos</Mono> (the venue's <Mono>to_send</Mono> /{' '}
        <Mono>sent</Mono> POs from today for the order's suppliers) so the window asks before placing
        (<Mono>openPoOn()</Mono>, <Mono>OpenPoChoice</Mono>: Add to / Separate order for one not sent,
        Place a second order for one sent; Place waits for an answer and refetches the order on a 409).
      </P>
      <P>
        <strong>Sent tracking.</strong> <Mono>POST /pos/:id/mark-sent</Mono> takes{' '}
        <Mono>supplier_ref</Mono> (422 code <Mono>supplier_ref</Mono> without it when the supplier is{' '}
        <Mono>ref_required</Mono>) and <Mono>sent_at</Mono> (ISO with offset; 422 code <Mono>sent_at</Mono>{' '}
        when over 5 minutes ahead, older than <Mono>SENT_AT_DAYS</Mono> 14, or before the minute the order
        was made); <Mono>via</Mono> may be <Mono>website</Mono>. <Mono>PATCH /pos/:id</Mono> sets or clears{' '}
        <Mono>supplier_ref</Mono> on any status but cancelled. <Mono>GET /pos?q=</Mono> finds POs by part of
        the reference (case-insensitive) or the PO number (PO-00012 or 12); <Mono>order=asc</Mono> lists
        soonest delivery first. <Mono>poList()</Mono> rows carry <Mono>venue_timezone</Mono>,{' '}
        <Mono>supplier_ref</Mono>, <Mono>ref_required</Mono> and the effective <Mono>cutoff_time</Mono> /{' '}
        <Mono>lead_days</Mono> / <Mono>delivery_days</Mono> at the venue, so the admin's{' '}
        <Mono>poLateness()</Mono> marks a card Past their cutoff (<Mono>to_send</Mono> and{' '}
        <Mono>deadlinePassed()</Mono>, the same rule as the <Mono>late</Mono> day problem) or Not booked in
        (<Mono>sent</Mono>, delivery day before the venue's today).
      </P>
      <P>
        Admin: Suppliers page <Mono>VenuesCard</Mono> (days' notice Same / Own, delivery phone, slot with{' '}
        <Mono>OptionalTime</Mono> selects, driver instructions; Save waits while a slot ends before it
        starts) and the <Mono>ref_required</Mono> switch in <Mono>OrderingCard</Mono>;{' '}
        <Mono>ReviewModal</Mono> (<Mono>DeliveryDetails</Mono>, <Mono>OpenPoChoice</Mono>),{' '}
        <Mono>PlacedView</Mono> (added to), <Mono>PoDetail</Mono> (<Mono>PoDeliveryDetails</Mono>,{' '}
        <Mono>SupplierRefRow</Mono> with its own Save, <Mono>CheckoutCopyModal</Mono> with Copy all and a
        copy button per line, <Mono>copyText()</Mono> falling back to a selected text box),{' '}
        <Mono>MarkSentModal</Mono> (reference, Just now / Earlier with a datetime-local and{' '}
        <Mono>sentAtProblem()</Mono>), <Mono>Deliveries</Mono> search box. Pepper: <Mono>order_form</Mono>{' '}
        shows each supplier's slot, phone, instructions and open orders; <Mono>place_order</Mono>{' '}
        takes <Mono>deliveries[].existing_order</Mono> (<Mono>add_to_it</Mono> | <Mono>separate</Mono>) and
        notes (the instructions by default), checking the day before the open order;{' '}
        <Mono>send_purchase_order</Mono> takes <Mono>supplier_ref</Mono> and <Mono>sent_on</Mono> /{' '}
        <Mono>sent_time</Mono> (venue time, refused for an email); <Mono>change_purchase_order</Mono> sets{' '}
        <Mono>supplier_ref</Mono>; <Mono>purchase_orders</Mono> finds by <Mono>supplier_ref</Mono> and lists{' '}
        <Mono>late</Mono> ones; the day briefing has <Mono>orders_running_late</Mono>. A new location copies{' '}
        <Mono>supplier_venues</Mono> without the account number, delivery phone and driver instructions.
        Tests: <Mono>api/test/purchasing-delivery.test.mjs</Mono>, <Mono>shared/test/procurement.test.mjs</Mono>.
      </P>
      <P>
        The order&apos;s top card (25 Nov 2026, no migration; the office and the phone share{' '}
        <Mono>PoDetail</Mono>): the delivery day (<Mono>DateButton</Mono> while open), then{' '}
        <Mono>{'<PoStatusBadge big />'}</Mono> (<Mono>data-testid="po-status"</Mono>) beside{' '}
        <Mono>SupplierRefRow</Mono> (Their reference over the value, Add it / Change). <Mono>PoMenu</Mono> at its
        top right (<Mono>po-menu</Mono>; items <Mono>po-print</Mono>, <Mono>po-pdf</Mono>, <Mono>po-excel</Mono>,{' '}
        <Mono>po-checkout</Mono>, <Mono>po-quick-order</Mono>, <Mono>po-correct</Mono> once received for
        can_order / can_approve, <Mono>po-history</Mono>) and <Mono>PoHistoryModal</Mono>: asked for
        (<Mono>requested_by</Mono>), placed (<Mono>created_at</Mono>, <Mono>created_by</Mono>), sent
        (<Mono>sent_at</Mono>, <Mono>sent_via</Mono>, <Mono>sent_to</Mono>), changed after sending, received
        (<Mono>received_at</Mono>, <Mono>received_by</Mono>), then the account, phone,{' '}
        <Mono>PoDeliveryDetails</Mono>, the note and the split orders. Email failed and Changed after sending stay
        under the card; the action buttons and the lines are unchanged. No API change.
      </P>
      <H3>Supplier codes and the quick order (1 Nov 2026, no migration)</H3>
      <P>
        <strong>Searching.</strong> <Mono>GET /purchasing/venues/:id/catalog?search=</Mono> matches the item's
        name (anywhere), our item code (from its start) and, through an <Mono>EXISTS</Mono> over the item's
        active quotes (of <Mono>supplier_id</Mono> when given), a supplier's code or product name anywhere.
        Items whose code or a quote's code equals the search come first (<Mono>exact</Mono>, made with{' '}
        <Mono>COALESCE(..., false)</Mono>: a NULL would sort before true under <Mono>DESC</Mono>), then by
        name. When a supplier's code was typed in whole, the item carries <Mono>matched_quote_id</Mono> (that
        quote): Add an item, Add items on a PO and Pepper add on that quote, not the item's usual one.{' '}
        <Mono>GET /pos?q=</Mono> also finds a PO with a line whose <Mono>supplier_code</Mono> equals{' '}
        <Mono>q</Mono> (case-insensitive, whole code). The admin's order form filters with{' '}
        <Mono>matchesSearch()</Mono> (name, our code, any quote's code or product name), and the Inventory page
        the same.
      </P>
      <P>
        <strong>Quick order.</strong> <Mono>quickOrder(lines, {'{ sep }'})</Mono> in{' '}
        <Mono>shared/procurement.js</Mono> takes <Mono>{'[{ code, name, qty }]'}</Mono> and returns{' '}
        <Mono>{'{ text, coded, noCode }'}</Mono>: <Mono>CODE:QTY</Mono> per code (the same code without
        regard to case summed once, the first spelling kept), joined by <Mono>sep</Mono> (comma, or a new
        line); lines without a code go to <Mono>noCode</Mono>, lines without a quantity above 0 are left out.{' '}
        <Mono>quickOrderCsv(lines)</Mono> is the same as <Mono>code,name,qty</Mono> rows with CRLF, cells quoted
        when needed and a leading <Mono>= + - @</Mono> made harmless with an apostrophe.{' '}
        <Mono>GET /pos/:id/file?format=csv</Mono> (<Mono>poFile()</Mono>) is that CSV of the PO's lines (not{' '}
        <Mono>added_on_receipt</Mono> ones, as on every supplier's copy; name = product name, else the item's).
        Quantities are packs as ordered. Admin: <Mono>QuickOrderModal</Mono> in{' '}
        <Mono>components/purchasing/ordering.jsx</Mono> (groups per supplier, On one line / One a line in
        localStorage <Mono>maca_quick_order_sep</Mono>, Copy via <Mono>copyText()</Mono>, CSV from the file
        route on the PO page or <Mono>saveBlob()</Mono> on the order form, the lines without a code), opened by
        Codes for quick order on <Mono>PoDetail</Mono> and Codes on <Mono>OrderForm</Mono> (its fitted
        quantities per supplier). <Mono>CodeTag</Mono> (<Mono>components/purchasing/shared.jsx</Mono>) shows a
        code next to the pack on every ordering screen and the Inventory list and panel.
      </P>
      <P>
        <strong>Pepper.</strong> <Mono>find_inventory_items</Mono> matches suppliers' codes and product names
        (an exact code first); an order line, a PO line (<Mono>pickPoLine()</Mono>), a product to add to a PO
        and a line in <Mono>split_order</Mono> / <Mono>receive_delivery</Mono> can be named by a supplier's
        code; on an order, a code names that quote (<Mono>findOrderItem()</Mono>'s <Mono>codeQuote</Mono>,
        which <Mono>planOrder()</Mono> switches the line to). <Mono>order_form</Mono> gives each supplier's{' '}
        <Mono>quick_order</Mono> and each item's <Mono>supplier_code</Mono>; <Mono>purchase_orders</Mono> with{' '}
        <Mono>po</Mono> gives <Mono>quick_order</Mono> and <Mono>not_in_quick_order</Mono>, and{' '}
        <Mono>product_code</Mono> lists the POs with that code on a line. <Mono>update_supplier</Mono>'s venue
        settings take <Mono>days_notice</Mono>, <Mono>delivery_phone</Mono>, <Mono>driver_instructions</Mono> and{' '}
        <Mono>delivery_slot_from</Mono> / <Mono>_to</Mono>, and send every other venue's row back whole
        (<Mono>venueSettings()</Mono>): <Mono>PUT /suppliers/:id/venues</Mono> replaces every venue, and before
        this the tool dropped other venues' delivery details. <Mono>needs_their_reference</Mono> sets{' '}
        <Mono>ref_required</Mono>. Tests: <Mono>api/test/purchasing-codes.test.mjs</Mono>,{' '}
        <Mono>shared/test/procurement.test.mjs</Mono>.
      </P>
      <H3>Catalogue tidy-up (1 Nov 2026, no migration)</H3>
      <P>
        <strong>One code, one product.</strong> Among a supplier's live prices (the quote and its item both{' '}
        <Mono>is_active</Mono>) a <Mono>supplier_code</Mono> (trimmed, any case) is on one quote only.
        In <Mono>services/purchasingSvc.js</Mono>: <Mono>lockSupplierCodes(tx, supplierId)</Mono> (an advisory
        lock on <Mono>'inv-code:' + supplierId</Mono>, so two saves of one code can't both pass),{' '}
        <Mono>codeTaken(tx, tenantId, supplierId, code, {'{ except }'})</Mono> (the live quote holding it, with its
        item and supplier names, or null) and <Mono>codeTakenError()</Mono> (409, code <Mono>duplicate_code</Mono>,{' '}
        <Mono>quote_id</Mono>, <Mono>item_id</Mono>); <Mono>itemCodeConflicts(tx, tenantId, itemIds)</Mono> (the
        codes of switched-off items' live quotes that another live price of the supplier has) and{' '}
        <Mono>itemCodesError()</Mono> (409 <Mono>duplicate_code</Mono> with <Mono>conflicts</Mono>). Checked by{' '}
        <Mono>POST /inventory/items/:id/quotes</Mono>, <Mono>PATCH /inventory/quotes/:id</Mono> (only when the
        code or supplier changes, or the quote is switched on: a shared code left from before can still have its
        price edited), <Mono>PATCH /inventory/items/:id</Mono> switching an item on, the bulk switch, the import
        (before any write of the row; a refused row adds nothing) and an invoice's price list
        (<Mono>POST /purchasing/pos/:id/price-list</Mono>, a new product with a code). Switched-off prices and
        items may keep a code that is live elsewhere. Codes shared before this stay until someone changes them;
        the catalogue check lists them.
      </P>
      <P>
        <strong>Routes</strong> (<Mono>routes/inventory.js</Mono>). <Mono>GET /inventory/check</Mono>{' '}
        (Purchasing setup view, <Mono>catalogueCheck()</Mono>): <Mono>duplicate_codes</Mono> (per supplier and
        code, the quotes with item name and <Mono>pack_label</Mono>), <Mono>duplicate_names</Mono> (items in use
        whose trimmed lower-case names match, each with its category and number of active prices),{' '}
        <Mono>no_price</Mono> (items in use with no active quote of a supplier switched on, up to 500) and{' '}
        <Mono>no_code</Mono> (per supplier switched on, live quotes without a code: count and up to 8 item names).{' '}
        <Mono>POST /inventory/items/bulk</Mono> (manage) takes <Mono>ids</Mono> (up to 1000) and{' '}
        <Mono>is_active</Mono> / <Mono>category_id</Mono> / <Mono>storage</Mono>, now with{' '}
        <Mono>dry_run</Mono>: <Mono>{'{ updated, unchanged, on_open_orders, code_conflicts }'}</Mono>.{' '}
        <Mono>on_open_orders</Mono> (switching off; <Mono>openOrderItems()</Mono>: drafts and requests with a
        quantity, per item the venues) and <Mono>code_conflicts</Mono> (switching on) are said, not refused, in a
        dry run; a real switch on with conflicts is 409. Lines of an item switched off show as{' '}
        <Mono>gone: item_off</Mono> on their order (step 1).
      </P>
      <P>
        <Mono>POST /inventory/price-update</Mono> (manage; <Mono>{'{ supplier_id, file | text | rows, dry_run }'}</Mono>,
        exactly one of file (base64 CSV or Excel), text (lines <Mono>code, price</Mono>, also <Mono>:</Mono>,{' '}
        <Mono>;</Mono>, a tab or a space, an optional £, a first line of headings left out) or rows (Pepper), up to
        5000): <Mono>runPriceUpdate()</Mono> matches each code to the supplier's quotes (any case); one live
        quote = a change (<Mono>pct</Mono> to one decimal, <Mono>big</Mono> at 20% or more or from £0) or{' '}
        <Mono>unchanged</Mono>; none = <Mono>unknown</Mono>; only switched-off ones ={' '}
        <Mono>switched_off</Mono>; more than one live = <Mono>ambiguous</Mono>; a bad price, an unreadable line or
        a code twice = <Mono>errors</Mono>. Applying writes <Mono>inv_quotes.price</Mono> and an{' '}
        <Mono>inv_price_history</Mono> row with source <Mono>import</Mono>; packs, codes and venue prices are not
        touched. A file's headings are matched by <Mono>PRICE_HEADERS</Mono> (Code, Supplier code, SKU, Ref ...;
        Price, Price delivery, Cost ...); a Price collection column is left out (<Mono>collection_ignored</Mono>);
        a file without headings is read as code then price. <Mono>GET /inventory/price-update/template?supplier_id=</Mono>{' '}
        (view) is the supplier's coded live prices now as <Mono>Code,Price,Item,Product,Pack</Mono> (cells
        through <Mono>csvCell()</Mono> from <Mono>shared/procurement.js</Mono>).
      </P>
      <P>
        <strong>Reading files.</strong> <Mono>readSheet()</Mono> (<Mono>services/sheetRead.js</Mono>; the import,
        the price update and a supplier's basket) reads a CSV that is valid UTF-8 as text (<Mono>TextDecoder</Mono>{' '}
        with <Mono>fatal</Mono>), else (Excel, or a CSV saved as Windows-1252) as bytes, with <Mono>raw: true</Mono>{' '}
        both ways. Before, a CSV without a byte order mark was read as Windows-1252 (£ came out as Â£, Crème as
        CrÃ¨me) and codes like <Mono>12-04</Mono> were turned into dates. <Mono>fileText()</Mono> beside it gives a
        text file's text (UTF-8 when valid, else Windows-1252) and null for an Excel file (by its first bytes).
      </P>
      <P>
        <strong>Admin.</strong> <Mono>components/purchasing/catalogue.jsx</Mono>: <Mono>CatalogueCheckModal</Mono>{' '}
        (each item opens its panel; fetched fresh each time it opens: <Mono>staleTime: 0, gcTime: 0</Mono>),{' '}
        <Mono>SwitchItemsModal</Mono> (the dry run, also fresh each time, then the switch) and{' '}
        <Mono>PriceUpdateModal</Mono> (supplier, the CSV of their prices now, a file or pasted lines, Check, then
        Update; the result scrolled into view in the window's own scroll area). <Mono>pages/Inventory.jsx</Mono>:
        header buttons Check (<Mono>inv-check</Mono>, view), Update prices and Select (manage; icons only below{' '}
        <Mono>sm</Mono>), selecting turns rows into tick boxes with a bar (<Mono>inv-select-bar</Mono>: n chosen,
        Choose all shown, Switch off, Switch on, Done), and <Mono>ItemForm</Mono> warns of another item with the
        same name (<Mono>inv-twin-name</Mono>, Open it). Pepper: <Mono>check_catalogue</Mono>,{' '}
        <Mono>switch_items</Mono>, <Mono>update_prices_by_code</Mono>, and the price and item change tools refuse
        a code another live product of the supplier has (<Mono>liveCodeOwner()</Mono>, <Mono>codeClash()</Mono>).
        Tests: <Mono>api/test/purchasing-catalogue.test.mjs</Mono>.
      </P>
      <H3>A supplier&apos;s basket (1 Nov 2026, no migration)</H3>
      <P>
        What someone ordered on a supplier's own website, brought into an order by the supplier's product codes.
        The rules are in <Mono>shared/procurement.js</Mono>: <Mono>basketFromText(text)</Mono> reads the quick
        order's pairs (<Mono>MEA161:20,POR106:7</Mono>, split on <Mono>,</Mono> / <Mono>;</Mono> when the line has
        a <Mono>:</Mono>), one a line (<Mono>MEA161 20</Mono>, <Mono>MEA161, 20</Mono>, <Mono>MEA161 x 20</Mono>,{' '}
        <Mono>20 x MEA161</Mono>; two numbers either side of an x are refused as either way round), and a pasted
        table (a first line naming a code and a quantity column, a first line of words, or three columns or
        more) through <Mono>basketFromSheet(rows)</Mono>, the delimiter guessed from the first line (a tab, else{' '}
        <Mono>;</Mono> when it has no comma, else a comma; quoted cells allowed). Headings are matched by{' '}
        <Mono>BASKET_HEADINGS</Mono> (code: Code, SKU, Ref, Product code, Stock code ...; qty: Qty, Quantity,
        Cases, Packs ...; name: Description, Product ...); without headings the first column is the code and the
        second the quantity; headings naming neither give <Mono>{'{ error }'}</Mono>. Each row is{' '}
        <Mono>{'{ row, code, qty, name? }'}</Mono> or <Mono>{'{ row, code?, text, error }'}</Mono> with its line
        number. <Mono>mergeBasket()</Mono> adds up a code's quantities (any case, the first spelling kept).{' '}
        <Mono>basketDiff({'{ basket, quotes, lines, supplierId, removeMissing }'})</Mono> gives{' '}
        <Mono>{'{ added, changed, removed, unchanged, unknown, switched_off, ambiguous, errors }'}</Mono>: a code is
        matched to the supplier's quotes with that code (one live quote, else unknown / switched_off /
        ambiguous); a second code of an item already matched is an error (one line per item); the quantity is{' '}
        <Mono>fitQty()</Mono> of the basket's (<Mono>basket_qty</Mono> and <Mono>qty_problem</Mono> when that
        changed it); a line on another quote says where it was (<Mono>from</Mono>); a basket quantity of 0 takes
        the line off; with <Mono>removeMissing</Mono> the order's other lines on this supplier's quotes are taken
        off. <Mono>BASKET_MAX_ROWS</Mono> is 2000.
      </P>
      <P>
        <strong>Routes</strong> (<Mono>routes/purchasing.js</Mono>). <Mono>GET /venues/:venueId/suppliers</Mono>{' '}
        (read): the suppliers switched on with a live price, and <Mono>codes</Mono> (how many of those prices have
        a product code). <Mono>POST /orders/:id/reconcile</Mono> (Purchasing or Purchasing approval manage, then{' '}
        <Mono>assertEditable()</Mono>; body limit 6 MB):{' '}
        <Mono>{'{ supplier_id, text | file | rows, remove_missing (default true), dry_run }'}</Mono>, exactly one
        source (400): pasted text, a file (base64, up to 4 MB: <Mono>fileText()</Mono> reads a CSV or text file
        like pasted text, an Excel file goes through <Mono>readSheet()</Mono> and{' '}
        <Mono>basketFromSheet()</Mono>) or rows (<Mono>{'[{ code, qty }]'}</Mono>, Pepper). 422 for nothing read, a
        layout without code and quantity columns, more than 2000 lines or a supplier switched off; 404 for
        another group's supplier or order. The quotes are the supplier's with a code, live = quote and item
        switched on; the order's lines with a quantity come with the quote they are pinned to (else the venue's
        usual one). A dry run returns the diff; applying upserts added and changed lines pinned to the basket's
        quote at the fitted quantity, sets removed lines to 0 and returns the diff with <Mono>order</Mono> (as{' '}
        <Mono>loadOrder()</Mono>). Applying the same basket again changes nothing.
      </P>
      <P>
        <strong>Admin.</strong> <Mono>components/purchasing/basket.jsx</Mono>: <Mono>BasketModal</Mono>, opened by
        Import basket (<Mono>order-basket</Mono>) on <Mono>OrderForm</Mono> when the order is editable (after the
        autosave is flushed). The supplier is picked when the order's lines are all one supplier's
        (<Mono>likelySupplier()</Mono>); suppliers without codes can't be picked; a file (up to 2.9 MB) or pasted
        text; the Take off toggle; Check (dry run, <Mono>basket-result</Mono> scrolled into view), Apply n changes,
        Change the basket. A code not found offers Add it to people with Purchasing setup
        (<Mono>meta.can_setup</Mono>): <Mono>AddCodeModal</Mono> picks the inventory item
        (<Mono>ItemPickModal</Mono>), then gives one of the supplier's prices for it the code
        (<Mono>PATCH /inventory/quotes/:id</Mono>) or makes a new price (<Mono>POST /inventory/items/:id/quotes</Mono>{' '}
        with <Mono>PackFields</Mono>), and checks again. Pepper: <Mono>import_supplier_basket</Mono> (rows up to
        300 or <Mono>attached_file</Mono>, a CSV or text file attached in the chat; <Mono>keep_missing</Mono>; the
        card is the dry run, refused when nothing would change; pins the order and the supplier). Tests:{' '}
        <Mono>api/test/purchasing-basket.test.mjs</Mono>, the basket tests in{' '}
        <Mono>shared/test/procurement.test.mjs</Mono>.
      </P>
      <H3>Out of stock until a date (migration 234)</H3>
      <P>
        <Mono>inv_quotes.out_of_stock_until</Mono> (date) is the first day the price can be delivered again;{' '}
        <Mono>out_of_stock_note</Mono> (up to 500), <Mono>out_of_stock_by</Mono> and{' '}
        <Mono>out_of_stock_at</Mono> say what the supplier said, who marked it and when. A date that has passed
        means back in stock; nothing clears it. It is company-wide (one row per quote) and changes nothing else:
        the price stays the usual one, lines stay on it, placing isn't refused. The one rule is{' '}
        <Mono>outOfStock(quote, date)</Mono> in <Mono>shared/procurement.js</Mono> (<Mono>{'{ until, note }'}</Mono>{' '}
        when <Mono>date</Mono> is before <Mono>until</Mono>, else null) with <Mono>outOfStockText()</Mono>{' '}
        ("Out of stock at Brakes until Fri 6 Nov").
      </P>
      <P>
        <Mono>PUT /purchasing/quotes/:id/stock</Mono> (<Mono>{'{ until: "YYYY-MM-DD" | null, note }'}</Mono>; Manage
        on any of <Mono>purchasing</Mono>, <Mono>purchasing_approve</Mono>, <Mono>purchasing_setup</Mono>, also on
        orders the person can't change): <Mono>until</Mono> must be after today in London and at most{' '}
        <Mono>STOCK_DAYS_MAX</Mono> (366) days ahead (422, code <Mono>stock_until</Mono>; a day that doesn't exist
        is 400); null clears all four columns; <Mono>updated_at</Mono> is left alone (it isn't a price change).{' '}
        <Mono>GET /purchasing/meta</Mono> has <Mono>can_mark_stock</Mono>. The date reaches the screens through{' '}
        <Mono>loadItemQuotes()</Mono> / <Mono>loadQuotesById()</Mono> / <Mono>quoteView()</Mono> (order form items),{' '}
        <Mono>loadPoLines()</Mono> (purchase order lines) and <Mono>QUOTE_COLS</Mono> in{' '}
        <Mono>routes/inventory.js</Mono>, always as <Mono>::text</Mono>.
      </P>
      <DataTable
        head={['Screen', 'Judged against']}
        rows={[
          ['Order form lines, Add an item', 'The supplier\'s next delivery (order.suppliers[id].next_delivery), else today'],
          ['Place order (StockNote review-stock)', 'The date picked for that supplier'],
          ['Splitting a request or a purchase order (split-stock)', 'The second order\'s day'],
          ['Purchase order lines, Add items', 'The order\'s delivery_date'],
          ['Inventory list and item panel', 'Today'],
        ]}
      />
      <P>
        <strong>Admin.</strong> <Mono>components/purchasing/stock.jsx</Mono>: <Mono>StockBadge</Mono> (the amber
        line), <Mono>StockNote</Mono> (a delivery's lines out of stock on its day, with the first day they are all
        back) and <Mono>StockControl</Mono> (the state with Back in stock and Change, or Out of stock?; a form with
        the date, Tomorrow / In a week / In 2 weeks / In 4 weeks and a note). On the order form a line out of
        stock shows <Mono>order-line-stock</Mono> with Pick another price; the pack opens the switch window for
        anyone who can switch or mark (<Mono>SwitchSupplierModal</Mono>: titled Order X from when they can pick, X:
        supplier prices when they can't, a <Mono>StockControl</Mono> on each price). The Inventory item panel has a{' '}
        <Mono>StockControl</Mono> under each active price. Pepper: <Mono>set_out_of_stock</Mono> (by item name or
        supplier code, supplier and pack; <Mono>until</Mono> or <Mono>back_in_stock</Mono>; card titled Mark it out
        of stock? / back in stock?, pins the quote); <Mono>order_form</Mono> items and other choices,{' '}
        <Mono>find_inventory_items</Mono> prices say it; <Mono>place_order</Mono> and <Mono>request_order</Mono>{' '}
        cards warn about lines out of stock for their day (<Mono>stockWarnings()</Mono>). Tests:{' '}
        <Mono>api/test/purchasing-stock.test.mjs</Mono>.
      </P>
      <H3>Changing an order not yet sent</H3>
      <P>
        <Mono>PUT /pos/:id/lines</Mono> (approval; <Mono>to_send</Mono> only, else 409):{' '}
        <Mono>{'{ lines: [{ id, qty }], add: [{ quote_id, qty }] }'}</Mono>. <Mono>lines</Mono> sets
        quantities (0 deletes the line; a changed one is stored as <Mono>fitQty()</Mono> against the
        quote's minimum and steps today, which <Mono>loadPoLines()</Mono> returns as{' '}
        <Mono>min_qty</Mono> / <Mono>order_multiple</Mono> only while the quote is still for the line's
        pack, else null; an unchanged quantity is left alone). <Mono>add</Mono> takes only active prices of active suppliers
        (<Mono>loadItemQuotes()</Mono>) from the PO's own supplier (422 otherwise, also for another
        tenant's or a switched-off price) and refuses an item switched off in the inventory (422). A new
        line copies the item and the quote like <Mono>createPurchaseOrder()</Mono> does (name, category,
        storage, base unit, code, product name, pack label and base quantity,{' '}
        <Mono>quotePrice(q, venue)</Mono>, VAT) at <Mono>fitQty(qty)</Mono>, after the lines already
        there. A product already on the order (same quote, not added on receipt, after the{' '}
        <Mono>lines</Mono> changes) tops its line up to <Mono>fitQty(qty + added)</Mono> instead of
        making a second line; the same product twice in one add counts twice. An order left with no lines
        is refused (cancel it instead). Totals are recalculated; nothing is marked amended (the supplier
        hasn't had it). <Mono>GET /venues/:id/catalog?supplier_id=</Mono> lists only items that supplier
        sells (<Mono>all</Mono> is ignored with it), each with all its active quotes, so callers filter
        the quotes to the supplier.
      </P>
      <P>
        Admin: Change quantities and Add items on <Mono>PoDetail</Mono> (approvers, To send) open one edit
        mode (<Mono>editQty</Mono> per line, <Mono>added</Mono> = <Mono>{'{ item, quote, qty }'}</Mono>).
        While it is open the send buttons are hidden, and with prices the totals come from the draft
        (<Mono>orderTotals()</Mono>) with the saved total as "Before these changes".{' '}
        <Mono>AddPoItemsModal</Mono> lists one row per quote of the supplier, shows quotes already on the
        order as not pickable and toggles picks; a new line starts at <Mono>fitQty(1)</Mono>, steps by{' '}
        <Mono>order_multiple</Mono> and warns with <Mono>qtyProblem()</Mono>. Save sends{' '}
        <Mono>lines</Mono> and <Mono>add</Mono> together. Pepper's <Mono>change_purchase_order</Mono>{' '}
        searches with <Mono>supplier_id</Mono> and its card says when an add tops up a line already on
        the order. Tests: <Mono>api/test/po-add-items.test.mjs</Mono>.
      </P>
      <H3>Receiving</H3>
      <P>
        <Mono>POST /pos/:id/receive</Mono> (also on a received PO, to correct it): received quantity and
        status per line (<Mono>receiveStatusFor()</Mono> when not given), packaging / damage / quality,
        a chilled and a frozen probe reading (required when such goods arrived;{' '}
        <Mono>DELIVERY_TEMP_MAX</Mono> 8 / -15°C), accepted, corrective action. It upserts the
        venue's <Mono>fs_delivery_checks</Mono> row by <Mono>purchase_order_id</Mono>: vendor, items
        (name, qty received, pack, category, ordered, status, temp_c by storage),{' '}
        <Mono>product_temp_c</Mono> = chilled else frozen, <Mono>temp_ok</Mono>, and a notes summary, so
        the Food safety page, the H&S status tiles and the AI tools see it like any other delivery.
      </P>
      <H3>Invoices on receiving (migration 197)</H3>
      <P>
        <Mono>POST /api/ai/invoices/read</Mono> (<Mono>routes/documentRead.js</Mono>; Purchasing or
        Purchasing approval manage + <Mono>ai_assistant</Mono> view, Pepper on) takes the PO and up to 6
        photos / PDFs. <Mono>services/invoiceReadAi.js</Mono> sends them to the main model with the
        order's lines as refs <Mono>L1..</Mono> and the supplier's other active quotes as{' '}
        <Mono>C1..</Mono> (up to 300), structured output <Mono>INVOICE_SCHEMA</Mono>, through{' '}
        <Mono>askForJson()</Mono> (<Mono>services/aiJson.js</Mono>: allowance and daily share checked,
        usage counted). <Mono>toInvoice()</Mono> turns refs back into ids (a ref not on the lists is
        ignored), matches lines Pepper left unmatched by supplier code then exact name, converts prices
        to ex VAT when the invoice includes it, and gives each line <Mono>qty_packs</Mono> /{' '}
        <Mono>price_pack</Mono> in the matched pack. The files are stored and the reading saved in{' '}
        <Mono>purchase_invoices</Mono>; the response hides prices without <Mono>purchasing_setup</Mono>{' '}
        view (<Mono>invoiceView()</Mono>).
      </P>
      <P>
        The receive body gains <Mono>invoice_id</Mono>, per line <Mono>invoice_idx</Mono> (null clears the
        invoice fields) and <Mono>invoice_price</Mono> (taken only from people who see prices; otherwise
        the reading's price is used), and <Mono>add[]</Mono>: <Mono>{'{ item_id, quote_id | pack, received_qty, invoice_idx, invoice_price, status, note }'}</Mono>,
        lines with ordered qty 0 (<Mono>added_on_receipt</Mono>). An added line booked in again with 0 is
        deleted. Ordered prices and PO totals never change. The PO detail returns{' '}
        <Mono>invoices</Mono> (applied, without lines) and, for price viewers, <Mono>price_list</Mono>{' '}
        (<Mono>priceListRows()</Mono>: kind <Mono>price</Mono> = the line's quote differs from the invoice
        at this venue, <Mono>new</Mono> = no quote, <Mono>product</Mono> = a substitute whose code or name
        differs from the ordered quote's). <Mono>POST /pos/:id/price-list</Mono> (Purchasing setup manage):{' '}
        <Mono>company</Mono> sets the quote's price, <Mono>venue</Mono> the venue price,{' '}
        <Mono>add</Mono> makes a quote for the line's item (product name, code, pack from the body, else
        the invoice, else the ordered quote's pack; refused if the supplier already has it) and points
        the line at it, <Mono>usual</Mono> venue | company sets <Mono>inv_preferred</Mono>; history source{' '}
        <Mono>invoice</Mono> with <Mono>po_id</Mono>. The supplier's copy (<Mono>documentData()</Mono>)
        leaves added lines out. Admin: <Mono>components/purchasing/invoice.jsx</Mono> (InvoiceReader,
        readingToForm(), ExtrasSection, PriceListModal, InvoiceList) used by ReceiveForm and PoDetail;{' '}
        <Mono>GET /purchasing/venues/:id/catalog?all=1</Mono> also lists items without a supplier price.
        Tests: <Mono>api/test/invoice-reading.test.mjs</Mono>.
      </P>
      <H3>Deliveries without an order (migration 238)</H3>
      <P>
        <Mono>purchasing_settings</Mono> (one row per tenant, forced RLS; no row = off) holds{' '}
        <Mono>receive_without_order</Mono> <Mono>off | anyone | approvers</Mono>:{' '}
        <Mono>GET /api/purchasing/settings</Mono> (any purchasing view), <Mono>PUT</Mono> (Purchasing setup
        manage, keeps <Mono>updated_by</Mono>). <Mono>mayReceiveWithoutOrder(setting, levels)</Mono> in{' '}
        <Mono>services/purchasingSvc.js</Mono> is the one rule (anyone = Purchasing or Purchasing approval
        manage, approvers = Purchasing approval manage); <Mono>GET /meta</Mono> returns{' '}
        <Mono>receive_without_order</Mono> and <Mono>can_receive_without_order</Mono>.
      </P>
      <P>
        <Mono>POST /api/purchasing/venues/:venueId/deliveries</Mono>{' '}
        <Mono>{'{ supplier_id, received_date?, supplier_ref?, notes?, invoice_id?, lines: [arrived line], check }'}</Mono>{' '}
        (lines as the receive body&apos;s <Mono>add[]</Mono>, at least one; the supplier switched on; the day
        not after today and at most 31 days back, venue time) makes a purchase order with{' '}
        <Mono>no_order = true</Mono>, number from <Mono>nextPoNumber()</Mono>, delivery date = the day it
        arrived, never sent, then runs <Mono>receiveInto()</Mono>, the receive route&apos;s body moved into a
        function. For a <Mono>no_order</Mono> PO it differs: added lines get <Mono>qty = received_qty</Mono>{' '}
        and <Mono>added_on_receipt = false</Mono>; a correction sets each line&apos;s qty to what arrived and
        deletes lines at 0 (422 when none would be left); only OK or damaged (422 otherwise); a new{' '}
        <Mono>received_date</Mono> is checked and moves the PO&apos;s day and the delivery check&apos;s; the PO
        totals are recomputed as received × (invoice price ?? price), VAT at the invoice&apos;s rate ?? the
        line&apos;s; the delivery check&apos;s items have no <Mono>ordered</Mono> and its notes say booked in
        without an order. A price typed by a price viewer is stored as the line&apos;s{' '}
        <Mono>invoice_price</Mono>, so <Mono>priceListRows()</Mono> offers it. The order documents (
        <Mono>GET /pos/:id/file</Mono>) answer 409; send, mark sent, change, split and cancel already refuse a
        received PO. The order form&apos;s last order leaves <Mono>no_order</Mono> POs out.
      </P>
      <P>
        An invoice can be read before there is an order: <Mono>POST /api/ai/invoices/read</Mono> with{' '}
        <Mono>venue_id</Mono> + <Mono>supplier_id</Mono> instead of <Mono>po_id</Mono> (the same setting
        checked) sends no order lines and every active quote of the supplier as <Mono>C</Mono> refs, and
        stores <Mono>purchase_invoices</Mono> with <Mono>po_id</Mono> NULL (now nullable, with{' '}
        <Mono>venue_id</Mono> / <Mono>supplier_id</Mono> and a check that one or the other is set). The
        deliveries route takes it only while it has no PO and is the venue&apos;s and supplier&apos;s, then sets
        its <Mono>po_id</Mono>. <Mono>GET /purchasing/venues/:id/suppliers?all=1</Mono> also lists
        switched-on suppliers with no live price, with <Mono>prices</Mono> (how many).
      </P>
      <P>
        Admin: <Mono>components/purchasing/noOrder.jsx</Mono> (<Mono>PurchasingSettingsButton</Mono> on the
        Purchasing page header, <Mono>NoOrderSupplierModal</Mono>, <Mono>noOrderPo()</Mono> = the PO the form
        works on until saved), the Deliveries tab&apos;s <Mono>no-order-start</Mono> button, ReceiveForm with{' '}
        <Mono>po.no_order</Mono> (Delivery card with the day and their reference, no status chips, Save held by{' '}
        <Mono>nothing</Mono>), ExtrasSection&apos;s <Mono>onAdd</Mono> and hand-added lines (
        <Mono>manualExtra()</Mono>, <Mono>ManualLine</Mono>, <Mono>priceTyped()</Mono> in{' '}
        <Mono>invoice.jsx</Mono>; ItemPickModal&apos;s <Mono>newLabel</Mono> may be a function of the
        supplier&apos;s packs), <Mono>NoOrderBadge</Mono> on cards and the PO page (no documents, Arrived, Booked
        in without an order). Pepper&apos;s <Mono>purchase_orders</Mono> says <Mono>no_order</Mono>; it has no
        tool to book one in. Tests: <Mono>api/test/purchasing-no-order.test.mjs</Mono>; the fixtures switch it
        on and book one in for the tenant sweep.
      </P>
      <H3>Units and yield (migration 298, inventory phase 1)</H3>
      <P>
        <Mono>inv_items.yield_pct</Mono> (numeric(5,2), 1 to 100, default 100: the usable share after trimming),{' '}
        <Mono>recipe_unit</Mono> and <Mono>count_unit</Mono> (nullable text: a standard unit of the item&apos;s kind
        or one of its own units, checked by <Mono>checkUsualUnits()</Mono> against <Mono>unitChoices()</Mono>, 422{' '}
        <Mono>unit_unknown</Mono>), and <Mono>inv_item_units</Mono> (item, <Mono>name</Mono> unique per item by{' '}
        <Mono>lower(btrim(name))</Mono>, <Mono>base_qty</Mono> &gt; 0 in the item&apos;s base unit; forced RLS).
        Routes in <Mono>routes/inventory.js</Mono>, Purchasing setup manage: <Mono>POST /items/:id/units</Mono>{' '}
        <Mono>{'{ name, base_qty }'}</Mono> (a standard unit of the same kind or a name it has is refused by{' '}
        <Mono>unitNameProblem()</Mono>, 422 <Mono>unit_name</Mono>), <Mono>PATCH /units/:unitId</Mono> (a new name
        is written into the item&apos;s <Mono>recipe_lines.unit</Mono> and its usual units in the same transaction),{' '}
        <Mono>DELETE /units/:unitId</Mono> (409 <Mono>unit_in_use</Mono> with <Mono>recipes</Mono> while a recipe
        line gives the item in it). <Mono>loadItems()</Mono> returns <Mono>units</Mono>, <Mono>yield_pct</Mono>,{' '}
        <Mono>recipe_unit</Mono>, <Mono>count_unit</Mono> and <Mono>recipe_count</Mono>. An item in a recipe is
        switched off instead of deleted (<Mono>recipe_lines.item_id</Mono> has a plain foreign key), and its base
        unit can&apos;t change while it has own units or recipe lines. When it does change, a stored{' '}
        <Mono>recipe_unit</Mono> or <Mono>count_unit</Mono> of the old kind is cleared (one sent in the same PATCH is
        checked against the new kind), and received order lines in the old unit stop counting for Last paid and
        Average paid (<Mono>loadReceipts()</Mono>). The rules are <Mono>toBase()</Mono>,{' '}
        <Mono>unitChoices()</Mono> and <Mono>unitNameProblem()</Mono> in <Mono>shared/costing.js</Mono> (see
        Recipes and costing). Admin: <Mono>components/purchasing/units.jsx</Mono> (<Mono>UnitsCard</Mono> in the
        item drawer). The report subject Inventory items offers the yield.
      </P>
      <H3>Barcodes and stock on hand (migration 287, Pepper-first 8B3)</H3>
      <P>
        <Mono>inv_items.barcode</Mono> and <Mono>inv_quotes.barcode</Mono>: a GTIN-8, 12, 13 or 14, its check digit
        checked by <Mono>barcodeProblem()</Mono> (<Mono>shared/catalogue.js</Mono>, the rule dishes use) in{' '}
        <Mono>ItemBody</Mono> / <Mono>QuoteBody</Mono> (<Mono>Barcode</Mono> in <Mono>routes/inventory.js</Mono>);
        the own code stays <Mono>code</Mono> / <Mono>supplier_code</Mono>. <Mono>GET /venues/:id/catalog?search=</Mono>{' '}
        matches a whole barcode (item or live price; a price&apos;s barcode gives <Mono>matched_quote_id</Mono>);{' '}
        <Mono>quoteView()</Mono> carries <Mono>barcode</Mono>; Pepper&apos;s <Mono>pickItem()</Mono> and{' '}
        <Mono>find_inventory_items</Mono> match it.
      </P>
      <P>
        Stock on hand and counts (migration 287) moved to the stock area in inventory phase 4a (27 Nov 2026,
        migrations 305 to 307): the tables, <Mono>routes/stock.js</Mono>, <Mono>services/stockSvc.js</Mono>, the
        report subject (now <Mono>stock.on_hand</Mono>) and Pepper&apos;s stock tools are described under Stock.
        What stays here: <Mono>countToBase()</Mono> and <Mono>stockLow()</Mono> in <Mono>shared/procurement.js</Mono>{' '}
        (which re-exports <Mono>stockOnHand()</Mono> from <Mono>shared/stock.js</Mono>), and deliveries as the
        ledger&apos;s first move source (<Mono>received_qty</Mono> x the line&apos;s own <Mono>pack_base_qty</Mono>).
      </P>
      <P>
        Step 9b and 9c (no migration): <Mono>GET /stock/venues/:venueId</Mono> adds each item&apos;s{' '}
        <Mono>par_base</Mono> (the highest par on the venue&apos;s active order lists), <Mono>low</Mono>{' '}
        (<Mono>stockLow(onHand, par)</Mono> in <Mono>shared/procurement.js</Mono>; test id <Mono>stock-low</Mono>) and{' '}
        <Mono>quote_barcodes</Mono>. Pepper (in <Mono>ai/tools/stock.js</Mono> since phase 4a): <Mono>stock_on_hand</Mono> (read; items by name, code or barcode via{' '}
        <Mono>pickItem()</Mono>, or <Mono>low</Mono>; figures from that route, never recomputed) and{' '}
        <Mono>count_stock</Mono> (consequential; <Mono>countPlan()</Mono> checks units with <Mono>countToBase()</Mono>,
        then <Mono>POST /stock/venues/:venueId/counts</Mono>); <Mono>add_supplier_price</Mono> /{' '}
        <Mono>update_supplier_price</Mono> take <Mono>barcode</Mono> (<Mono>checkBarcode()</Mono>). Imports: the
        inventory import&apos;s <Mono>HEADERS</Mono> map Barcode, GTIN, EAN, UPC to <Mono>barcode</Mono> (the
        quote&apos;s on a row with a supplier, else the item&apos;s) and Item barcode to <Mono>item_barcode</Mono>;
        the price update&apos;s <Mono>PRICE_HEADERS</Mono> and <Mono>rows[].barcode</Mono> give{' '}
        <Mono>barcodes</Mono> (set on apply). A bad barcode (<Mono>fileBarcode()</Mono>) goes to{' '}
        <Mono>notes</Mono>, never <Mono>errors</Mono>: the row still imports. Pepper&apos;s{' '}
        <Mono>import_price_list</Mono> and <Mono>update_prices_by_code</Mono> pass <Mono>barcode</Mono> through.
      </P>
      <H3>Permissions and prices</H3>
      <P>
        Module group <Mono>purchasing</Mono>: <Mono>purchasing</Mono> (fill in orders, send, receive;
        operators manage by default), <Mono>purchasing_approve</Mono> (place orders and change, split or
        cancel them; see Approval) and <Mono>purchasing_setup</Mono> (inventory, suppliers, order
        lists; owner/admin). Restaurant staff see prices only with <Mono>purchasing_setup</Mono> view:
        the order form, PO list and detail strip <Mono>price</Mono> and totals otherwise (
        <Mono>showPrices()</Mono>, <Mono>hideMoney()</Mono>). The PO files always carry prices: they
        are the supplier's document. <Mono>GET /purchasing/meta</Mono> tells the admin what the
        person can do.
      </P>
      <H3>Import</H3>
      <P>
        <Mono>POST /inventory/import</Mono> takes a base64 CSV or Excel file (route body limit 6 MB, up
        to 5000 rows) with the template's headings (<Mono>GET /inventory/import-template</Mono>; aliases
        in <Mono>HEADERS</Mono>). Items match by item code, else name; suppliers by name; quotes by
        supplier code, else pack name and size. Each row is checked in full before anything is written,
        so a bad row adds nothing. <Mono>dry_run</Mono> runs everything and rolls back.
      </P>
      <H3>Admin</H3>
      <DataTable
        head={['Page', 'File']}
        rows={[
          ['/inventory', 'pages/Inventory.jsx: list, item drawer (item form with the same-name warning, supplier prices with star, venue prices, which price each venue orders, history), import, categories; the catalogue check, Update prices and Select (switch several off or on) from components/purchasing/catalogue.jsx.'],
          ['/suppliers', 'pages/Suppliers.jsx: cards, drawer with Supplier, Ordering, Per venue, Products.'],
          ['/purchasing/lists', 'pages/OrderLists.jsx: lists (drag), venues, items grouped by category (drag within a category), pars per venue in packs.'],
          ['/purchasing, /mobile/purchasing', 'pages/Purchasing.jsx, pages/mobile/MobilePurchasing.jsx around PurchasingApp in components/purchasing/ordering.jsx (Order and Deliveries tabs, OrderForm, PoDetail, ReceiveForm; approval: RequestCard, RequestPanel, ReviewModal mode request / place, SplitRequestModal, SendBackModal, SplitPoModal, DeliveryDayPicker). View in the URL: ?order=, ?po=, ?tab=deliveries.'],
        ]}
      />
      <P>
        Shared UI in <Mono>components/purchasing/shared.jsx</Mono> (<Mono>NumInput</Mono>,{' '}
        <Mono>QtyStepper</Mono>, <Mono>DayPicker</Mono>, <Mono>DateButton</Mono>, <Mono>Drawer</Mono>,{' '}
        <Mono>printHtml()</Mono>). The test data tool's past orders are now purchase orders (see Test Data Tools).
      </P>
      <H3>Order form lines</H3>
      <P>
        Each <Mono>OrderRow</Mono> shows the item, then the pack next to the quantity (<Mono>PackLabel</Mono>:
        the quote's <Mono>pack_name</Mono> large with <Mono>pack_size</Mono> under it, both from{' '}
        <Mono>packParts()</Mono> in <Mono>shared/procurement.js</Mono> via <Mono>quoteView()</Mono>). With more
        than one quote the pack is the button that opens the supplier switch. Supplier, price per pack, the
        last order line and the last quantity column (<Mono>LastQty</Mono>, from the item's <Mono>last</Mono>{' '}
        purchase order line; another pack name under the figure when the last order was a different pack) are
        off by default and switched on with <strong>Show</strong>, stored per device in{' '}
        <Mono>maca_purchasing_show</Mono> (<Mono>{'{ supplier, price, last, last_qty }'}</Mono>). Price is
        offered only when the order has <Mono>show_prices</Mono>; supplier is left out while grouped by
        supplier. Below <Mono>sm</Mono> Par and remove move beside the item name so the pack, quantity and last
        figure stay on one line.
      </P>
      <H3>Suggest (inventory phase 9a, migration 320)</H3>
      <P>
        <Mono>POST /api/purchasing/orders/:id/suggest</Mono> <Mono>{'{ supplier_id, delivery_date?, item_ids? }'}</Mono>{' '}
        (<Mono>SuggestBody</Mono>, strict): Purchasing or Purchasing approval manage, the order editable by the caller
        (<Mono>assertEditable()</Mono>: 409 once placed) and Stock view (403 without: it reads on hand). The supplier
        and the items must be the group&apos;s (404), the items lines of the order on that supplier&apos;s price (422{' '}
        <Mono>suggest_items</Mono>), the day today or later (422 <Mono>delivery_date</Mono>); left out, the day the
        order already asks the supplier for, else its next delivery. <Mono>supplierLines()</Mono> takes the list&apos;s
        active items and the lines added, each on the price it is pinned to or the venue&apos;s usual one (a line whose
        pinned price is switched off is left out), with the list&apos;s par at the venue; the stock area&apos;s{' '}
        <Mono>suggestFor()</Mono> (<Mono>services/stockForecastSvc.js</Mono>, the rule <Mono>shared/forecast.js</Mono>)
        works each out, the order&apos;s own purchase orders left out of on order. Each line with a suggestion (forecast
        or par) is kept on <Mono>supply_order_lines</Mono>: <Mono>suggested_qty</Mono> (packs of{' '}
        <Mono>suggestion_quote_id</Mono>), <Mono>suggested_base</Mono>, <Mono>suggestion_basis</Mono>,{' '}
        <Mono>forecast_base</Mono>, <Mono>window_from</Mono> / <Mono>window_to</Mono>, the working in{' '}
        <Mono>suggestion</Mono> (jsonb), <Mono>suggested_at</Mono> / <Mono>suggested_by</Mono> (the person as the stock
        documents keep them: the stock area&apos;s <Mono>stockPerson()</Mono>, the PIN person on a shared device), the
        latest one per line.
        A line Suggest makes is inserted with qty 0 and no pinned price; an existing line&apos;s{' '}
        <Mono>qty</Mono> and <Mono>quote_id</Mono> are never touched. The reply is sent after the transaction commits.
      </P>
      <P>
        <Mono>loadOrder()</Mono> gives each line its kept <Mono>suggestion</Mono> (<Mono>keptSuggestion()</Mono>:
        qty, base, basis, the delivery after next, when, by whom, summary, words) only with Stock view. The form
        (<Mono>components/purchasing/suggest.jsx</Mono>: <Mono>SuggestModal</Mono>, <Mono>SuggestMark</Mono>,{' '}
        <Mono>SuggestWorking</Mono>, <Mono>orderSuppliers()</Mono>; <Mono>OrderForm</Mono>&apos;s{' '}
        <Mono>suggested</Mono> map in <Mono>ordering.jsx</Mono>, <Mono>{'{ item_id: { qty, before } }'}</Mono> by{' '}
        <Mono>waitSuggestions()</Mono> in <Mono>shared/forecast.js</Mono>) flushes the autosave, asks, puts each
        suggestion that differs from its line on the line marked (<Mono>data-suggested</Mono>, not saved), and saves it
        only on OK, OK all or a change (<Mono>setQty()</Mono> takes the mark off, with what the line had before; so do{' '}
        <Mono>setQuote()</Mono>, which saves the amount on another price, and the server&apos;s lines after a basket or
        a split), as Pepper&apos;s quantities are kept; Put back restores the quantities before
        (<Mono>putBackQuantities()</Mono>), which the server has. A kept suggestion&apos;s Use is in the line&apos;s
        own packs (<Mono>suggestionPacks()</Mono>: the suggestion was in packs of <Mono>suggestion_quote_id</Mono>).
        The Suggest modal names the day the server works out for: the order&apos;s asked delivery day when today or
        later, else the next delivery. Placing and sending for approval wait while any is marked. The report subject{' '}
        <Mono>stock.suggestions</Mono> reads the kept columns (see Stock).
      </P>
      <H3>Returns and credit notes (inventory phase 9b, migration 321)</H3>
      <P>
        Goods sent back to the supplier from a delivery that was booked in (a purchase order <Mono>received</Mono>,
        with or without an order). The rule is <Mono>shared/returns.js</Mono>; the routes{' '}
        <Mono>routes/purchaseReturns.js</Mono> (mounted at <Mono>/api/purchasing</Mono> by{' '}
        <Mono>src/areas/purchasing.js</Mono>); loading, the supplier&apos;s copy and the email{' '}
        <Mono>services/purchaseReturnsSvc.js</Mono>; the stock move the stock area&apos;s <Mono>returnMoves</Mono>{' '}
        (<Mono>MOVE_SOURCES</Mono>, see Stock). Both tables have RLS enabled and forced.
      </P>
      <DataTable
        head={['Table', 'What it holds']}
        rows={[
          ['purchase_returns', 'number (per tenant, RT-00012: returnNumberLabel()), venue_id, po_id, supplier_id (RESTRICT, as purchase orders), status open | sent | credited | refused | cancelled, note (for the supplier, 500), returned_at (the stock move\'s moment: now, or up to RETURN_BACK_DAYS 14 back, never before the delivery was booked in), created_by (stockPerson(): the PIN person on a shared device), credit_expected / credit_vat (the lines\' lineAmounts() before VAT and the VAT), sent_at / sent_by / sent_via (email | driver | phone | website | print | other) / sent_to / send_error, credit_note_number (required when credited), credit_note_date, credit_amount (before VAT; null when recorded by someone who doesn\'t see prices), credited_at / credited_by, refused_at / refused_by / refuse_note, cancelled_at / cancelled_by / cancel_note, history ([{ action, by, at, note }]: emailed, marked_sent, credited, credit_changed, refused, cancelled).'],
          ['purchase_return_lines', 'return_id, po_line_id (the delivery\'s line; UNIQUE per return), item_id (SET NULL), copies of item_name, product_name, supplier_code, pack_label, base_unit, pack_base_qty (the line\'s own pack); qty (packs) and qty_base; price and vat_rate paid (paidPrice() / paidVatRate(): the invoice\'s where read, else the order\'s); credit_expected (qty x price, rounded); reason damaged | wrong_item | short_dated | quality | other; note (Other needs one).'],
        ]}
      />
      <DataTable
        head={['Route', 'What it does']}
        rows={[
          ['GET /pos/:id/returns', 'Any purchasing view. The delivery\'s returns (returnView()s) and, once received, its returnable lines (returnableLines(): received_qty over 0, an item still, returned_qty from returns not cancelled, left), each with returnPrefill() (a damaged line as damaged, a substituted one as wrong_item, all that is left, the receive note) and the price paid with prices; can_start, can_approve, show_prices.'],
          ['POST /pos/:id/returns', 'Purchasing Use or Purchasing approval Manage (canStart). StartBody { lines: [{ po_line_id, qty, reason, note }], note, returned_at? }. Locks the purchase order FOR UPDATE; 409 not_received unless received; 422 returned_at (returnedAtProblem()), 422 lines (returnLinesProblem(): a line of this delivery once, qty above 0 and no more than left, a reason, Other with a note). Number under an advisory lock (nextReturnNumber()). 201 with the view, sent after the transaction commits.'],
          ['GET /returns', 'Any purchasing view. ?venue_id (another group\'s venue is refused by the venue middleware) &supplier_id &po_id &status (csv) &owed=1 (open or sent) &overdue=1 (owed and returned_at at least CREDIT_OVERDUE_DAYS 14 before `at`, default now) &at &limit (500). { returns, can_start, can_approve, show_prices, overdue_days }.'],
          ['GET /returns/:id, GET /returns/:id/file?format=pdf | html', 'Any purchasing view. The file is the supplier\'s copy (returnPdf() through pdfDoc.js, returnHtml()): it always carries the prices, as a purchase order\'s file does.'],
          ['POST /returns/:id/send', 'Purchasing approval Manage. Checked in one transaction (can_email: open or sent), then emailReturn() after it commits: the venue\'s email provider, the supplier\'s email and cc list, the PDF attached; an open return becomes sent (sent_via email); a failure keeps send_error and answers 422 email_failed; no email address 422 no_email.'],
          ['POST /returns/:id/mark-sent', 'Purchasing approval Manage. MarkSentBody { via, sent_at? } (not in the future, the last 14 days, not before returned_at): an open return only (409 otherwise).'],
          ['POST /returns/:id/credit', 'Purchasing approval Manage. CreditBody { credit_note_number, credit_note_date? (not after today at the venue), credit_amount? }: open, sent, refused or credited (a correction; credit_changed in the history). An amount from someone without purchasing prices is 403 prices; left out, the stored amount stays.'],
          ['POST /returns/:id/refuse', 'Purchasing approval Manage. RefuseBody { note } (required): open or sent. The stock move stays.'],
          ['POST /returns/:id/cancel', 'canStart. CancelBody { note? }: an open return by whoever may start one; a sent one only with Purchasing approval (403 approval); never credited or refused (409). Its moves are gone (status cancelled is left out of returnMoves).'],
        ]}
      />
      <P>
        What may be done is <Mono>returnActions(ret, {'{ canStart, canApprove }'})</Mono> (can_email, can_mark_sent,
        can_credit, can_refuse, can_cancel), on every view and checked by each route (<Mono>mustAllow()</Mono>, 409{' '}
        <Mono>return_status</Mono>). Money (each line&apos;s price, vat_rate and credit_expected, the return&apos;s credit
        expected, VAT, total, credit_amount and credit_difference) is left out of <Mono>returnView()</Mono> without
        purchasing prices. <Mono>receiveInto()</Mono> (Correct the delivery) refuses 422 <Mono>returned</Mono> when a
        line would be booked in below what its returns not cancelled take back (<Mono>returnedOnPo()</Mono>). The{' '}
        <Mono>purchasing</Mono> module has a Use level since this phase (starting returns); every ordering route
        still needs Manage, and Today&apos;s purchasing tasks need Manage too (<Mono>taskLevel()</Mono> in{' '}
        <Mono>services/opsToday.js</Mono>). Today&apos;s <Mono>credit_overdue</Mono> (the purchasing source, through{' '}
        <Mono>GET /returns?overdue=1</Mono>) belongs to Purchasing approval (<Mono>moduleOf()</Mono>). Admin:{' '}
        <Mono>components/purchasing/returns.jsx</Mono> (lazy from <Mono>ordering.jsx</Mono>): <Mono>PoReturns</Mono>{' '}
        under a booked-in delivery&apos;s lines, <Mono>StartReturnModal</Mono>, <Mono>ReturnModal</Mono>,{' '}
        <Mono>ReturnsTab</Mono> (<Mono>?tab=returns&amp;return=</Mono>; the nav record&apos;s tabs order, deliveries,
        returns). Pepper: <Mono>start_return</Mono> (consequential, needs Use, through these routes). Reports:{' '}
        <Mono>purchasing.returns</Mono>, <Mono>purchasing.return_lines</Mono>, the starter Credits still owed.
      </P>
    </section>
  )
}
