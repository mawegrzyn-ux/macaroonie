// src/pages/docs/web-ordering.jsx
// The Docs page's "Web Ordering" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'web-ordering'
export const label = 'Web Ordering'
export const order = 320

export function Section() {
  return (
    <section id="web-ordering" data-doc="">
      <H2>Web Ordering</H2>
      <P>
        Collection orders from the tenant website (migration 122) with pluggable payment
        gateways. Modules <Mono>web_orders</Mono> (board, actions, sold out, pause) and{' '}
        <Mono>web_ordering_setup</Mono> (settings), group <Mono>web_ordering</Mono>. The{' '}
        <Mono>orders</Mono> table has a <Mono>channel</Mono> column (<Mono>web</Mono> |{' '}
        <Mono>pos</Mono> | <Mono>table_qr</Mono>) so the POS and table ordering can reuse it.
      </P>
      <H3>Tables</H3>
      <DataTable
        head={['Table', 'Notes']}
        rows={[
          ['ordering_settings', "One row per venue (PK venue_id): is_enabled, is_paused + pause_message, hours jsonb [{ day 0-6 (0 = Sunday), windows: [{ open, close }] }], menu_ids uuid[] (which menus are online, written by Menus > Menu times since migration 230; the column menu_schedules went with that migration, see Menu times online below), allow_asap, lead_time_mins, slot_interval_mins, max_orders_per_slot (NULL = no limit), max_days_ahead, min_order_pence, auto_accept, order_type_ids jsonb { collection, delivery, eat_in } + revenue_stream_id (migration 170: the sale context for tax and the kitchen; a fulfilment with no type uses the tenant's type of that name, fillOrderTypes() in loadSettings()), tips_enabled + tip_percents int[], payment_methods text[] (gateway keys, checkout order), collection_instructions, confirmation_note, hours_extension jsonb (migration 223: today's hours later than usual, see Collection slots). No row = defaults (disabled); GET fills hours from loadOpeningHours()."],
          ['ordering_item_availability', "Per-venue sold out: (venue_id, item_id, sold_out_until). NULL until = until turned back on. item_id has no FK because menu saves re-insert items (with the same ids since migration 121)."],
          ['orders', "service_date (venue-local collection day) + order_number (1, 2, 3 per venue per day, UNIQUE) under pg_advisory_xact_lock on venue + day. public_token is the guest key (status page, like manage_token). status: pending_payment, placed, accepted, preparing, ready, completed, rejected, cancelled, expired. promised_at is the ready time (ASAP or the chosen slot). Money in pence: subtotal, tip, total, vat (VAT-inclusive), paid, refunded; payment_status unpaid | pending | paid | failed | partially_refunded | refunded."],
          ['order_items', "Copies name, options [{ group, label, price_pence, mode }], unit and line totals, vat_rate and vat_pence at the time of ordering. menu_item_id is a plain uuid (no FK), for reports only."],
          ['order_events', "Status history and audit: type status | payment | refund | time | note, from/to status, detail jsonb, actor (staff email, guest, system)."],
          ['order_payments', "One row per payment attempt: gateway (a gateway key, or cash / card_terminal for counter payments), gateway_ref (UNIQUE per gateway), amount, refunded, status, raw jsonb."],
          ['platform fee', "tenants.ordering_fee_percent (0-20, platform admin only: Platform page, PATCH /api/platform/tenants/:id). Each order stores platform_fee_percent and platform_fee_pence = subtotal x percent (tips excluded) when it is created. Shown in the report. The Stripe gateway will pass it as application_fee_amount on online payments; pay-at-counter fees are for invoicing."],
          ['menu additions', "menu_items.is_orderable, min_order_qty (migration 133: NULL or 2-99; loaded as item.min_qty by loadOrderingMenu(); priceBasket() adds a min_qty error per dish when the qty over all its lines is below it; the guest page's openItem() starts at the shortfall and changeQty() removes a line rather than go below); menu_variant_groups.price_mode (base | extra), min_select, max_select. email_log.order_id."],
        ]}
      />
      <H3>Menu times online (migrations 130, 230)</H3>
      <P>
        Which menus are online and when each is on are set on Menus &gt; Menu times (see Menus &gt;
        Menu times), not here. <Mono>loadSettings()</Mono> fills <Mono>settings.menu_schedules</Mono>{' '}
        from <Mono>webSchedules(tx, venueId)</Mono> (<Mono>services/menuTimesSvc.js</Mono>):{' '}
        <Mono>{'{ menuId: schedule }'}</Mono> for the menus whose Website cell gives them times
        (the menu&apos;s own, or the website&apos;s own); a menu with none is on whenever ordering is
        open. The <Mono>ordering_settings.menu_schedules</Mono> column was dropped by migration 230,
        which moved its schedules into <Mono>menu_times</Mono> rows (the menu&apos;s times, the website
        following them, kiosks and tills at any time, as they were). A schedule is{' '}
        <Mono>shared/menuSchedule.js</Mono>&apos;s:{' '}
        <Mono>{'{ from, until, times: [{ days: [0-6], start, end }] }'}</Mono> (0 = Sunday). No
        times = all day on its dates; no schedule = always on. <Mono>menuOnAt()</Mono> includes a
        window&apos;s end minute (a 15:00 slot is in 11:00–15:00, like ordering hours), windows that
        only touch don&apos;t overlap, and a window must end after it starts (no overnight). Two online
        menus on at once are allowed now (both are listed); Menu times shows them as a note.{' '}
        <Mono>GET /api/orders/settings/:venueId</Mono> returns <Mono>online_menus</Mono>{' '}
        <Mono>[{'{ id, name, times }'}]</Mono> (in <Mono>menu_ids</Mono> order, the times in words or
        null) and leaves <Mono>menu_ids</Mono> out of <Mono>settings</Mono>;{' '}
        <Mono>PUT /settings/:venueId</Mono> no longer takes menus, so an older copy of the page
        can&apos;t put a menu back online.
      </P>
      <P>
        <Mono>loadOrderingMenu(tx, venue, settings, {'{ dates, now }'})</Mono>: with dates (the
        ordering dates) a menu on none of them is left out; each menu carries{' '}
        <Mono>schedule</Mono> (scheduleLabel() text or null) and <Mono>on_now</Mono>. It always
        returns <Mono>itemMenus</Mono> (dish id to menu ids). <Mono>createOrder()</Mono> calls{' '}
        <Mono>itemOffAt()</Mono> at the promised time and returns 422{' '}
        <Mono>slot_unavailable</Mono> naming the dish. The guest page opens on the first menu on
        now, shows the schedule under the menu tabs, passes the basket to /slots, and resets a
        picked time that is no longer offered.
      </P>
      <H3>Prices: one implementation</H3>
      <P>
        <Mono>shared/orderPricing.js</Mono> (itemChoices, priceLine, priceBasket, vatIncluded)
        prices every basket. The server runs it in <Mono>orderSvc.createOrder()</Mono> against
        the live menu; the guest page imports the same file from{' '}
        <Mono>/order-api/pricing.js</Mono> only to show totals. A dish's choices: its ad-hoc
        variants (one required base choice, option ids <Mono>v:label</Mono> because variant
        rows are re-inserted on every menu save) plus attached variant groups. Unit price =
        chosen base options (or the dish's own price when none) + chosen extras. A base option
        with no price counts as the dish's own price. The menu's variant display settings apply
        via <Mono>variantRules(menu)</Mono>, passed to <Mono>itemChoices()</Mono> by{' '}
        <Mono>loadOrderingMenu()</Mono>: <Mono>hide_unpriced_variants</Mono> drops null/£0
        options from the choices (so the server rejects them too),{' '}
        <Mono>hide_zero_priced_variants</Mono> sets <Mono>hide_zero_price</Mono> on each choice
        and <Mono>optionPriceText()</Mono> shows no price for £0 options. Kiosks follow the same
        settings, and so do the tills (1 Nov 2026; until then tills showed staff every option):{' '}
        <Mono>tillMenuData()</Mono> puts the menu's <Mono>variant_rules</Mono> on each dish for every device
        (guest loads add only the pictures and words) and <Mono>posChoices()</Mono> passes them to{' '}
        <Mono>itemChoices()</Mono>. VAT comes from the dish's
        tax levels (dish, section, menu) resolved by <Mono>taxFor()</Mono> (<Mono>shared/tax.js</Mono>)
        for the order's context, <Mono>orderContext(venueId, settings, fulfilment)</Mono>: the order
        type Ordering setup gives that fulfilment and its revenue stream. <Mono>loadOrderingMenu()</Mono>{' '}
        sets each item's <Mono>vat_rate</Mono>; orders store <Mono>order_type_id</Mono> and{' '}
        <Mono>revenue_stream_id</Mono>. Tips are a percentage from{' '}
        <Mono>tip_percents</Mono>, outside VAT.
      </P>
      <H3>GDPR consent (migration 125)</H3>
      <P>
        Checkout has a required "order-only use of my details" box (it covers allergy notes,
        which are health data) and an optional, unticked newsletter box.{' '}
        <Mono>loadPrivacy(tx, tenantId)</Mono> in <Mono>orderSvc.js</Mono> owns the wording
        (business name = <Mono>tenant_site.brand_name</Mono>, then <Mono>site_name</Mono>, then{' '}
        <Mono>tenants.name</Mono>) and finds the privacy policy link (a published tenant-level{' '}
        <Mono>website_pages</Mono> row with slug <Mono>privacy</Mono>, else a legal page whose slug
        contains "privacy"). <Mono>GET /order-api/venues/:id</Mono> returns it as{' '}
        <Mono>privacy</Mono> for the page to show; <Mono>createOrder()</Mono> records the same text.
        <Mono>OrderBody.data_consent</Mono> must be <Mono>true</Mono> (400 otherwise).
      </P>
      <DataTable
        head={['Column', 'Notes']}
        rows={[
          ['orders.data_consent_at', "When the guest agreed to the order-only use (order creation time)."],
          ['orders.consent', "jsonb { data: { text, at }, marketing: { text, at } | null, policy_url } as shown at checkout. Cleared to {} on anonymise."],
          ['customers.marketing_opt_in (+ _at, _source, marketing_opt_out_at)', "Newsletter status. Set on order creation when the box is ticked (source web_order); an unticked box never clears it. Cleared by POST /customers/:id/unsubscribe or anonymise. GET /customers?offset=…&newsletter=1 lists subscribers."],
        ]}
      />
      <H3>Ordering page and block (migration 126)</H3>
      <P>
        <Mono>website_pages.system_key</Mono> (<Mono>'order'</Mono>, unique per tenant, tenant-level; also{' '}
        <Mono>'loyalty'</Mono> since migration 214, see Loyalty)
        marks the built-in ordering page. Migration 126 seeds one per tenant with a website;{' '}
        <Mono>ensureTenantSite()</Mono> calls <Mono>ensureSystemPages()</Mono> (<Mono>services/systemPages.js</Mono>) for new sites. The
        pages API ignores slug / kind / is_published changes on it and refuses to delete it,
        unpublish it or make it a modal (422). <Mono>publishSvc</Mono> includes{' '}
        <Mono>system_key</Mono> in the snapshot. The <Mono>online_ordering</Mono> block picks its
        venue from: the route&apos;s <Mono>orderView</Mono>, then <Mono>data.venue_id</Mono>, then the
        location page&apos;s venue, then the only ordering venue, else a location picker, using{' '}
        <Mono>ordering_venues</Mono>, which <Mono>loadOrRender404()</Mono> attaches to every site
        bundle. Block data: <Mono>heading</Mono>, <Mono>hide_title</Mono> (hides the venue name),
        <Mono> venue_id</Mono>, plus the display options below. One per page: the app&apos;s script finds <Mono>#mo-app</Mono> by id.
        LinkPicker, sitemap and llms.txt link the page as <Mono>/order</Mono>.
      </P>
      <H3>Online ordering block options</H3>
      <P>
        <Mono>blocks/online_ordering.eta</Mono> turns the block data into{' '}
        <Mono>orderOptions</Mono> for <Mono>shared/ordering.eta</Mono>, which has a default for each
        (the status page passes none). Colours are theme role names mapped to{' '}
        <Mono>var(--c-*)</Mono>; ordering.eta only lets a <Mono>var(--c-x)</Mono> or #hex through.
        Layout switches are classes on <Mono>#mo-root</Mono> (<Mono>mo--modal-basket</Mono>,{' '}
        <Mono>mo--static-basket</Mono>, <Mono>mo--static-nav</Mono>); values are CSS variables on{' '}
        <Mono>.mo</Mono> and <Mono>.mo-sheet-back</Mono> (<Mono>--mo-offset</Mono>,{' '}
        <Mono>--mo-basket-bg</Mono>, <Mono>--mo-basket-fg</Mono>), so the pop-ups appended to body get
        them too. The sticky element is <Mono>.mo-basket-col</Mono> (the grid item), not the basket
        inside it, and the search box and tabs share one sticky <Mono>.mo-nav</Mono>. Search typing
        redraws only <Mono>#mo-nav-tabs</Mono> and <Mono>#mo-menu-body</Mono> so the box keeps focus.
        Category jumps and the scroll highlight use <Mono>barBottom()</Mono> (offset + bar height).
      </P>
      <DataTable
        head={['Block data', 'Default', 'Effect']}
        rows={[
          ['title_text, subtitle_text, hide_subtitle', "'' / '' / false", '{venue} and {address} are filled in; a new line in the subtitle becomes a line break.'],
          ['basket_mode', "'side'", "'modal': no basket column; the floating basket bar shows at every width."],
          ['basket_sticky', 'true', 'Sticky basket column (side mode), max-height with its own scroll.'],
          ['basket_bg, basket_text', "''", 'Theme roles. With a text colour the basket gets .mo-fg: muted text inherits and buttons invert to the basket colours.'],
          ['show_vat', 'true', 'Includes VAT under the basket subtotal and the checkout total.'],
          ['sticky_nav, sticky_offset', 'true, 0', 'Sticky .mo-nav at top: --mo-offset; the basket column sticks at offset + 16. sticky_offset > 0 sets --mo-offset; at 0 the page script measures the site header (findTopBars(): header, nav, .mc-header and body children that are sticky/fixed at top 0-8px, at least half the screen wide, under 40% of its height) and re-measures on resize (ResizeObserver).'],
          ['show_search', 'false', 'Accent-insensitive match on name, native name and description across all menus.'],
          ['search_style', "'bar'", "bar | icon_phone | icon. Icon: .mo-navrow with an absolute .mo-search-btn over the tab strip (tabs padded past it, ::before/::after mask what scrolls under); data-open-search swaps the row for .mo-search--open (state.searchOpen) via redrawNav(); data-close-search / Escape run closeSearch(). icon_phone = max-width 900px (phoneMq), re-rendered when the width crosses it."],
          ['highlight_favourites, favourite_label', "false, ''", 'is-fav card class and badge (default text House favourite) from the item featured flag.'],
          ['favourite_bg, favourite_text', "'', ''", 'Theme roles for the is-fav card: --mo-fav-bg / --mo-fav-fg; a text colour adds mo--fav-fg so the badge and description inherit it.'],
          ['item_notes', 'true', 'false hides the per-dish note field in the dish sheet.'],
        ]}
      />
      <P>
        Sticky only works because <Mono>head.eta</Mono> sets <Mono>overflow-x: clip</Mono> on{' '}
        <Mono>html, body</Mono>. With <Mono>hidden</Mono> on both, body became a scroll container and no
        sticky element on a tenant site worked, including the header block&apos;s sticky header.
      </P>
      <P>
        Dish cards already in the basket get <Mono>is-in</Mono> (primary outline) and a{' '}
        <Mono>.mo-in-basket</Mono> badge with the quantity summed over every basket line for that dish
        (<Mono>inBasket()</Mono> in <Mono>itemCardHtml()</Mono>). Every basket change calls{' '}
        <Mono>draw()</Mono>, so the cards update with it; no option, always on.
      </P>
      <P>
        Add in the dish sheet flies the dish&apos;s picture into the basket: <Mono>pictureSpot()</Mono>{' '}
        takes the sheet&apos;s <Mono>.mo-hero</Mono> while more than 30% of it shows in the sheet, else a
        square (at most 160 px) over the Add button (a combo&apos;s last page has no picture), measured
        before the sheet closes; after <Mono>draw()</Mono>, <Mono>flyToBasket(src, from)</Mono> puts an{' '}
        <Mono>img.mo-fly</Mono> (fixed, on <Mono>document.body</Mono>) there and animates it (Web
        Animations, 700 ms) to <Mono>basketSpot()</Mono>: the words of the side basket&apos;s{' '}
        <Mono>.mo-basket-title</Mono> (a Range around its text, not the whole heading) or the{' '}
        <Mono>.mo-bar .mo-btn</Mono> on phones and in pop-up basket mode, whichever shows in the
        window; on landing the copy goes and the spot gets a <Mono>scale(1.08)</Mono> bounce (the title
        from its left edge). No dish picture, no spot in sight or <Mono>prefers-reduced-motion</Mono>:
        no flight.
      </P>
      <H3>Collection slots</H3>
      <P>
        Computed, never stored (<Mono>computeSlots()</Mono>): slot times every{' '}
        <Mono>slot_interval_mins</Mono> across each window (close time included), available
        when at least <Mono>lead_time_mins</Mono> away and under{' '}
        <Mono>max_orders_per_slot</Mono>. Orders count against the first slot at or after
        their promised time; active statuses plus unpaid orders under 30 minutes old.
        ASAP: today, while a window is open (or opens within the lead time), promised at the
        later of now + lead time and the opening, rounded up to 5 minutes. Venue-local times
        go through <Mono>zonedToUtc()</Mono> / <Mono>localParts()</Mono> (Intl, DST-safe).
      </P>
      <P>
        A day&apos;s windows come only from <Mono>dayWindows(settings, date)</Mono> (sorted,{' '}
        <Mono>HH:MM</Mono>). Migration 223&apos;s <Mono>ordering_settings.hours_extension</Mono>{' '}
        (<Mono>{'{ date, until, open, by, at }'}</Mono>, set by <Mono>POST /api/orders/hours/:venueId</Mono>{' '}
        from the board&apos;s clock button) applies on its date only: the last window closes at{' '}
        <Mono>until</Mono>, or a day with no windows opens at <Mono>open</Mono> (when it was set,
        to 5 minutes) until <Mono>until</Mono>. <Mono>extensionFor()</Mono> checks a new one (later
        than now and than the usual close, a real time up to 23:59: windows don&apos;t cross
        midnight); a stored value that isn&apos;t a real time is ignored. Nothing clears it the next
        day: another date simply doesn&apos;t match. <Mono>todayHours()</Mono> is the board&apos;s{' '}
        <Mono>ordering.hours_today</Mono> (<Mono>usual</Mono>, <Mono>windows</Mono>,{' '}
        <Mono>extended</Mono>); Ordering setup&apos;s save leaves the column alone. Admin:{' '}
        <Mono>HoursButton</Mono> / <Mono>HoursModal</Mono> / <Mono>HoursNotice</Mono> in{' '}
        <Mono>components/orders/shared.jsx</Mono>.
      </P>
      <H3>Payment gateways</H3>
      <P>
        <Mono>api/src/services/paymentGateways/</Mono>. The order flow only calls the gateway
        interface, documented in <Mono>index.js</Mono>: <Mono>start()</Mono> returns{' '}
        <Mono>none</Mono> (pay later), <Mono>succeeded</Mono> or <Mono>pending</Mono> with a
        public <Mono>client</Mono> object for the browser; optional{' '}
        <Mono>confirmFromClient()</Mono>, <Mono>parseWebhook()</Mono> (route{' '}
        <Mono>POST /webhooks/payments/:gateway</Mono>, raw body for signature checks),{' '}
        <Mono>refund()</Mono>, <Mono>cancel()</Mono>, <Mono>isAvailable(ctx)</Mono>. Shipping:{' '}
        <Mono>pay_at_venue</Mono>, <Mono>stripe</Mono> (below) and <Mono>demo</Mono> (a pretend card payment
        for pre-production; it trusts the browser, which a real gateway must never do). The context a gateway
        sees comes only from <Mono>paymentContext(venue)</Mono> in <Mono>index.js</Mono>
        ({'{ tenant: { id, stripe_account_id, stripe_ready } }'}): <Mono>createOrder()</Mono>,{' '}
        <Mono>startPayment()</Mono> (a retry) and <Mono>GET /order-api/venues/:id</Mono>{' '}
        (<Mono>checkoutGateways()</Mono>) all load it, so a method guests can&apos;t use is never offered or
        started (422 &quot;That payment method is not available now&quot;).
      </P>
      <H3>Card payments with Stripe (Stripe Connect)</H3>
      <P>
        Migration 215. One Stripe platform account (Macaroonie&apos;s); each restaurant group connects its own
        Stripe account (Standard, country GB) and charges are <em>direct charges</em> on it: the group is the
        merchant of record, Stripe&apos;s fees are on its account, and the platform&apos;s online ordering fee
        (<Mono>orders.platform_fee_pence</Mono>, <Mono>tenants.ordering_fee_percent</Mono>) is taken as{' '}
        <Mono>application_fee_amount</Mono> (never the whole total). Every call is the platform&apos;s key with a{' '}
        <Mono>Stripe-Account</Mono> header (<Mono>stripeCall()</Mono> in{' '}
        <Mono>services/stripeConnect.js</Mono>, base <Mono>STRIPE_API_URL</Mono>, Stripe-Version 2024-06-20;
        network errors and 5xx are 502).
      </P>
      <DataTable
        head={['Piece', 'What']}
        rows={[
          ['Platform keys', "platform_secrets stripe_secret_key, stripe_publishable_key, stripe_webhook_secret (sealed with vault seal(); env fallback STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_CONNECT_WEBHOOK_SECRET; the saved key wins). platformKeys() caches 15 s per process; savePlatformKeys() checks the secret with GET /v1/account, the publishable key's shape and that both are the same mode, then saves (null removes). platformReady() = a secret (sk_ / rk_) and a publishable key of the same mode. Platform page > Payments tab (components/platform/StripeKeysCard.jsx), GET/PUT /api/platform/stripe (platform admins); the reply never holds a key, only hints, the mode and the webhook address (officeOrigin() + /webhooks/payments/stripe)."],
          ['The group\'s account', "tenants.stripe_account_id + stripe_charges_enabled, stripe_details_submitted, stripe_account_name, stripe_checked_at, stripe_domains. POST /api/stripe/connect { return_url } (owner/admin + manage on web_ordering_setup or pos_setup): makes the account the first time (POST /v1/accounts, idempotency key per tenant per minute, so a double click makes one but connecting again after Unlink makes a new one) and returns an account link (account_onboarding); return_url must be https on the root domain (localhost outside production, safeReturnUrl()). GET /api/stripe (view, stripeView()), POST /api/stripe/refresh (GET /v1/accounts/:id; 403 / 404 = the account was disconnected: charges off, 422), DELETE /api/stripe (forget the link; nothing is deleted at Stripe)."],
          ['Apple Pay / Google Pay', "refreshAccount() registers the group's site addresses (subdomain, staging, a verified custom domain) with POST /v1/payment_method_domains on the account once charges are on, recorded in stripe_domains so each goes once."],
          ['Gateway', "paymentGateways/stripe.js: isAvailable = tenant.stripe_ready (account linked and charges_enabled, platform ready). start() makes a PaymentIntent on the account (automatic_payment_methods, metadata.order_id / tenant_id / venue_id / order_number, application fee) and returns client { type: 'stripe', publishable_key, account, client_secret, amount_pence, currency }. confirmFromClient() reads the PaymentIntent back (never the browser's word; an order_id that differs = failed). piStatus(): succeeded, canceled -> cancelled, requires_payment_method with last_payment_error -> failed, else pending. refund() with refund_application_fee and an idempotency key per payment, refunded so far and amount; cancel() cancels the intent."],
          ['Webhook', "Connect endpoint on the platform account, address POST /webhooks/payments/stripe, events payment_intent.succeeded / payment_failed / canceled, account.updated, account.application.deauthorized. parseWebhook() checks Stripe-Signature (t=, v1= HMAC-SHA256 of t.body with the webhook secret, 300 s tolerance; verifySignature()), applies account events to the tenant (applyAccountEvent()), hands booking deposits (metadata.kind deposit) to depositWebhook() in services/depositSvc.js, and passes only PaymentIntents with metadata.order_id on as order payments (card machine sales come to the same endpoint). applyPaymentResult() is idempotent, so a webhook after the page confirmed does nothing."],
          ['Guest page', "views/site/shared/ordering.eta: when the payment's client.type is stripe, draw() hands over to showStripe(), which loads https://js.stripe.com/v3/ once (loadStripeJs()), mounts the Payment Element once per payment (draw() never redraws it, or what the guest typed is lost) with colorPrimary from --c-primary, and confirmPayment({ redirect: 'if_required', return_url: status page ?pay=<payment id> }). Success or processing: POST .../payments/:id/confirm, then the status page. A bank redirect comes back to the status page, which confirms the ?pay= payment, cleans the address and loads. The status page offers the same form while an order is still pending_payment."],
          ['Admin', "components/orders/StripeAccountCard.jsx (useStripeAccount(); Connect / Continue on Stripe, Check again (automatic when over 5 minutes old and after ?stripe=return), Stripe dashboard, Unlink with a confirm; the platform-not-ready note): in Ordering setup under Payment methods and in Store tech > Card machines' account window."],
        ]}
      />
      <H3>Flow</H3>
      <DataTable
        head={['Step', 'Code']}
        rows={[
          ['Guest places order', "POST /order-api/venues/:venueId/orders (OrderBody). createOrder(): settings, gateway, slot check and order number under the advisory lock, server pricing, min order, customer upsert, INSERT as pending_payment. Then startPayment() outside the transaction (the gateway may call a provider)."],
          ['Payment result', "none: placeOrder() at once. pending: order_payments row + client action. applyPaymentResult() is idempotent; a second success for an already-paid order (a retry and a late earlier attempt both going through) is refunded automatically, never counted twice. A failed payment leaves the order pending_payment; POST /orders/:token/pay starts a new attempt."],
          ['Placed', "placed (or accepted when auto_accept). WS broadcast order.created to the venue room; order_confirmation email."],
          ['Staff', "changeStatus() with TRANSITIONS; accept can push promised_at by prep minutes. Reject/cancel of a paid order refunds through refundOrder(). markPaid() records cash / card_terminal. refundOrder() refunds online payments through their gateway and records counter refunds."],
          ['Expiry', "expireStaleOrders() runs with the hold sweep (jobs/hold-sweep.js, every 60 s): pending_payment older than 30 minutes becomes expired, pending payments are cancelled through the gateway."],
          ['Emails', "notificationQueue job order_email -> jobs/orderEmailWorker.js: order_confirmation, order_ready, order_cancelled (built-in templates, same venue email provider as bookings via emailCredentials()). Logged to email_log with order_id."],
        ]}
      />
      <H3>Routes</H3>
      <DataTable
        head={['Route', 'Notes']}
        rows={[
          ['GET /order-api/venues/:id', "Menu (publicItem: prepared choices, no raw variant rows; keeps vat_rate so the page can show Includes VAT, and featured = menu_items.is_featured), ordering settings, dates, payment methods. 404 when ordering is off."],
          ['GET /order-api/venues/:id/slots?date=&items=', "computeSlots(). items (the basket's dish ids, comma separated) drops times when a dish is not on any of its menus (isOn predicate from itemOffAt()); off_menu counts the dropped times, and ASAP is off when its promised time is dropped."],
          ['POST /order-api/venues/:id/quote', "priceBasket() for display."],
          ['POST /order-api/venues/:id/orders', "Place an order; returns token, status and the payment client action."],
          ['GET /order-api/orders/:token; POST .../pay; POST .../payments/:id/confirm', "Guest status, retry, browser confirmation."],
          ['/api/orders (admin)', "GET / (board: venue + day), GET /:id (events, payments), POST /:id/status | promised | mark-paid | refund, GET|PUT /settings/:venueId, POST /pause/:venueId (web_orders manage, no setup rights needed), POST /hours/:venueId ({ until: 'HH:MM' | null }, web_orders manage: today's hours later than usual, migration 223), GET|PUT /availability/:venueId[/:itemId], GET /report, GET /transactions[.csv] (see Transactions below), GET /gateways."],
          ['Site', "/order (sole ordering venue, or a location picker) and /locations/:slug/order render the tenant's built-in ordering page (website_pages.system_key = 'order', migration 126) through page.eta, passing orderView/orderVenue(s); its online_ordering block (blocks/online_ordering.eta) includes shared/ordering.eta. Sites published before 126 use DEFAULT_ORDER_PAGE (services/systemPages.js) until republished. /p/<slug> of that page redirects to /order. /order/status/:token still renders each template's order.eta around shared/ordering.eta."],
        ]}
      />
      <H3>Admin</H3>
      <P>
        <Mono>pages/Orders.jsx</Mono> (board, report, transactions), <Mono>pages/OrderingSettings.jsx</Mono>,{' '}
        <Mono>pages/mobile/MobileOrders.jsx</Mono>, all built on{' '}
        <Mono>components/orders/shared.jsx</Mono>: OrderBoard, OrderDetailModal,
        AvailabilityModal, PauseButton, useRealtimeOrders (venue WebSocket), printTicket
        (80mm browser print). Menus.jsx sends is_orderable / vat_rate_* in its save payload;
        VariantGroupsManager sends price_mode / min_select / max_select. A base option's price comes
        only from <Mono>basePrice()</Mono> in <Mono>shared/orderPricing.js</Mono>: empty or £0 = none, the
        dish's own price stands (used by <Mono>priceChoiceSet()</Mono>, <Mono>fromPrice()</Mono>,{' '}
        <Mono>priceVaries()</Mono> (only when the base prices differ), <Mono>isPriced()</Mono>,{' '}
        <Mono>optionPriceText()</Mono>, the till's <Mono>priceChoices()</Mono> and the menu screens'{' '}
        <Mono>dishPriceText()</Mono>).
        <Mono> components/orders/ScheduleEditor.jsx</Mono> (date range + times of day) is shared by
        Ordering setup and Promotions.
      </P>
      <P>
        GloriaFood orders (migration 159) join the board list when the venue&apos;s GloriaFood link has{' '}
        <Mono>show_on_board</Mono> on: same shape with <Mono>source: &apos;gloriafood&apos;</Mono>, a
        GloriaFood label, our own board status only (never paid, refunded or told to GloriaFood). On days
        before today, orders imported from GloriaFood&apos;s export (migration 162) come too, marked{' '}
        <Mono>imported</Mono>, in Done and view only. See Cash Reconciliation, GloriaFood. A board move
        to ready / completed also reaches the kitchen screens, and the kitchen moves the board status
        (migration 178, see Kitchen screens → GloriaFood orders).
      </P>
      <H3>Transactions: online sales with tender</H3>
      <P>
        <Mono>services/onlineSalesSvc.js</Mono> is the one implementation of the online sales list:{' '}
        <Mono>onlineTransactions(tx, {'{ tenantId, venue, from, to, source, tender, countedOnly }'})</Mono>{' '}
        reads <Mono>orders</Mono> + <Mono>order_payments</Mono> (succeeded / partially_refunded /
        refunded) and <Mono>gloriafood_orders</Mono> for one venue, and{' '}
        <Mono>transactionsCsv(report)</Mono> writes the same rows as CSV. Routes in{' '}
        <Mono>routes/orders.js</Mono>, both <Mono>web_orders</Mono> view, venue checked by{' '}
        <Mono>venueOf()</Mono>, at most 366 days (<Mono>MAX_DAYS</Mono>), at most 20,000 rows per
        source (<Mono>truncated</Mono>). Admin: <Mono>components/orders/TransactionsReport.jsx</Mono>{' '}
        (the Transactions tab in <Mono>pages/Orders.jsx</Mono>), which only shows what the route returns.
      </P>
      <DataTable
        head={['Part', 'Rule']}
        rows={[
          ['GET /api/orders/transactions?venue_id&from&to[&source=web|gloriafood&tender=<key>&counted=1]', "{ venue, currency, from, to, gloriafood: { day_basis, day_starts_at } | null, totals { orders, not_counted, sales_pence, refunded_pence, net_pence, tip_pence, discount_pence, fees_pence, tax_pence, average_pence }, by_tender [{ key, label, orders, sales_pence, refunded_pence, net_pence, web { orders, net_pence }, gloriafood { ... } }], by_source, tenders, sources, rows, truncated }. tenders / sources list the whole range whatever the filters (the page's pickers); totals and rows follow the filters."],
          ['GET /api/orders/transactions.csv', "Same query, text/csv, filename online-sales-<venue>-<from>-to-<to>.csv. Columns Date, Time, Ready for, Source, Order, Type, Status, Counted, Tender, Tender detail, Total, Tips, Discounts, Delivery and fees, VAT / tax, Refunded, Net; pounds with two decimals; times at the venue; text cells starting with = + - @ get a leading ' so spreadsheets don't run them."],
          ['Days', "Own orders by service_date. GloriaFood orders by the venue's GloriaFood link: day_basis fulfill (fulfill_at) or accepted (accepted_at), each trading day from day_starts_at (tradingDay() from loyverseSvc.js, dayOf() binary search), so a day matches Cash Recon's Fill from GloriaFood."],
          ['Counted', "Own: placed / accepted / preparing / ready / completed; rejected and cancelled listed as not counted; pending_payment and expired left out. GloriaFood: countsInRecon() (accepted, source not admin); cancelled and test orders listed as not counted. Sales = counted totals (tips in, discounts off); net = total - refunded (GloriaFood refunded is always 0: refunds stay in GloriaFood)."],
          ['Tenders', "One list for both sources (TENDERS): cash, card_counter, card_phone, online, test, unpaid, plus other:<raw>. Own orders: the largest successful payment's gateway (ownTenderKey(): cash, card_terminal, demo, a gateway with online = true), several payments named in tender_detail; no payment = unpaid with the order's payment method as detail. GloriaFood: gfTenderKey(payment) (CASH, CARD, CARD_PHONE, ONLINE; export wording kept as other:<wording>), detail = split methods, card type, Imported."],
          ['Privacy', "No guest names, emails, phones or addresses in the rows or the CSV."],
        ]}
      />
      <H3>Promotions (migration 131)</H3>
      <P>
        Module <Mono>promotions</Mono> (group <Mono>web_ordering</Mono>), page{' '}
        <Mono>pages/Promotions.jsx</Mono> (<Mono>/promotions</Mono>), API{' '}
        <Mono>routes/promotions.js</Mono> (<Mono>/api/promotions</Mono>: GET list with uses and
        discount given, GET /catalog, POST, PUT /:id, PATCH /:id/active, PATCH /reorder, DELETE).
        The discount rules are one file, <Mono>shared/promotions.js</Mono>:{' '}
        <Mono>priceBasket(itemsById, lines, {'{ tipPercent, promos, promoCtx }'})</Mono> calls{' '}
        <Mono>applyPromotions()</Mono>, so the server (<Mono>createOrder()</Mono>, the quote
        route) and the guest page (served as <Mono>/order-api/promotions.js</Mono>, which imports{' '}
        <Mono>/order-api/menuSchedule.js</Mono>) take off exactly the same amounts.
      </P>
      <DataTable
        head={['Table / column', 'Notes']}
        rows={[
          ['promotions', "Tenant-wide. kind basket | item | bogo | free_item | bundle | tiered (132); discount_type percent | amount + discount_value (% or pence); item_ids + section_ids (item/bogo scope, both empty = every dish); buy_qty, get_qty, get_percent (bogo); min_subtotal_pence, required_item_ids (any one), max_discount_pence; apply_mode auto | manual | code + code (unique per tenant, case-insensitive); max_uses; schedule jsonb (menu schedule shape); venue_ids (empty = all); exclusive; sort_order = priority; badge_text, description."],
          ['bundle, bundle_price_pence, tiers (migration 132)', "bundle jsonb [{ label, item_ids, section_ids, qty }] (max 8) + bundle_price_pence for meal deals; tiers jsonb [{ min_pence, value }] (max 10, stored sorted, distinct min_pence) for tiered offers, value in discount_type. routes/promotions.js clean() clears the fields a kind doesn't use (e.g. discount_value = 0 for bogo / free_item / bundle / tiered)."],
          ['order_promotions', "One row per promotion an order used: promotion_id (SET NULL on delete), copied name and code, discount_pence."],
          ['orders.discount_pence, order_items.discount_pence', "subtotal_pence stays the full price; total = subtotal - discount + tip. Line VAT is on line_total - line discount. The tip % and the platform fee are on the discounted subtotal; the minimum order is checked on the full subtotal."],
        ]}
      />
      <DataTable
        head={['Rule', 'Where / how']}
        rows={[
          ['In play', "Automatic ones; manual ones in promoCtx.chosen (OrderBody.promo_ids); code ones in promoCtx.unlocked (ids found from OrderBody.promo_codes by findByCode()). Each must pass isLiveAt(): is_active, venue_ids, menuOnAt(schedule, at) with at = venue-local time of ordering."],
          ['Conditions', "unmet(): min_subtotal (before discounts), required_item, no_items (item/bogo with no covered dish), bogo_qty (fewer than buy + get covered units)."],
          ['Order', "sort_order ascending. Each promotion discounts what is left on each line (rem[]). Exclusive: applies only when nothing has yet, then closes the list; skipped ones get a not_combinable notice."],
          ['New kinds (132)', "free_item: the get_qty cheapest covered units (item_ids / section_ids) are get_percent off; its min spend excludes the value of those units (freeUnits()); none covered = free_item_missing. bundle: bundleFill() forms as many complete deals as the basket allows, each part filled with the dearest matching units not used yet; each deal's discount = its units' value - bundle_price_pence, spread over its units; nothing formed = bundle_missing with missing: [{ index, label, qty }] (no_items when no unit matches any part). tiered: tierFor() picks the highest tier with min_pence <= the full subtotal, applied like a basket discount; below the first tier, or after applying with a higher tier left = next_tier { short_pence, value, discount_type }. Auto promotions nudge on min_subtotal, bogo_qty, free_item_missing, bundle_missing, next_tier (NUDGES)."],
          ['Rounding', "Fractional per-unit discounts (bogo, free_item, bundle) go through settle(): the total is rounded once and split by allocate(), so a £15 meal deal costs exactly £15.00 (rounding each line separately could take a penny too many)."],
          ['Maths', "basket: % of the remaining total, or min(amount, remaining), spread over lines by allocate() (largest remainder, whole pence). item: per covered line, % of remaining or amount x qty. bogo: covered units sorted dearest first, in each group of buy + get the get cheapest are get_percent off. max_discount_pence scales the lines down with allocate()."],
          ['Guest feedback', "offers (manual ones that would apply, with saving_pence), notices (min_subtotal with short_pence, bogo_qty with more, required_item, no_items, not_now, not_combinable). Automatic ones only produce min_subtotal / bogo_qty notices. noticeText() words them."],
          ['Tenant scoping', "Every promotions query filters tenant_id itself (as well as RLS, forced since migration 176): listPromotions(tx, tenantId), venuePromotions(tx, venue, today) (uses venue.tenant_id), lockUses(tx, tenantId, ids), codeTaken(tx, tenantId, ...), and /catalog's menus, sections, dishes and venues. Update, switch, reorder and delete add AND tenant_id, so another tenant's id is a 404. orders.js venueOf() checks the venue belongs to the tenant (current_setting('app.tenant_id'))."],
          ['Dish picker (admin)', "DishPicker shows the chosen dishes and sections as removable chips plus a Choose / Change dishes button; the menu tree is DishPickerModal (z-[60], above the editor), which edits a copy: Done writes it back, Cancel drops it. Names come from the catalog; ids no longer on a menu show as Removed dish / Removed section."],
          ['Uses', "Orders not rejected / cancelled / expired (promoSvc FREE_STATUSES). venuePromotions() drops used-up and ended ones; createOrder() calls lockUses() (FOR UPDATE on limited promotions, then a count) inside its transaction and returns 422 code promo_invalid when one has just run out. An unknown code is also 422 promo_invalid."],
        ]}
      />
      <DataTable
        head={['Route', 'Notes']}
        rows={[
          ['GET /order-api/venues/:id', "Adds promotions (running, non-code, publicPromotion(): no code) and has_promo_codes."],
          ['POST /order-api/venues/:id/promo-code', "{ code } -> { promotion } including its code, or 404 \"That code isn't valid\". The page keeps unlocked promotions and chosen offer ids in localStorage maca_promos_<venueId> and re-checks saved codes on load."],
          ['POST .../quote, POST .../orders', "promo_codes (max 5) and promo_ids (max 20) in the body."],
          ['GET /order-api/orders/:token, admin order detail and board', "promotions: [{ name, code, discount_pence }] (loadOrderPromotions())."],
          ['GET /api/orders/report', "totals.discount_pence, days[].discount_pence, promotions: [{ name, orders, discount_pence }]."],
        ]}
      />
      <P>
        Guest page (<Mono>shared/ordering.eta</Mono>): discount rows in the basket, checkout and
        status page; offers with Apply; notices (free_item_missing and bundle_missing carry a
        Choose / Add &lt;part&gt; button, data-promo-dish + data-part, handled by showPromoDish():
        one matching dish opens its sheet, several jump to the first one&apos;s section, switching
        menu tab if needed; coversIds() is exported for this); the promo code box; badge_text on
        dishes an item / bogo / free_item / bundle promotion covers (<Mono>promoBadges()</Mono>, live ones only); the promo box
        (migration 134: <Mono>promotions.show_in_box</Mono>, <Mono>box_bg</Mono> / <Mono>box_text</Mono> theme role or #hex,{' '}
        <Mono>box_image_url</Mono>; never for code promotions, forced off by <Mono>clean()</Mono> and{' '}
        <Mono>publicPromotion()</Mono>). <Mono>boxPromos()</Mono> / <Mono>promoCardHtml()</Mono> /{' '}
        <Mono>promoBoxHtml()</Mono> draw it twice, <Mono>.mo-promos--side</Mono> at the top of the basket column
        (the column then stops sticking and the basket sticks inside it, <Mono>.has-promos</Mono>) and{' '}
        <Mono>.mo-promos--top</Mono> under the title (phones, pop-up basket); one card at a time in a
        scroll-snap track with dot buttons, both kept on <Mono>state.promoIdx</Mono> by{' '}
        <Mono>syncPromoBoxes()</Mono>. Automatic text colour reads the role's real colour and picks dark
        text on a light background (<Mono>isLight()</Mono>). Card actions: Apply offer / Remove (manual),
        Applied −£x or the promotion's notice, See dishes / Start your deal (<Mono>showPromoDish()</Mono>).
        The Online ordering block's <Mono>show_promo_box</Mono> (default on) hides it. The old offers strip
        under the title is gone. Deep links: <Mono>?promo=CODE</Mono> checks and applies a code,{' '}
        <Mono>?offer=&lt;id&gt;</Mono> chooses a manual offer; both are then removed from the
        address. On a <Mono>promo_invalid</Mono> error the page re-reads the venue&apos;s
        promotions and re-checks its codes. Staff: the order detail, printed ticket and
        confirmation email show one line per promotion.
      </P>
      <H3>Promo block (promo_cta)</H3>
      <P>
        <Mono>blocks/promo_cta.eta</Mono>, editor <Mono>PromoCtaEditor.jsx</Mono>, canvas{' '}
        <Mono>PromoCtaCanvas</Mono> in <Mono>canvas/dataBlocks.jsx</Mono> (same markup; keep in
        step). Data: promo_id, heading, text, show_code, show_terms, button_text, button_link,
        style banner | card, bg / fg (theme roles), container. <Mono>loadOrRender404()</Mono>{' '}
        attaches <Mono>site_promotions</Mono> (<Mono>sitePromotions()</Mono> in siteRenderer.js:
        running today per <Mono>promoRunning()</Mono>, with summary, terms and link from{' '}
        <Mono>promoSummary()</Mono> / <Mono>promoTerms()</Mono> / <Mono>promoLink()</Mono>). Live
        data, not in the published snapshot, so the block hides as soon as the promotion stops.
        A one-venue promotion links to <Mono>/locations/:slug/order</Mono> when there are several
        ordering venues. The site bundle now carries <Mono>tenant_id</Mono> for this.
      </P>
    </section>
  )
}
