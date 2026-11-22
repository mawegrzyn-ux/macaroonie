// src/pages/docs/loyalty.jsx
// The Docs page's "Loyalty" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'loyalty'
export const label = 'Loyalty'
export const order = 330

export function Section() {
  return (
    <section id="loyalty" data-doc="">
      <H2>Loyalty</H2>
      <P>
        Migration 211. Points, stamp cards and rewards, earned and spent at every venue of a tenant taking part,
        on the till, the self-order kiosks and online ordering; a guest web app with an emailed sign-in code;
        Apple Wallet and Google Wallet cards; a members list (basic CRM) with export and erasure. The rules live
        once in <Mono>shared/loyalty.js</Mono> (used by the API, the till, the kiosk, the guest ordering page and
        the admin); the service is <Mono>api/src/services/loyaltySvc.js</Mono>, the wallet cards{' '}
        <Mono>api/src/services/walletSvc.js</Mono>. Admin: <Mono>pages/Loyalty.jsx</Mono> (<Mono>/loyalty</Mono>,
        tabs Overview, Programme, Rewards, Stamp cards, Members, Wallet), Platform → Wallet
        (<Mono>components/platform/WalletCard.jsx</Mono>).
      </P>
      <H3>Tenant programmes and the network programme</H3>
      <P>
        A programme is a <Mono>loyalty_programmes</Mono> row with a scope: <Mono>tenant</Mono> (one per tenant,
        made on first read by <Mono>ensureProgramme()</Mono>, starts switched off) or <Mono>network</Mono>{' '}
        (Macaroonie&apos;s own, <Mono>tenant_id</Mono> NULL, seeded switched off). Members of different tenants
        with the same email are linked by <Mono>loyalty_identities</Mono> (only the sha-256 of the email, global,
        system mode only), so a network programme can later count across tenants without copying anyone&apos;s
        details. Only tenant programmes are built: the network row, the identities and the{' '}
        <Mono>network</Mono> feature switch are there, nothing reads them yet.
      </P>
      <H3>Tables</H3>
      <DataTable
        head={['Table', 'Holds']}
        rows={[
          ['loyalty_programmes', 'enabled, settings (normaliseProgramme(): name, points { label, per_pound, min_spend_pence, welcome, expiry_months }, features { points, stamps, rewards, wallet_apple, wallet_google, web_app, network }, channels { till | kiosk | online: { earn, redeem } }, venue_ids (null = every venue), signup { ask_phone, terms_text, marketing_text, welcome_text }, card colours), member_seq.'],
          ['loyalty_rewards', 'data (normaliseReward(): kind amount_off | percent_off | free_item, value, item_ids / section_ids, min_spend_pence, channels, valid_days, image), points_cost (null = not for points), is_active, sort_order.'],
          ['loyalty_stamp_cards', 'data (normaliseStampCard(): stamps_needed, earn { per item | visit, item_ids, section_ids, min_spend_pence, max_per_sale }), reward_id (ON DELETE RESTRICT).'],
          ['loyalty_members', 'member_no (9 digits, Luhn), card_token (the QR code, unique), status active | closed | erased, name, email, email_hash, phone, points, points_earned / spent, visits, spend_pence, consents, notes, tags, customer_id, identity_id, wallet_token (sealed) and wallet times.'],
          ['loyalty_ledger', 'Every change of points or stamps: kind earn | redeem | release | adjust | welcome | expire | stamps | card_full, points, stamps, stamp_card_id, source (check | order | redemption | staff | join | expiry | stamp_card + source_id), venue, channel, spend. A redemption takes and gives back points once (partial unique index).'],
          ['loyalty_member_rewards', 'Rewards a member holds (from a full stamp card or given by staff): available | reserved | used | expired | cancelled, expires_at.'],
          ['loyalty_redemptions', 'A reward taken out to spend: reserved (points taken at once) → used (on a check or an order) or released (points / held reward back). channel, venue, check_id or order_id, discount (what it may take off), used_event_id, expires_at (2 hours; an online order\'s 1 day).'],
          ['loyalty_codes / loyalty_sessions', 'The web app\'s emailed codes (hash of email + code, attempts, 15 minutes) and sign-ins (hash of the token, 120 days).'],
          ['loyalty_wallet_settings / loyalty_wallet_devices', 'A tenant\'s own Apple / Google accounts (sealed) and the Apple devices holding a member\'s pass (push tokens sealed).'],
          ['pos_checks / orders', 'loyalty_member_id and loyalty_settled_key (what settling last saw).'],
        ]}
      />
      <P>
        Every table has forced RLS. Modules <Mono>loyalty</Mono> (programme, rewards, stamp cards, wallet) and{' '}
        <Mono>loyalty_members</Mono> (the members list: personal data), group <Mono>loyalty</Mono>; the
        migration adds a Loyalty link after Customers in every tenant&apos;s main menu.
      </P>
      <H3>Earning: settling a sale</H3>
      <P>
        Points and stamps are never added by the device. <Mono>settleCheck(tenantId, venueId, checkId)</Mono>{' '}
        and <Mono>settleOrder(tenantId, orderId)</Mono> work out what a sale should give its member now
        (<Mono>pointsFor()</Mono> on the spend after discounts, without tips or charges, less refunds;{' '}
        <Mono>stampsFor()</Mono> per active card; nothing while the channel doesn&apos;t earn at the venue) and
        add the difference from what the ledger already holds for that source (<Mono>settleSource()</Mono>,
        under an advisory lock per source). So a refund, a member put on after paying, or a member changed on
        the check all settle by themselves, and running it twice changes nothing. A till check earns once{' '}
        <Mono>closed</Mono>; an online order once paid (or completed). A full stamp card gives its reward
        (<Mono>fillStampCard()</Mono>, one held reward per filling, keyed so it is given once) and the extra
        stamps carry on.
      </P>
      <P>
        Calls: <Mono>settleChangedChecks()</Mono> after <Mono>POST /pos-api/events</Mono> (checks with a member
        or a reward), <Mono>settleLoyalty()</Mono> after every online order change in{' '}
        <Mono>orderSvc.js</Mono>, both not awaited. <Mono>sweepLoyalty()</Mono> in the minute hold sweep
        settles anything whose <Mono>loyalty_settled_key</Mono> is behind (checks of the last 30 days, orders
        of 60), releases reservations past their time that are on no check, takes off points past the
        programme&apos;s expiry (the whole balance after the months with no activity), marks held rewards past
        their date expired, and deletes old codes and sessions; then <Mono>pushWalletUpdates()</Mono>.
      </P>
      <H3>Spending: reserve, use, release</H3>
      <P>
        <Mono>reserveReward()</Mono> takes a reward out for a member at a venue and channel: points off now
        (ledger <Mono>redeem</Mono>) or the held reward reserved, and a <Mono>loyalty_redemptions</Mono> row
        with the discount it may give. The till and kiosk then put the member on the check (event{' '}
        <Mono>check.member_set</Mono>) and the reward on it (<Mono>discount.applied</Mono> with{' '}
        <Mono>loyalty_redemption_id</Mono>, made by <Mono>tillDiscount()</Mono>). The sequencer asks{' '}
        <Mono>loyaltyNeed()</Mono> / <Mono>loyaltyProblem()</Mono> against the store&apos;s{' '}
        <Mono>loadLoyaltyRedemption()</Mono> (same venue, same member, not used by another event, not
        released, the discount no bigger than allowed and on a dish it covers) and marks it used once with{' '}
        <Mono>useLoyaltyRedemption()</Mono>. A store without them (the venue hub) refuses: rewards need the
        internet. A member can&apos;t be taken off a check while a reward is on it. Settling releases a
        redemption whose discount came off, whose check was voided or merged, or that never made it onto a
        closed check (<Mono>releaseRedemption()</Mono>: points or held reward back, once).
      </P>
      <P>
        Kiosk orders are built by <Mono>kioskOrder()</Mono> with <Mono>opts.loyalty</Mono>{' '}
        (<Mono>{'{ member, rewards: [{ redemption_id, reward }] }'}</Mono>): the member event, then a discount per
        reward; one that no longer fits the basket is left off (<Mono>skipped</Mono>) and goes back when the
        order closes. <Mono>KIOSK_EVENTS</Mono> takes <Mono>check.member_set</Mono> and only loyalty discounts.
        Online, the quote prices picked rewards with <Mono>rewardDiscount()</Mono> inside{' '}
        <Mono>priceBasket()</Mono> (last, on what combos and promotions left; error code <Mono>reward</Mono>),
        and <Mono>createOrder()</Mono> reserves them in the order&apos;s transaction (all rolled back if
        anything refuses), with the order&apos;s <Mono>loyalty_member_id</Mono>; cancelling, rejecting or
        expiring releases them.
      </P>
      <H3>Device routes (routes/loyaltyPos.js, inside the /pos-api device scope)</H3>
      <DataTable
        head={['Route', 'Does']}
        rows={[
          ['POST /pos-api/loyalty/lookup', '{ code } (a scanned card, ML1.<token>, or a member number) or { q } (tills only: exact email by hash, phone, name, member number). Returns members (memberSummary(): points, stamps, rewards to spend; a kiosk gets the first name only, no email or phone) and whether earn / redeem are on here.'],
          ['POST /pos-api/loyalty/members', 'Tills only: join a guest (agreed: true required), 201 new or 200 the existing member.'],
          ['POST /pos-api/loyalty/redemptions', '{ member_id, reward_id | member_reward_id, check_id }: reserve a reward for this device\'s venue and channel.'],
          ['POST /pos-api/loyalty/redemptions/:id/release', 'Put back a reward that never went on the check.'],
        ]}
      />
      <P>
        <Mono>deviceLoyalty(tx, tenantId, venueId, channel)</Mono> puts <Mono>loyalty</Mono> (null = off here)
        into <Mono>tillConfig()</Mono>, <Mono>kioskConfig()</Mono> and the ordering page&apos;s venue reply.
        Till: <Mono>pos/src/components/LoyaltyModal.jsx</Mono> (check actions → the programme&apos;s name;{' '}
        <Mono>QrScan.jsx</Mono> uses <Mono>BarcodeDetector</Mono> where the browser has it, else a scanner
        typing into the box). Kiosk: <Mono>pos/src/kiosk/Loyalty.jsx</Mono> (<Mono>LoyaltyBlock</Mono> on the
        order page, the scan sheet, the join QR code), <Mono>state.loyalty</Mono> and{' '}
        <Mono>loyaltyForOrder()</Mono> in <Mono>kiosk/store.js</Mono>, words <Mono>loyalty_*</Mono> in{' '}
        <Mono>shared/kioskText.js</Mono> (nine languages). Previews show the block but never take a reward out.
      </P>
      <H3>The guest web app and its API (routes/loyaltyApi.js, /loyalty-api)</H3>
      <P>
        The guest&apos;s card, sign-in and join are one module, <Mono>api/src/assets/loyaltyApp.js</Mono>,
        served as <Mono>/loyalty-api/app.js</Mono>: <Mono>mountLoyalty(el, opts)</Mono> draws into any element
        (styles scoped to <Mono>.mloy</Mono>, coloured by <Mono>--mloy-*</Mono> variables the host sets; opts{' '}
        <Mono>slug</Mono>, <Mono>title</Mono>, <Mono>alwaysTitle</Mono>, <Mono>intro</Mono>, <Mono>titleTag</Mono>,{' '}
        <Mono>parts</Mono> {'{ how, stamps, rewards, history, settings, wallet }'}, <Mono>autofocus</Mono>). Two
        hosts use it: the stand-alone web app <Mono>views/site/loyalty.eta</Mono> (served by{' '}
        <Mono>serveLoyaltyApp()</Mono> in <Mono>services/loyaltyPage.js</Mono> with its own manifest and a small
        service worker) at <Mono>loyalty.{'{root}'}/&lt;site slug&gt;</Mono> (<Mono>routes/loyaltySite.js</Mono>,
        platform host kind <Mono>loyalty</Mono>, reserved subdomain), and the website&apos;s{' '}
        <Mono>loyalty_card</Mono> block (below) on the built-in Loyalty page <Mono>/loyalty</Mono> or any page.
        The session is kept in <Mono>localStorage</Mono> <Mono>mcrn_loyalty_&lt;slug&gt;</Mono>; the ordering page
        reads the same key, so one sign-in covers both on the tenant&apos;s site. A sign-in or sign-out
        dispatches <Mono>mcrn-loyalty-session</Mono> on <Mono>window</Mono> (and other tabs see the storage
        event), so every card block and the ordering page on the page follow it.
      </P>
      <DataTable
        head={['Route', 'Does']}
        rows={[
          ['GET /t/:slug', 'The programme in public words: name, points (label, per pound, welcome), how (earnText()), rewards for points, stamp cards, the sign-up words, web_app and which wallets are on. 404 while loyalty is off. Signing in needs the web app on, or online ordering earning or spending.'],
          ['POST /t/:slug/code', 'Email a six-digit code (15 minutes; the reply is the same for members and others; at most 4 an hour per address, 6 a minute per IP).'],
          ['POST /t/:slug/verify', 'A member gets { session, member }; anyone else a join ticket (30 minutes). Five wrong tries end the code.'],
          ['POST /t/:slug/join', 'With the join ticket, a name and agreed: true (the words stored with the time), optional phone and newsletter: 201, welcome points.'],
          ['GET /t/:slug/me, /me/rewards', 'The card (Authorization: Loyalty <session>): points, stamps, held rewards, history, the QR code. /me/rewards (the ordering page) also returns the member\'s name, email and phone to fill checkout.'],
          ['GET /app.js, /qr.js', 'assets/loyaltyApp.js (the card for the web app and the Loyalty card block) and shared/qr.js. Public, cached 5 minutes.'],
          ['PATCH /t/:slug/me, POST /me/new-card, GET /me/export, POST /me/delete, POST /me/signout', 'Their details and newsletter, a new card token, their data as JSON, erase themselves, sign out.'],
          ['POST /t/:slug/me/wallet/apple, GET /pass/loyalty.pkpass', 'A signed link (15 minutes) to the member\'s .pkpass (applePass(): pass.json, icons drawn in the brand\'s colours, manifest, PKCS#7 signature by openssl, zipped without dependencies).'],
          ['POST /t/:slug/me/wallet/google', 'The Add to Google Wallet link (googleSaveUrl(): a loyalty class and object in an RS256 JWT).'],
          ['/apple/v1/...', 'Apple\'s pass web service: register / unregister a device, the serials updated since, the latest pass, the log. The pass\'s serial is the member id; its authenticationToken is the sealed wallet_token.'],
        ]}
      />
      <H3>Wallet accounts</H3>
      <P>
        Macaroonie&apos;s Apple Pass Type ID (certificate, key, Apple WWDR) and Google Wallet issuer (service
        account) are saved on the Platform page (<Mono>platform_secrets</Mono> <Mono>wallet_apple</Mono> /{' '}
        <Mono>wallet_google</Mono>, sealed JSON; <Mono>/api/loyalty/platform/wallet[/:kind]</Mono>). A tenant may
        save its own instead (<Mono>PUT /api/loyalty/wallet/:kind</Mono>, owner or admin;{' '}
        <Mono>loyalty_wallet_settings</Mono>), checked before saving (the key belongs to the certificate, not
        run out). Cards are in the tenant&apos;s brand (<Mono>cardColours()</Mono> in <Mono>shared/loyalty.js</Mono>: the
        programme&apos;s card colours, else <Mono>tenant_site.theme.colors</Mono>), or the member&apos;s own look
        (migration 264, 22 Nov 2026): <Mono>settings.themes</Mono> (up to <Mono>MAX_CARD_THEMES</Mono> 8,{' '}
        <Mono>{'{ id, name, background, text, accent }'}</Mono>, kept by <Mono>normaliseProgramme()</Mono>, ids kept as
        sent or made from the name), <Mono>loyalty_members.card_theme</Mono> (null = standard), and{' '}
        <Mono>memberCardColours()</Mono> (the look while it is offered, else the standard colours) for the Apple pass
        and the Google object&apos;s <Mono>hexBackgroundColor</Mono> (also patched). <Mono>GET /loyalty-api/t/:slug</Mono>{' '}
        gives <Mono>card.standard</Mono> and <Mono>card.themes</Mono> in full (<Mono>themeColours()</Mono>);{' '}
        <Mono>PATCH /me {'{ theme }'}</Mono> picks one (422 when not offered) and marks the wallet for an update;{' '}
        <Mono>memberSummary()</Mono> gives <Mono>card_theme</Mono>; the export includes it; <Mono>mountLoyalty()</Mono>{' '}
        sets the card&apos;s <Mono>--mloy-card-*</Mono> from it and offers the looks in Settings. Admin: Loyalty →
        Programme → <Mono>CardLooks</Mono>. <Mono>pushWalletUpdates()</Mono> sends an
        APNs push (HTTP/2, the pass certificate) to the devices of members whose{' '}
        <Mono>wallet_updated_at</Mono> is after <Mono>wallet_pushed_at</Mono>, and patches their Google object.
        Env (only changed for stand-in servers): <Mono>APPLE_APNS_URL</Mono>, <Mono>GOOGLE_WALLET_API_URL</Mono>,{' '}
        <Mono>GOOGLE_OAUTH_TOKEN_URL</Mono>.
      </P>
      <H3>Staff API (routes/loyalty.js, /api/loyalty)</H3>
      <DataTable
        head={['Route', 'Permission']}
        rows={[
          ['GET /programme, /catalog, /wallet', 'loyalty view'],
          ['PUT /programme; POST / PUT / DELETE /rewards[/:id], PATCH /rewards/reorder; /stamp-cards', 'loyalty manage (a reward someone used can\'t be deleted: switch it off)'],
          ['GET /teaser', 'website or loyalty view (the Loyalty block\'s preview: loyaltyTeaser())'],
          ['GET /members, /members/:id', 'loyalty_members view'],
          ['POST /members, PATCH /members/:id, POST .../adjust, .../rewards, DELETE .../rewards/:rid, POST .../new-card, .../redemptions/:rid/release, GET .../export, /members.csv', 'loyalty_members manage'],
          ['POST /members/:id/erase', 'loyalty_members manage + owner or admin'],
          ['PUT /wallet/:kind', 'loyalty manage + owner or admin'],
          ['/platform/wallet[/:kind]', 'platform admin'],
        ]}
      />
      <P>
        Reward and stamp card dishes are kept only when they are the tenant&apos;s (another tenant&apos;s
        ids are dropped), and so is a stamp card&apos;s reward that isn&apos;t the tenant&apos;s.
      </P>
      <H3>The Loyalty page and the Loyalty card block (migration 214)</H3>
      <P>
        <Mono>website_pages.system_key</Mono> takes <Mono>'loyalty'</Mono> beside <Mono>'order'</Mono>: the
        built-in Loyalty page, seeded for every site by migration 214 and by <Mono>ensureSystemPages()</Mono>{' '}
        (<Mono>services/systemPages.js</Mono>, which replaced <Mono>orderPage.js</Mono>) for new ones, with one{' '}
        <Mono>loyalty_card</Mono> block. <Mono>/loyalty</Mono> on the tenant&apos;s site renders it through{' '}
        <Mono>page.eta</Mono> with <Mono>loyaltyPwa</Mono> (the head links <Mono>/loyalty/manifest.webmanifest</Mono>{' '}
        and marks it noindex), 404 while <Mono>bundle.site_loyalty</Mono> is null; a snapshot from before 214
        uses <Mono>DEFAULT_LOYALTY_PAGE</Mono>. The pages API guards it like the ordering page (no delete,
        unpublish, modal or slug change, 422). Addresses of built-in pages come only from{' '}
        <Mono>pagePath()</Mono> / <Mono>SYSTEM_PAGES</Mono> in <Mono>shared/sitePages.js</Mono> (site routes,
        sitemap and llms.txt, LinkPicker, the Pages list); the sitemap leaves <Mono>/loyalty</Mono> out.
      </P>
      <P>
        The block: <Mono>views/site/blocks/loyalty_card.eta</Mono> renders a container and a module script calling{' '}
        <Mono>mountLoyalty()</Mono> with its options as JSON (<Mono>&lt;</Mono> escaped); nothing while{' '}
        <Mono>site_loyalty</Mono> is null. Data: heading (blank: the programme name, signed out only; set:
        also on the card, <Mono>alwaysTitle</Mono>), intro, show_how / show_stamps / show_rewards /
        show_wallet / show_history / show_settings (on unless false), container narrow | boxed | wide,
        boxed_step, accent (buttons) and panel (boxes) as theme roles or codes, card_bg / card_text (blank:
        the programme&apos;s card colours, <Mono>loyaltyTeaser().card</Mono> from <Mono>cardColours()</Mono>).
        Canvas <Mono>LoyaltyCardCanvas</Mono> in <Mono>canvas/dataBlocks.jsx</Mono> (a signed out / signed in
        sample, its own QR code), editor <Mono>editors/LoyaltyCardEditor.jsx</Mono>.
      </P>
      <H3>Checkout: member or guest</H3>
      <P>
        In <Mono>views/site/shared/ordering.eta</Mono>, checkout with loyalty on (<Mono>data.loyalty</Mono>) and
        nobody signed in starts with <Mono>whoHtml()</Mono> (Sign in or join, with what the order earns, or
        Continue as a guest) and the order summary only. <Mono>loy.who</Mono> is <Mono>member</Mono> |{' '}
        <Mono>guest</Mono> | null: a guest pick is kept in <Mono>sessionStorage</Mono>{' '}
        <Mono>mcrn_order_who_&lt;slug&gt;</Mono> for the visit; member shows the sign-in steps (gated
        <Mono> loyaltyHtml(q, true)</Mono> with Continue as a guest instead) until signed in; a session already
        in <Mono>localStorage</Mono> skips the question. <Mono>loadLoyalty()</Mono> fills empty name, email and
        phone from <Mono>/me/rewards</Mono> and remembers what it filled (<Mono>loy.filled</Mono>); sign out
        clears those fields (unless the guest changed them) and asks again.
      </P>
      <H3>The Loyalty website block (loyalty_cta)</H3>
      <P>
        <Mono>views/site/blocks/loyalty_cta.eta</Mono>, canvas <Mono>LoyaltyCtaCanvas</Mono> in{' '}
        <Mono>canvas/dataBlocks.jsx</Mono>, editor <Mono>editors/LoyaltyCtaEditor.jsx</Mono>. Data: heading,
        text, show_rewards, button_text, style banner | card, bg / fg (theme roles or a code), container. The
        words come from <Mono>bundle.site_loyalty</Mono> (<Mono>loyaltyTeaser()</Mono>, added to every site
        render in <Mono>loadOrRender404()</Mono>, live like promotions), null while loyalty or the web app is
        off, and then the block renders nothing.
      </P>
      <H3>GDPR</H3>
      <P>
        <Mono>exportMember()</Mono>: the member&apos;s columns (not the card token), points history, rewards,
        redemptions. <Mono>eraseMember()</Mono>: releases reserved rewards, deletes sessions, codes and wallet
        devices, cancels held rewards, clears staff notes on the ledger and the member&apos;s name, email,
        email_hash, phone, notes, tags, consents, newsletter, customer and identity links; a new random card
        token stops the card; status <Mono>erased</Mono>. The ledger keeps its numbers. The identity row goes
        when no member uses it. Customers → Anonymise calls <Mono>eraseMembersOfCustomer()</Mono> in the same
        transaction (by customer id or any of the emails it anonymises). The newsletter is set only by the
        guest (joining, the web app); staff can only take it off.
      </P>
    </section>
  )
}
