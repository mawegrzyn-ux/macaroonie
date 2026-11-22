// src/pages/docs/kiosks.jsx
// The Docs page's "Self-order kiosks" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'kiosks'
export const label = 'Self-order kiosks'
export const order = 280

// ── SELF-ORDER KIOSKS ──────────────────────────────
export function Section() {
  return (
    <section id="kiosks" data-doc="">
      <H2>Self-order kiosks</H2>
      <P>
        Migration 172. Design in <Mono>docs/POS.md</Mono> section 10. A kiosk is a till device of kind{' '}
        <Mono>kiosk</Mono> (<Mono>pos_devices</Mono>, short code KS1, KS2 ...), linked by the code it shows
        like a till. The same app at <Mono>pos.&lt;domain&gt;</Mono> boots{' '}
        <Mono>pos/src/kiosk/KioskApp.jsx</Mono> (lazy) when the device's kind is <Mono>kiosk</Mono>, or with{' '}
        <Mono>?kiosk_preview=&lt;signed link&gt;</Mono> for the design editor's preview. A kiosk order is a
        counter check made from the till's own events, so it reaches the Counter list, the kitchen, Till
        reports and Cash Recon with no special case; the kiosk is its server (<Mono>server_id</Mono> = the
        device id).
      </P>
      <H3>Orders: the till's events, the kiosk rules</H3>
      <P>
        <Mono>shared/kiosk.js</Mono> is the one place for what the kiosk app, the API and the admin share.{' '}
        <Mono>kioskOrder(config, basket, opts)</Mono> turns a basket into events, checked with{' '}
        <Mono>replay()</Mono> (the sequencer's rules): <Mono>check.opened</Mono> (counter, the kiosk's
        stream, the order type, <Mono>tab_name</Mono>, <Mono>tent</Mono>, the kiosk's own <Mono>number</Mono> and <Mono>order_no</Mono>), one{' '}
        <Mono>line.added</Mono> per entry (<Mono>kioskLine()</Mono>: <Mono>priceItem()</Mono> and{' '}
        <Mono>posTax()</Mono>), <Mono>promotions.set</Mono> when <Mono>checkOffers()</Mono>{' '}
        (<Mono>shared/pos/offers.js</Mono>: automatic combos and automatic till promotions) finds any, then
        for a card payment <Mono>payment.added</Mono> (<Mono>card_external</Mono>, the whole total),{' '}
        <Mono>lines.sent</Mono> and <Mono>check.closed</Mono>; for pay at the counter{' '}
        <Mono>lines.sent</Mono> only when <Mono>checkout.send_counter</Mono> is on (else staff send it when
        they take payment).
      </P>
      <P>
        The sequencer knows each kiosk as <Mono>kioskStaff(device)</Mono>{' '}
        (<Mono>{'{ kiosk: true, permissions: {} }'}</Mono>, in <Mono>staffById</Mono> next to the staff,{' '}
        <Mono>services/posSvc.js</Mono>). <Mono>kioskProblem()</Mono> in <Mono>shared/pos/checks.js</Mono>{' '}
        refuses (code <Mono>kiosk</Mono>) anything but <Mono>KIOSK_EVENTS</Mono>, approvals, events sent by
        another device in the kiosk's name, table orders, other servers' checks, lines not from the menu
        (price override, open item) and payments other than <Mono>card_external</Mono> without tip or
        tendered cash.
      </P>
      <H3>API</H3>
      <DataTable
        head={['Route', 'What it does']}
        rows={[
          ['GET /pos-api/config (kiosk)', 'kioskConfig() in services/kioskSvc.js: venue, settings, the kiosk\'s stream and its order types (ask_name / ask_tent), all order types, tax rates, menus / items / section_items (tillMenuData guest view: a section\'s item_ids leave out dishes isPriced() in shared/orderPricing.js says can\'t be priced, as online ordering does; they stay in items and section_items for combos), option groups with their kiosk fields, guest-visible dietary tags, the allergen notice, automatic till promotions, the design (normalised), translations for the design\'s languages, the device. No staff, no PINs. version = a hash of it; then sold_out and the prices stamp (liveFields(), not in the version, also in an unchanged reply; GET /pos-api/live sends just those).'],
          ['Kiosk device routes', 'A kiosk may only call GET /pos-api/me, GET /pos-api/config, GET /pos-api/live, POST /pos-api/events, its card machine routes, POST /pos-api/kiosk/journeys and POST /pos-api/kiosk/receipts (KIOSK_ROUTES); anything else is 403 code kiosk.'],
          ['POST /pos-api/kiosk/receipts', 'Kiosks only (migration 209, services/receiptSvc.js kioskReceipt()). { check_id, email? }: the order must be one this kiosk placed at its venue (pos_checks.server_id = the kiosk, else 404). Makes the order\'s pos_receipts row once (token: 24 random bytes, base64url) -> { url (deviceOrigin(\'kiosk\') + /receipt/<token>), sent_to }. With email (isEmail() in shared/kiosk.js, else 400): 422 for a void check, 429 after MAX_EMAILS (3), counted before sending. A paid check: the receipt goes through the venue\'s provider (emailCredentials()) after the transaction, the kiosk waiting; 422 when the provider refuses; only emailHint() (first letter and domain) and emailed_at are stored; sent_to is the hint. An open check (to pay at the counter, migration 210): the address is kept sealed until the till takes payment (sendWaitingReceipts()), -> will_send_to (the hint), sent_to null. 60 a minute.'],
          ['GET /receipt/:token', 'No login, device hosts only (pos., kitchen., kiosk.; else 404), served by routes/posSite.js (\'/receipt/\' in PASS_PREFIXES; the pos app\'s service worker leaves it to the network). receiptPage(): the token found in system mode (rows under 400 days), then the check in its tenant, drawn with billOps() in the kiosk receipt design (printConfig().layouts.kiosk_receipt) and previewHtml() at DEFAULT_COLS; an open check is a bill with a Not paid yet note. Cache-Control no-store, Referrer-Policy no-referrer, X-Robots-Tag noindex, a CSP of its own. Counts views. 120 a minute.'],
          ['GET /pos-api/kiosk-preview?token=', 'The preview\'s config: kioskConfig() with previewDevice() (the editor\'s stream and design, the test card reader) and the token\'s menu version (m: \'draft\' = the menus with changes not published yet; menu_version in the config). The token is the key: readPreviewToken(), HMAC with platform_secrets kiosk_preview_key, 12 hours.'],
          ['GET /api/pos/kiosk-designs', 'pos_setup view. Normalised settings.'],
          ['POST /api/pos/kiosk-designs', 'pos_setup manage. { name, settings, copy_from? } (copy_from: another design of the tenant). Up to 50 per tenant. The design editor\'s Save as sends the editor\'s normalised draft as settings (unsaved changes included); the new row has no share.'],
          ['PUT /api/pos/kiosk-designs/:id', 'pos_setup manage. { name, settings }, stored as ownDesign(settings) (services/kioskSvc.js: normaliseDesign(), then only the tenant\'s own sections (left off, section tiles, banner and tile links), dishes (links, "Anything else?") and order types (type buttons) are kept; another tenant\'s ids are dropped, a link becomes none). POST does the same. Broadcasts pos.config to every venue with a kiosk (kiosksChanged()).'],
          ['DELETE /api/pos/kiosk-designs/:id', 'pos_setup manage. Refused (422, names the kiosks) while a kiosk picks it.'],
          ['POST /api/pos/kiosk-designs/:id/preview', 'pos_setup view. { venue_id, revenue_stream_id?, menu? \'live\' | \'draft\' } (both the tenant\'s, the stream at that venue) -> { token, url (deviceOrigin(\'kiosk\') + ?kiosk_preview=), menu, menus_changed [{ id, name }], unpriced [{ id, name, menu }] } (menuChanges() in services/kioskSvc.js: the menus this preview shows, published or draft, whose draft differs from what is published, contentKey() from shared/menuDiff.js; unpricedDishes(): the dishes the kiosk leaves off for having no price, shown above the editor\'s preview as kd-unpriced).'],
          ['PUT /api/pos/kiosk-designs/:id/share', 'pos_setup manage. Migrations 187, 188: a lasting link for people outside the group. { venue_id, revenue_stream_id?, menu? \'live\' | \'draft\' (kiosk_designs.share_menu, absent = live), expires_on? } (the tenant\'s venue, a stream at it, a date after today). Makes the token once (24 random bytes, base64url, kiosk_designs.share_token, unique), then only moves it. -> share { url (deviceOrigin(\'kiosk\') + ?kiosk_share=), venue_id, revenue_stream_id, menu, expires_at, expired, views, last_viewed_at, created_at, created_by }. GET /kiosk-designs carries share on each design; the setup snapshot carries shared.'],
          ['POST /api/pos/kiosk-designs/:id/share/new-link', 'pos_setup manage. A new token (the old link stops), views back to 0. 422 when not shared.'],
          ['DELETE /api/pos/kiosk-designs/:id/share', 'pos_setup manage. Clears every share column.'],
          ['GET /pos-api/kiosk-share?token=', 'No login: the token is the key, looked up in system mode, then kioskConfig() in the design\'s tenant with previewDevice() (the share\'s stream, the test card reader) and the share\'s menu version, plus share { design, venue, company, expires_at, menu }. 404 when unknown or the venue is gone, 410 when past its end. Counts the view.'],
          ['GET /api/menus/translations?lang=', 'menus view. lang optional (the first kiosk language besides the menu\'s own). -> { lang, source, designs, languages [{ code, name, on_a_kiosk }], sources [{ key, group, context, text }], texts, builtin (the kiosk\'s own words and standard allergen names in that language), ai }.'],
          ['PUT /api/menus/translations', 'menus manage. { lang, texts: { key: text | \'\' } }: upserts, \'\' deletes; keys must match KEY_PATTERN. -> { saved, removed }.'],
          ['POST /api/menus/translations/ai', 'menus manage. { lang, source, keys?, skip? } -> { texts, left }: Claude\'s suggestions for words without a translation, AI_BATCH (120) a call, structured output (json_schema), counted in the tenant\'s monthly AI allowance. Nothing is saved.'],
        ]}
      />
      <P>
        A kiosk itself always gets the published menu: <Mono>kioskConfig()</Mono> takes{' '}
        <Mono>menuVersion: 'draft'</Mono> only together with <Mono>preview</Mono>, and passes it to{' '}
        <Mono>tillMenuData()</Mono> / <Mono>tillMenus()</Mono> (<Mono>services/posSvc.js</Mono>,{' '}
        <Mono>loadMenuVersions(&#123; version &#125;)</Mono>). Option groups and their pictures are tenant-wide
        and live in every version, so only dish and section changes (photos, prices, names, new dishes) differ.
        The design editor's preview toolbar has <strong>Published menu</strong> / <strong>Menu with unpublished
        changes</strong> (remembered in <Mono>maca_kiosk_preview_menu</Mono>), a note naming{' '}
        <Mono>menus_changed</Mono>, and Reload (a new preview link, so the frame loads the menu again).{' '}
        <Mono>routes/posSite.js</Mono> lets a <Mono>?kiosk_preview=</Mono> page be framed by the platform's
        own hosts (<Mono>frame-ancestors</Mono>, no <Mono>X-Frame-Options</Mono>); the app's service worker
        leaves those pages to the network. Media changes need Website, Menus, Menu screens or Store tech
        manage (<Mono>routes/media.js</Mono>); kiosk pictures use scope <Mono>kiosk</Mono>. Till reports'
        checks list, check history, refused changes and day names show the kiosk's name (a{' '}
        <Mono>pos_devices</Mono> join on the server / staff id).
      </P>
      <H3>Shared preview links</H3>
      <P>
        Migration 187. Each design can have one lasting link (Share in the design editor:{' '}
        <Mono>ShareDialog</Mono> in <Mono>KioskDesigner.jsx</Mono>, with a QR code from <Mono>shared/qr.js</Mono>).{' '}
        <Mono>?kiosk_share=&lt;token&gt;</Mono> on the kiosk address opens <Mono>pos/src/kiosk/SharePage.jsx</Mono>:
        the kiosk in a frame at the design's screen size (upright or turned: <Mono>share.screen</Mono> in{' '}
        <Mono>kiosk.ready</Mono>, 1080 x 1920 until it arrives), scaled to fit, with Upright / Wide, Start again
        (postMessage <Mono>kiosk.restart</Mono> to its own origin) and Full screen (the frame's own address).
        The frame (<Mono>&amp;frame=1</Mono>) runs <Mono>KioskApp</Mono> with <Mono>shareToken</Mono>:{' '}
        <Mono>bootShare()</Mono> in <Mono>pos/src/kiosk/store.js</Mono> is <Mono>bootPreview()</Mono>'s twin
        (both <Mono>bootPreviewFrom()</Mono>) that ignores <Mono>kiosk.design</Mono> messages, so the page shows
        the design as saved, and posts <Mono>kiosk.ready</Mono> with the names (or an error) to the share page.
        Nothing is sent from either: it is a preview. Neither registers for app updates; the service worker
        leaves both to the network.
      </P>
      <P>
        The preview notice (<Mono>previewBand</Mono> in <Mono>KioskApp.jsx</Mono>): in a frame
        (<Mono>window.parent !== window</Mono>: the design editor, the share page) the kiosk shows none, since the
        page around it says orders aren't sent (the editor's toolbar line, the share page's footer). Opened in its own
        tab (Full screen, or a preview link pasted into the address bar), <Mono>.k-preview-band</Mono> (30 px,
        kiosk.css) runs along the top and <Mono>.k-root.k-has-preview-band</Mono> starts <Mono>.k-frame</Mono> (and
        the reach band, with reach on: <Mono>calc(30px + 38%)</Mono> for the frame) below it. It used to be a pill
        absolutely positioned at the top right, over the top bar's running price and language button.
      </P>
      <H3>Screens of another shape or size</H3>
      <P>
        A design is made for one screen: <Mono>design.screen</Mono> = <Mono>{'{ short, long, shape, bars }'}</Mono>{' '}
        (<Mono>normaliseDesign()</Mono>: its size upright in CSS px, 320 to 7680, swapped if given the wrong way
        round, default 1080 x 1920; <Mono>shape</Mono> <Mono>keep</Mono> | <Mono>fill</Mono>; <Mono>bars</Mono>{' '}
        <Mono>black</Mono> | <Mono>page</Mono>; presets <Mono>KIOSK_SCREENS</Mono>). Two pure rules in{' '}
        <Mono>shared/kiosk.js</Mono>, both unit-tested:
      </P>
      <DataTable
        head={['Function', 'What it gives']}
        rows={[
          ['kioskBox(w, h, screen)', 'Where the kiosk sits on a w x h window: { x, y, w, h, portrait, bars }. Portrait when h >= w (the design upright, else turned). keep and more than SHAPE_SLACK (3%) off the shape: the shape as big as fits, centred; else the whole window.'],
          ['kioskZoom(w, h, screen)', 'The page scale for a screen of w x h CSS px before any zoom: min(box / design size) for the box kioskBox() gives there, 1 within ZOOM_SLACK (10%) of the design, else rounded down to 3 decimals, between ZOOM_MIN 0.1 and ZOOM_MAX 4. The same either way round (a turned screen swaps both sides).'],
          ['screenSize(w, h, screen)', 'The design\'s size the way round a window is ({ w, h }).'],
        ]}
      />
      <P>
        The kiosk (<Mono>pos/src/kiosk/viewport.js</Mono>): <Mono>useKioskViewport(design.screen)</Mono> (a layout
        effect in <Mono>KioskApp</Mono>, top window only, once the design is known) reads <Mono>window.screen</Mono>{' '}
        and sets <Mono>meta[name=viewport]</Mono>: zoomed out{' '}
        <Mono>width=device-width, initial-scale=k, minimum-scale=k, maximum-scale=k, user-scalable=no, viewport-fit=cover</Mono>,
        zoomed in the same with <Mono>width=round(screen.width / k)</Mono> (with <Mono>device-width</Mono> the layout
        viewport would stay the screen's width, wider than what shows), at 1 the tag from <Mono>pos/index.html</Mono>.
        The browser lays the page out at the visible size / k: a 412 x 915 phone with the Full HD design is laid out
        1081 wide at 0.381; a 768 x 1024 tablet 1441 x 1921 at 0.533; an 810 x 1440 tablet 1080 x 1920 at 0.75; a
        1440 x 2560 screen 1080 x 1920 at 1.333. Never a CSS transform or zoom (vh / vw / container units, fixed
        positions and touches must match the page). A resize (turned, a folding phone opened) applies again. Every way
        out of the kiosk reloads or leaves the page, which brings the original tag back; the cleanup puts it back too.
        Computers' browsers and frames ignore the tag: there the shape is kept at the window's own size.
      </P>
      <P>
        <Mono>useKioskBox(screen, fixed)</Mono> (every window, frames included) places <Mono>.k-root</Mono>: its
        style gets <Mono>left / top / width / height</Mono> from <Mono>kioskBox(innerWidth, innerHeight)</Mono>{' '}
        (re-read on resize) and <Mono>--k-unit</Mono> (a hundredth of the box's short side), with{' '}
        <Mono>data-boxed</Mono>; with bars, a fixed <Mono>.k-bars</Mono> (<Mono>k-bars</Mono>) behind it in black or
        the design's Page colour. <Mono>.k-root</Mono> is <Mono>container-type: size</Mono>, and kiosk.css and the
        kiosk's Tailwind classes size from the box (<Mono>cqmin</Mono>, <Mono>cqh</Mono>, <Mono>cqw</Mono>; they
        used vmin / vh / vw, the window's); the root's own font size uses <Mono>--k-unit</Mono>, since container units
        on the container itself read a container outside it. Code that sizes from the screen in JS (the honeycombs'
        target size in <Mono>Menu.jsx</Mono> and <Mono>displays.jsx</Mono>) uses <Mono>boxShort()</Mono>. Pop-up
        sheets are absolute in the root, so they cover the kiosk and not the bars. <Mono>container-type</Mono> does
        not make the root the containing block for fixed elements in Chrome: the flying picture
        (<Mono>fly.js</Mono>, <Mono>position: fixed</Mono>) stays in window coordinates. Media queries on orientation
        still work: the box always has the window's orientation. The staff panel's Screen line
        (<Mono>k-staff-screen</Mono>) gives the screen's size, the design's, the zoom and where the bars are; its Card
        machine line (<Mono>k-staff-card</Mono>) names <Mono>config.card_machine</Mono>.
      </P>
      <P>
        The design editor's preview frame is the design's size (upright or turned); <Mono>Try on</Mono>{' '}
        (<Mono>kd-try-on</Mono>, <Mono>TRY_ON</Mono> in <Mono>KioskDesigner.jsx</Mono>, remembered in{' '}
        <Mono>maca_kiosk_preview_screen</Mono>) draws a frame of the window that screen would lay out (its size /{' '}
        <Mono>kioskZoom()</Mono>), in which the kiosk boxes itself, with a note (<Mono>kd-try-note</Mono>). The share
        page frames the kiosk at <Mono>share.screen</Mono> from <Mono>kiosk.ready</Mono>. A visit's{' '}
        <Mono>vp</Mono> events carry the box (<Mono>b</Mono>, below), and a replay uses it rather than working it out
        again (<Mono>useReplayBox()</Mono>), so a playback matches what the guest saw even after the design's screen
        changed.
      </P>
      <H3>Designs</H3>
      <P>
        <Mono>normaliseDesign()</Mono> fills every default and checks every value (unknown keys dropped,
        colours hex, numbers clamped, ids checked); the API stores only its output and the kiosk and the
        editor run it again. Empty words mean the kiosk's own words (<Mono>shared/kioskText.js</Mono>{' '}
        <Mono>UI_TEXT</Mono>, 140 words in 9 languages); typed words are translated under{' '}
        <Mono>{"TK.design(id, path)"}</Mono>. <Mono>designProblems(design, kiosk?)</Mono> lists what stops a
        design taking orders (no way to pay; a kiosk without a card reader and no pay at the counter).
      </P>
      <DataTable
        head={['Part', 'Fields']}
        rows={[
          ['brand', 'logo_url, colors { background, surface, text, muted, primary, primary_text, accent, accent_text, bar, bar_text, rail, rail_text }, font_heading / font_body (System or KIOSK_FONTS: the website fonts plus Oswald, Bebas Neue, Anton, Barlow Condensed, Archivo Black), radius 0-32, heading_case upper | normal. bar / bar_text / rail / rail_text (PART_COLORS) are the bottom bar\'s and the side menu\'s own colours: a colour code, else null (not set: never See-through); see Bottom bar and side menu colours below.'],
          ['layout', 'tiles (dishes: the menu, section tiles, the dish\'s photo, basket thumbs) and option_tiles (choices: option groups and combo steps; a group can have its own, groupLook()), each cards | round | oval | hexagon | plain (TILE_STYLES; plain = No frame: the picture whole and as it is, object-fit contain, no card, corners, shadow or background, for PNGs on a see-through background; a picked plain choice gets a drop-shadow glow in --k-primary, its name in that colour and the tick; option_tiles defaults to tiles when not set). hero beside | stacked (HERO_LAYOUTS: the top of a dish\'s page, Builder.jsx Hero; stacked puts the photo on top, min(64%, 560px) wide) with hero_image_align and hero_text_align left | center | right (HERO_ALIGNS, default center; on a wide screen the photo is always above the words in its own column and only hero_text_align applies there, also to a combo\'s pages, which draw the same Hero: heroTextAlign()). Hexagon dishes also give the whole kiosk the hexagon look. header (the bar along the top; default on), icon_buttons (Back and Start again as icons), option_pictures (default on; off = choices show only their words, in option_tiles\' shape; the split photo still uses the pictures), option_align left | center (OPTION_ALIGNS: a grid or honeycomb of choices and its heading). hero_backdrop (default on; data-hero-backdrop on the root: kiosk.css gives .k-hero-img and the order line\'s .k-thumb var(--k-shade), No frame ones the design\'s corners, and off clears the split photo\'s shade there too). combo_build (default on; data-combo-build on the root: a meal deal\'s picture from its picks, bundleParts() / bundleLayout() / BundlePhoto, see below). fly_to_order (default on; data-fly-to-order on the root: Add to order\'s picture flies into the order button, fly.js below). The editor sets tiles in the Menu panel, option_tiles, option_pictures and option_align in the Choices panel, and the rest in the Layout panel.'],
          ['start', 'layout split | full, media [{ id, type image | video, url, fit }] (8; fit: see Fitting pictures below), media_secs 3-30, headline, question, type_cards { [orderTypeId]: { label, icon eat_in | take_away | delivery | none, image_url } }, show_allergens'],
          ['see-through pictures', 'Not a setting: pos/src/kiosk/clear.js useClear(src) draws a picture at 48 x 48 on a canvas once per session and reports whether any pixel has alpha under 250 (another origin is loaded with crossOrigin anonymous; a picture that can\'t be read counts as opaque). Every kiosk picture of a dish, choice, section or pick goes through Pic in parts.jsx (Photo, SplitPhoto, CornerPicks, HexTile, the rail, bundle step tabs), which adds .k-clear and data-clear="1": kiosk.css then drops the picture\'s background, shows it whole (object-fit contain) and, for .k-corner-pick, drops the badge (radius, ring, clip) for a drop-shadow on the outline. Banners, featured tiles, start screen and reach media go through FitPicture (see Fitting pictures below), which uses the same check for Automatic; its inline object-fit wins over img.k-clear, so Fill crops a see-through picture when asked. The logo is left as it is.'],
          ['languages', 'source, enabled (KIOSK_LANGUAGES: en es ca fr de it pt nl pl; the source always on)'],
          ['menu', 'home, banners [{ id, type image | video (BANNER_TYPES), image_url (the picture, or a video\'s still), video_url (video only, else null), title, link { kind none | item | section, id }, fit }] (10; one without what it shows is left out), banner_secs 3-20 (how long a picture banner shows), banner_shape wide | short | tall | picture | own (BANNER_SHAPES, BANNER_RATIOS), banner_ratio { w, h } (whole numbers 1 to BANNER_SIDE_MAX 10000, default 16 x 7: the shape when banner_shape is own), featured [{ id, image_url, title, subtitle, size normal | wide, link, fit }] (12), rail images | text | none (RAIL_KINDS), section_tiles [{ section_id, image_url, title, size normal | wide }] (rail none: the tiles page order, deduped, 200), columns auto | 2-4, show_calories, show_descriptions, show_tags, quick_add, hidden_section_ids'],
          ['options', 'group_looks [{ group_id, display, tiles, pictures, entrance }] (option groups this design shows their own way, each part null = not set here; groupLook(), see Menus > Option group looks and types), entrance none | appear | slide | bubble | deal (CHOICE_ENTRANCES; the root\'s data-enter, a group\'s own on its choices: kiosk.css animates each grid / honeycomb / list / slider choice in turn, --k-ei from nth-child times --k-enter-step, backwards fill so the slider\'s own scale comes back, the wheel whole, off under prefers-reduced-motion; set in the Choices panel), display grid | list | slider | wheel (where a group or step has none), level_icon flame | star | dot, wheel_spin (the Spin button; default on), wheel_spin_picks (a spin stops on a choice that can be picked and picks it) (picks on the dish\'s photo are set per option group and combo step since migration 201, not in the design)'],
          ['checkout', 'pay_card, pay_counter, send_counter, counter_note, upsell, upsell_title, upsell_item_ids (8), number_kind tent | table (what the number asked for when the stream\'s ask_tent is on is called: tent_number / tent_hint and the Done screen\'s tent_done line, or table_number / table_hint; the value goes as check.tent either way), receipt off | ask | always, thanks'],
          ['done', 'The order done screen (migration 209\'s change; see The order done screen and receipts below): main auto | number | tent | name (DONE_MAIN; auto = the tent when one was typed, else the order number), lines (DONE_LINES number | tent | name | type, in order; default [number, tent]; [] is no lines), message, types [{ order_type_id, main, lines, message }] (50; each part null = as for every type; another tenant\'s order types dropped by ownDesign()), receipt_qr, receipt_email.'],
          ['behaviour', 'idle_secs 20-600, warn_secs 5-60, done_secs 5-120, reach, reach_media [{ id, type image | video, url, fit }] (up to 4: filling .k-reach-band while reach mode has slid the kiosk down, with Start.jsx Media taking turns every start.media_secs and k-reach-back at the foot; empty = the brand colour and the reach sign; pictures kept offline by configImages())'],
        ]}
      />
      <H3>The order done screen and receipts</H3>
      <P>
        What the screen after paying shows comes from three rules in <Mono>shared/kiosk.js</Mono> (unit-tested in{' '}
        <Mono>shared/test/kiosk.test.mjs</Mono>): <Mono>doneLook(design, orderTypeId)</Mono> (the type's row in{' '}
        <Mono>done.types</Mono> part by part, else <Mono>done</Mono>), <Mono>doneInfo(design, {'{ orderTypeId, number, tent, name, type }'})</Mono>{' '}
        (<Mono>{'{ main, value, lines: [{ key, value }], message }'}</Mono>: auto is the tent when one was typed,
        else the order number; a value the order hasn't got falls back to the first of number, tent, name it has;
        lines leave out the big one and empty ones) and <Mono>doneGaps(design, orderType)</Mono> (what a type's
        screen would show that its stream never asks for: <Mono>ask_name</Mono> / <Mono>ask_tent</Mono>{' '}
        <Mono>off</Mono>, <Mono>{'[{ key, big }]'}</Mono>; auto never counts). <Mono>Done</Mono> in{' '}
        <Mono>pos/src/kiosk/Checkout.jsx</Mono> draws it: <Mono>k-done-caption</Mono> (order_number, tent_number
        or table_number, order_for), <Mono>k-done-main</Mono> with <Mono>data-key</Mono>, <Mono>k-done-put</Mono>{' '}
        under a big tent (tent_put / table_put), a <Mono>k-done-line</Mono> each (order_line, tent_done / table_done,
        name_line, the type's name), <Mono>k-done-note</Mono> (paid_pending; card: none when a tent was typed,
        paid_note_name with the name big, else paid_note; counter: the design's counter note or counter_note(_sent)),{' '}
        <Mono>k-done-message</Mono> (<Mono>TK.design(id, 'done_message')</Mono> or{' '}
        <Mono>'done_message:' + typeId</Mono>). The countdown stops in a replay, for the editor's example
        (<Mono>state.doneHold</Mono>) and while the email sheet is open or sending, and starts again after.
      </P>
      <P>
        Receipts: <Mono>ReceiptQr</Mono> asks <Mono>receiptLink()</Mono> (store.js; a preview gets an example
        address and never calls the server) and draws <Mono>qrSvg()</Mono> (<Mono>k-receipt-qr</Mono>,{' '}
        <Mono>data-state</Mono> waiting | ready | failed); <Mono>EmailSheet</Mono> takes the address on{' '}
        <Mono>EmailKeyboard</Mono> (<Mono>parts.jsx</Mono>: digits, lower case, @ once, endings such as
        @gmail.com) inside <Mono>data-jprivate</Mono>, and <Mono>emailReceipt()</Mono> sends it. Neither is
        offered for an order still in the outbox (<Mono>result.pending</Mono>). Email is offered whatever the
        payment: a card order's reply has <Mono>sent_to</Mono>; a counter order's has{' '}
        <Mono>will_send_to</Mono> instead, and the screen says it goes once paid (<Mono>receipt.sent</Mono>{' '}
        = <Mono>waiting</Mono>, words <Mono>receipt_waiting</Mono>; the sheet's <Mono>receipt_email_hint_counter</Mono>).
        The visit's record (journey.js) keeps the sheet's state and the address's length
        (<Mono>receipt.mail</Mono>, <Mono>receipt.sent</Mono>, <Mono>receipt.mail_len</Mono>), never the
        address or its hint; a playback shows dots. The designer's <Mono>DonePanel</Mono> lists the preview
        stream's order types with their asks and <Mono>doneGaps()</Mono> notes (<Mono>kd-done-type</Mono>,{' '}
        <Mono>kd-done-gap</Mono>); <Mono>Show</Mono> and the toolbar's <Mono>kd-show-done</Mono> post{' '}
        <Mono>{"{ type: 'kiosk.show', screen: 'done', order_type_id }"}</Mono> to the frame, which shows an
        example order (<Mono>showDoneExample()</Mono>: Sam and tent 12 only where the type asks).
      </P>
      <P>
        <Mono>pos_receipts</Mono> (migration 209, RLS forced): one row per order whose receipt was asked for
        (<Mono>UNIQUE (tenant_id, check_id)</Mono>), its token, the kiosk, <Mono>emails</Mono>,{' '}
        <Mono>email_hint</Mono>, <Mono>emailed_at</Mono>, <Mono>views</Mono>, <Mono>last_viewed_at</Mono>. The
        page is drawn from the check as it is when opened, so a counter order paid later shows its receipt.
        The hourly AI clean-up job also runs <Mono>cleanUpReceipts()</Mono> (rows after 400 days). Tests:{' '}
        <Mono>api/test/kiosk-receipts.test.mjs</Mono> (a real kiosk order through the device routes, the page,
        a stand-in SendGrid, refusals, clean-up, counter orders paid at the till, cancelled, unpaid, refused
        by the provider, another tenant's sweep) and the receipt page in <Mono>system-paths.test.mjs</Mono>.
      </P>
      <P>
        Counter orders (migration 210): <Mono>kioskReceipt()</Mono> on an open check counts the email,
        stores the address sealed (<Mono>pos_receipts.email_to</Mono>, <Mono>seal()</Mono> in{' '}
        <Mono>services/vault.js</Mono>, in its <Mono>SEALED</Mono> list) with <Mono>email_hint</Mono> and{' '}
        <Mono>email_wanted_at</Mono>, and answers <Mono>{'{ url, sent_to: null, will_send_to }'}</Mono>; a
        later address replaces it. <Mono>sendWaitingReceipts({'{ tenantId, venueId, log }'})</Mono> runs after{' '}
        <Mono>POST /pos-api/events</Mono> whenever a changed check isn't open (not awaited) and from the
        minute hold sweep with no venue. In system mode it claims up to 25 rows whose check isn't open
        (<Mono>email_claimed_at</Mono>, <Mono>FOR UPDATE OF w SKIP LOCKED</Mono>, a claimed row waits 2
        minutes per failed try), then per row: a void check, a missing one or one with no active line
        clears it (<Mono>email_error</Mono> 'Order cancelled'); else <Mono>unseal()</Mono>, send through the
        venue's provider outside any transaction, and clear <Mono>email_to</Mono> with{' '}
        <Mono>emailed_at</Mono>. A failure counts <Mono>email_tries</Mono> and keeps the claim; at{' '}
        <Mono>MAX_TRIES</Mono> (6) the address goes. The sweep first clears addresses older than{' '}
        <Mono>WAIT_HOURS</Mono> (24, 'Not paid within a day'). A void check can't ask (422), and a direct
        send on a paid check clears any address still waiting for it. Partial index{' '}
        <Mono>pos_receipts_waiting</Mono>.
      </P>

      <H3>Bottom bar and side menu colours</H3>
      <P>
        <Mono>partColours(colors)</Mono> (<Mono>shared/kiosk.js</Mono>) is the one rule for what the bottom bar
        (every <Mono>.k-bar</Mono>: the menu, the order, details, paying, the allergens screen) and the sections
        down the side (<Mono>.k-rail</Mono> in <Mono>Menu.jsx</Mono>) are drawn in: each of{' '}
        <Mono>bar</Mono> / <Mono>bar_text</Mono> / <Mono>rail</Mono> / <Mono>rail_text</Mono> as set, else what
        it follows (<Mono>PART_FOLLOWS</Mono>): the bar follows <Mono>text</Mono> and the side menu{' '}
        <Mono>surface</Mono> (See-through when the cards are), and words not set take whichever of{' '}
        <Mono>background</Mono> and <Mono>text</Mono> has the higher contrast on their part
        (<Mono>contrast()</Mono> from <Mono>shared/themeKit.js</Mono>; a see-through part counts as the page; a
        tie keeps what each used before, Page on the bar and Text on the side menu). With nothing set it gives
        exactly the look from before these existed (bar in Text with Page words, side menu in Cards with Text
        words). <Mono>KioskApp.jsx</Mono> turns it into <Mono>--k-bar</Mono>, <Mono>--k-bar-text</Mono>,{' '}
        <Mono>--k-rail</Mono> and <Mono>--k-rail-text</Mono>; kiosk.css draws <Mono>.k-bar</Mono> and{' '}
        <Mono>.k-rail</Mono> with them, Back on a bar (<Mono>.k-bar .k-btn-back</Mono>) solid in the words colour
        with the bar colour for its words, the outlined bar buttons (<Mono>.k-btn-onbar</Mono>, the hexagon
        tint) from the words colour, and the picked section with <Mono>--k-rail-on</Mono> (12% of the Buttons
        colour on the side menu&apos;s colour). A dish&apos;s own page (<Mono>AddBar</Mono>, the combo bar) keeps
        its bar in Cards, and the top bar stays in Cards.
      </P>
      <P>
        The designer (Brand card) lists them under the main colours (<Mono>ColourPicker</Mono>{' '}
        <Mono>optional</Mono>, placeholder Same as Text / Same as Cards / Automatic, <Mono>fallback</Mono> = the
        colour in use for the colour box, Reset), warns on <Mono>PART_PAIRS</Mono> only once either colour of a
        pair is set (and on the side menu only when the design has one), and the Brand summary says own bottom
        bar / own side menu. The colour sets and <Mono>kioskBrandFromKit()</Mono> (the theme maker, Use the
        brand) don&apos;t carry them, so they follow the new colours. Not part of any menu release.
      </P>
      <H3>Fitting pictures</H3>
      <P>
        Each home page banner, featured tile, start screen picture or video and reach picture carries a{' '}
        <Mono>fit</Mono>, read by <Mono>pictureFit()</Mono> (<Mono>shared/kiosk.js</Mono>):{' '}
        <Mono>{"{ mode auto | cover | contain, focus, size, bg }"}</Mono>. <Mono>mode</Mono>{' '}
        (<Mono>PICTURE_FITS</Mono>, default auto) is cover (fill the space, cropped, <Mono>focus</Mono> kept
        in view), contain (the whole picture, <Mono>size</Mono> % of the space, placed at <Mono>focus</Mono>,
        on <Mono>bg</Mono>) or auto (contain for a picture with a see-through background, cover for anything
        else, so a design saved before this looks as it did, a see-through featured picture included).{' '}
        <Mono>focus</Mono> is one of <Mono>PICTURE_FOCUS</Mono> (the nine CSS object-position keywords, default
        center), <Mono>size</Mono> 30-100 (<Mono>PICTURE_SIZE_MIN</Mono>, default 100; only for a whole
        picture), <Mono>bg</Mono> none | surface | primary | accent | text (<Mono>PICTURE_BGS</Mono>, a design
        colour behind a whole picture; none lets the page show through).{' '}
        <Mono>fitLayout(fit, clear)</Mono> turns it into styles: <Mono>whole</Mono>, <Mono>box</Mono> (flex
        alignment for the focus), <Mono>media</Mono> (width and height as %, object-fit, object-position) and{' '}
        <Mono>bg</Mono>. <Mono>FitPicture</Mono> in <Mono>pos/src/kiosk/parts.jsx</Mono> draws it (an absolute
        box over its parent, the picture or video inside, <Mono>useClear()</Mono> for Automatic,{' '}
        <Mono>--k-surface</Mono> / <Mono>--k-primary</Mono> / <Mono>--k-accent</Mono> / <Mono>--k-text</Mono>{' '}
        behind it; <Mono>data-whole</Mono> and <Mono>data-focus</Mono> for tests). Banners, featured tiles
        (<Mono>Menu.jsx</Mono>), start screen media and the reach band (<Mono>Media</Mono> in{' '}
        <Mono>Start.jsx</Mono>, used by both) all use it; its inline object-fit beats{' '}
        <Mono>img.k-clear</Mono>&apos;s contain, so Fill crops a see-through picture when asked.
      </P>
      <P>
        <Mono>menu.banner_shape</Mono> (<Mono>BANNER_SHAPES</Mono>, default wide) sets the banner&apos;s
        width to height, worked out only by <Mono>bannerRatio(menu, measured)</Mono> in{' '}
        <Mono>shared/kiosk.js</Mono>: <Mono>BANNER_RATIOS</Mono> wide 16/7 (as before), short 3, tall 16/9;
        picture (each banner the ratio of its own picture or video, measured on load in <Mono>Banners</Mono>{' '}
        from naturalWidth / videoWidth; wide until it loads); or own (<Mono>menu.banner_ratio</Mono>{' '}
        <Mono>w / h</Mono>, kept between <Mono>BANNER_RATIO_MIN</Mono> 1 (square) and{' '}
        <Mono>BANNER_RATIO_MAX</Mono> 10). The banner keeps its <Mono>max-h-[36cqh]</Mono> cap (a third of the
        kiosk&apos;s box), so on a wide screen it is usually the cap that sets the height and the fit decides
        how the picture sits in the wider box. The designer
        (<Mono>KioskDesigner.jsx</Mono>) has <Mono>PictureFit</Mono> under each banner, featured tile with a
        picture, start screen and reach item (a Fit summary, <Mono>fitSummary()</Mono>, that opens the mode,
        a 3 x 3 position grid, Size and Behind it), and the Banner shape row in the Menu panel once there is a
        banner; the Menu summary names a shape other than wide. Not part of any menu release; old designs read
        as auto and wide.
      </P>
      <P>
        Video banners (6 Nov 2026): a banner of <Mono>type</Mono> video is drawn by <Mono>Banners</Mono>{' '}
        (<Mono>Menu.jsx</Mono>) as <Mono>FitPicture video</Mono> (muted, autoPlay, playsInline, the still as
        its poster, <Mono>loop</Mono> only when it is the only banner). Banners take turns by a timeout per
        banner, not an interval: a picture waits <Mono>banner_secs</Mono>, a video moves on at{' '}
        <Mono>onEnded</Mono>; a video that fires <Mono>onError</Mono> is marked failed for that visit to the
        home page and drawn as its still (or nothing) for the picture seconds. The banner button carries{' '}
        <Mono>data-type</Mono>; its tap passes the <Mono>img, video</Mono> inside to <Mono>linkTo()</Mono>,
        and <Mono>flyToBasket()</Mono> flies a video as a canvas of the frame it shows (<Mono>videoFrame()</Mono>{' '}
        in <Mono>fly.js</Mono>, the video&apos;s classes and styles copied so it is cropped the same way), never
        a second video element. Banner videos are in <Mono>configVideos()</Mono>, so the kiosk keeps them with
        the start screen&apos;s and reach band&apos;s (<Mono>MAX_SAVED_VIDEOS</Mono> 22). Designer:{' '}
        <Mono>BannerList</Mono> has a Picture / Video switch per banner (<Mono>kd-banner-type</Mono>), Pick a
        video from Media (<Mono>MediaLibraryModal kind=&quot;video&quot;</Mono>, <Mono>kd-banner-video</Mono>)
        with an optional still picture (<Mono>kd-banner-still</Mono>); the Banner shape chips (
        <Mono>kd-banner-shape</Mono>, <Mono>data-shape</Mono>) with <Mono>BannerRatioEdit</Mono> for Set your
        own (Width and Height boxes, a sketch <Mono>kd-banner-ratio-sketch</Mono> drawn with{' '}
        <Mono>bannerRatio()</Mono>, notes <Mono>kd-banner-ratio-note</Mono> when clamped); the Menu summary
        from <Mono>bannersText()</Mono>. Designs saved before read every banner as a picture and the ratio as
        16 x 7. Tests: the banner tests in <Mono>shared/test/kiosk.test.mjs</Mono>, the video banner test in{' '}
        <Mono>api/test/kiosk-design.test.mjs</Mono>.
      </P>
      <H3>Menus</H3>
      <P>
        <Mono>menu_variant_groups</Mono> gains <Mono>kiosk_display</Mono> (NULL = the design's),{' '}
        <Mono>scale_low</Mono> / <Mono>scale_high</Mono>; <Mono>menu_variant_options</Mono> gains{' '}
        <Mono>image_url</Mono>, <Mono>description</Mono>, <Mono>level</Mono> (0-5). Like the rest of the
        group library they change straight away, not per publish. An option's <Mono>sort_order</Mono> in
        the group body is now optional (left out = its place in the list; a default of 0 had sorted new
        groups by name). A combo step has <Mono>display</Mono>; a typed-in choice has{' '}
        <Mono>image_url</Mono> and <Mono>description</Mono> (<Mono>normaliseCombo()</Mono>,{' '}
        <Mono>stepChoices()</Mono> passes them, and a dish choice its own photo and description).{' '}
        <Mono>comboItemIds()</Mono> lists every dish a combo can hold: the kiosk shows a combo's allergens as
        the strongest level of each over all of them ("Depends on what you choose"), and the order page the
        allergens of what was picked.
      </P>
      <H3>Allergens and diets a guest picks</H3>
      <P>
        <Mono>shared/kiosk.js</Mono> holds the rules: <Mono>dishLevels()</Mono>, <Mono>mergeLevels()</Mono>,{' '}
        <Mono>itemLevels(config, item, ctx)</Mono> (moved from the kiosk store), <Mono>cleanPrefs()</Mono>,{' '}
        <Mono>prefsOn()</Mono>, <Mono>guestFit(config, item, prefs, ctx)</Mono> and{' '}
        <Mono>countFits(config, itemIds, prefs, ctx)</Mono>. <Mono>guestFit()</Mono> returns null with no
        picks, else <Mono>{'{ ok, avoid: [{ code, level }], removable, missing, some }'}</Mono>: a dish is
        judged on its own tags (contains and may contain don't suit; removable suits, with a note; a diet it
        isn't tagged with doesn't suit). A combo: its own tags, then each step with <Mono>min &gt; 0</Mono> and
        no <Mono>when</Mono> needs a choice, not sold out, that suits (a typed-in choice has no tags: fine for
        allergens, never a diet); a diet also needs such a step or the combo's own tag; its avoid list is the
        guest's allergens on any dish it can hold, and <Mono>some</Mono> is true when it suits anyway.{' '}
        <Mono>countFits()</Mono> counts the kiosk's dishes once each, sold out ones left out. The picks are
        the kiosk's state only (never sent, never stored); the menu reads them through{' '}
        <Mono>fitOf()</Mono> / <Mono>countFor()</Mono> in <Mono>store.js</Mono>. Words: <Mono>avoid_title</Mono>,{' '}
        <Mono>diet_title</Mono>, <Mono>tap_all</Mono>, <Mono>pick_prompt</Mono>, <Mono>suits_count</Mono>,{' '}
        <Mono>suits_one</Mono>, <Mono>suits_none</Mono>, <Mono>marked_note</Mono>, <Mono>see_menu</Mono>,{' '}
        <Mono>clear_all</Mono>, <Mono>marked_for_you</Mono>, <Mono>change</Mono>, <Mono>not_marked</Mono>,{' '}
        <Mono>some_choices_contain</Mono>, <Mono>check_this</Mono> in nine languages (the old free_from,
        show_all, no_dishes and allergens_intro are gone).
      </P>
      <P>
        A meal deal's picture from its picks (<Mono>design.layout.combo_build</Mono>, default on):{' '}
        <Mono>bundleParts(config, item, picks, own)</Mono> in <Mono>shared/kiosk.js</Mono> lists the parts in step
        order: every step's picks with a picture (the choice's <Mono>photo_url</Mono>, else the picked dish's photo or a
        typed-in choice's <Mono>image_url</Mono>; none = left out), then the deal's own option groups' picks where the group
        has <Mono>kiosk_pick_photo</Mono>. Sizes: the first step with a picture that isn't <Mono>pick_photo: 'corner'</Mono>{' '}
        gives <Mono>main</Mono>; corner steps and every corner pick (a picked dish's own and the deal's) <Mono>small</Mono>;
        the rest <Mono>side</Mono>. A picked dish keeps its own split picks on its picture (<Mono>pickImages()</Mono>).
        Each part's <Mono>sig</Mono> changes with its picture; at most <Mono>BUNDLE_MAX</Mono> (8); none = the deal's own
        photo. <Mono>bundleLayout(parts, bundleBox(tiles, square))</Mono> gives each part a square: mains in the middle of
        a row, sides in the order picked taking turns left then right (the first left, the second right, the third
        further left, the fourth further right) at 0.72 of the main's size, overlapping by 28% of the narrower, each
        step out <Mono>BUNDLE_DEPTH</Mono> (8% of the main) further back up and behind; smalls (0.36) in front under
        the mains, in the order picked. Across, the middle of the main(s) is the middle of the box (no main: the
        middle of the whole), so the scale comes from the wider half (<Mono>halfW</Mono>: with one side, the picture
        is as big as with one each way); top to bottom the whole is centred; all as big as fits the box
        (<Mono>bundleBox()</Mono>: the dish picture style's shape, 4:3, round 1:1,
        hexagon .866, and the share kept clear at the edges, round and oval 15%, hexagon 17%, cards 3%, No frame 0).{' '}
        <Mono>BundlePhoto</Mono> (<Mono>parts.jsx</Mono>) draws each part with <Mono>PickPhoto</Mono> keyed by its{' '}
        <Mono>sig</Mono> (cut-outs as they are with a drop shadow, photos in a small frame: <Mono>.k-bundle-pic</Mono>); with{' '}
        <Mono>seen</Mono> (a ref <Mono>ComboBuilder</Mono> keeps across its pages, sig to when first shown) a part first
        shown under 900 ms ago gets <Mono>k-bundle-new</Mono> (a pop; none with reduced motion) while the others slide
        over (a transition on left / top / width / height). Used by <Mono>HeroPhoto</Mono> on the deal's pages (a picked
        dish's options page shows that dish) and by the order line (square, no pop). On a wide screen the combo's
        picture sits in a sticky <Mono>k-combo-photo</Mono> block at the top of the side column, the hero's words under it
        (<Mono>Hero photo={'{false}'}</Mono>), and the steps rail brings the active step into the space below it, no
        further than needed, also after a pick changes the tab's size.
      </P>
      <P>
        Picks on the dish's photo (migration 201, replacing 185's on / off switch and the design's{' '}
        <Mono>options.pick_photos</Mono>): <Mono>menu_variant_groups.kiosk_pick_photo</Mono> (NULL | split |
        corner; live like the rest of the library, in <Mono>kioskConfig()</Mono>'s groups) and a combo
        step's <Mono>pick_photo</Mono> (in <Mono>menu_items.combo</Mono>, published with the menu; the Zod{' '}
        <Mono>ComboStep</Mono> takes it, <Mono>cleanCombo()</Mono> stores it only when set and the
        editor's <Mono>comboPayload()</Mono> sends it only when set, so steps without it don't read
        as changed; <Mono>normaliseCombo()</Mono> fills <Mono>null</Mono>). The migration gave groups and
        steps that had the switch on <Mono>corner</Mono> where every kiosk design of the tenant said corner,
        else <Mono>split</Mono>, rewrote release snapshots the same way (re-hashed at start) and dropped{' '}
        <Mono>pick_photos</Mono> from designs.{' '}
        <Mono>pickImages(config, item, selection)</Mono> in <Mono>shared/kiosk.js</Mono> is the one
        rule, returning <Mono>{'{ split: [src], corner: [{ src, scale }] }'}</Mono>: steps (a choice's <Mono>photo_url</Mono>, else a picked dish's photo or a typed-in choice's picture), then groups
        (the library option's <Mono>photo_url</Mono>, else its <Mono>image_url</Mono>), each into the list its group or step names, in pick order, an option once, at most <Mono>SPLIT_MAX</Mono> (6) each; both empty = the dish's photo.
        Two pictures per choice (migration 199): <Mono>image_url</Mono> is the choice's own tile (every
        display, the bundle's step tabs), <Mono>photo_url</Mono> the one on the dish's photo
        (<Mono>menu_variant_options.photo_url</Mono>, in <Mono>loadVariantGroups()</Mono>, the group POST / PATCH
        (a PATCH without it clears it, the editor always sends it), the copy route and <Mono>kioskConfig()</Mono>'s groups;
        a combo choice's <Mono>photo_url</Mono> in <Mono>menu_items.combo</Mono>, any type but section, stored only when set
        by <Mono>cleanCombo()</Mono>, <Mono>normaliseCombo()</Mono> and <Mono>comboPayload()</Mono>, passed on by{' '}
        <Mono>stepChoices()</Mono>). <Mono>configImages()</Mono> keeps both on the kiosk. Admin: <Mono>OptionPicture</Mono>{' '}
        (Tile / On dish / On meal) in <Mono>VariantGroupsManager.jsx</Mono>, used by <Mono>ComboEditor.jsx</Mono>.{' '}
        <Mono>PickPhoto</Mono> (<Mono>parts.jsx</Mono>, prop <Mono>picks</Mono>) draws both: the split ones
        as one picture in place of the photo or, two or more, with <Mono>SplitPhoto</Mono>; then the corner
        ones with <Mono>CornerPicks</Mono> on top of whatever that is (<Mono>.k-corner-main</Mono>) with the pictures small (<Mono>.k-corner-pick</Mono>, the choices' picture
        style, lined up along the bottom keeping their own shape) along its bottom right, in the middle of the bottom on a
        round, oval or hexagon photo. Their size (migration 205): <Mono>menu_variant_groups.kiosk_pick_scale</Mono>{' '}
        and a combo step's <Mono>pick_scale</Mono> (a whole % of the photo's width, 10 to 70, kept only with corner:
        the group routes null it otherwise, <Mono>cleanCombo()</Mono> and <Mono>comboPayload()</Mono> store it only when
        set; <Mono>pickScale()</Mono> and <Mono>PICK_SCALE_MIN</Mono> / <Mono>MAX</Mono> in <Mono>shared/combos.js</Mono>);
        NULL = automatic. <Mono>cornerWidths(corner)</Mono> in <Mono>shared/kiosk.js</Mono> turns them into widths along the
        strip (92% of the photo, 2% gaps): a size is scale / 0.92, automatic min(26, 92 / n - 3), and when they
        don't fit all shrink by one factor with the gaps kept. Admin: <Mono>PickScale</Mono> in{' '}
        <Mono>components/menus/shared.jsx</Mono> (Automatic / Set a size, slider, - / +, a sketch of the photo),
        under Small in the corner in <Mono>VariantGroupsManager.jsx</Mono> and each <Mono>ComboEditor.jsx</Mono> step. <Mono>SplitPhoto</Mono>: every picture covers the whole box
        (object-fit cover) and is clipped to its part with a percent <Mono>polygon()</Mono>; the tears are
        seeded jagged lines (the same for the same number of parts), the parts overlap 0.4% under a paper
        band of 0.44% to 1.45% with a drop shadow, so no gap shows. Used on the dish page's photo, a
        combo's photo (and its review page when upright) and the order line's thumbnail.
      </P>
      <P>
        <Mono>menu_translations</Mono> (tenant, lang, key, text) holds the menu's words in other languages.
        Keys come from <Mono>TK</Mono> (item / variant / section / group / option / combo step and choice /
        order type / tag / notice / design / ui) and point at stable ids, so a translation follows its dish
        through edits and publishes. <Mono>translationSources()</Mono> lists every word a kiosk can show
        (from the drafts, so a new dish can be translated before it is published).
      </P>
      <H3>The kiosk app (pos/src/kiosk)</H3>
      <DataTable
        head={['File', 'What it does']}
        rows={[
          ['store.js', 'State (section: a section id, \'home\', or \'tiles\' for the section tiles page; startOrder() opens the tiles when the design has no rail); bootKiosk() (IndexedDB kiosk_config, kiosk_outbox), bootPreview() (listens for kiosk.design, kiosk.restart, kiosk.show { screen: menu } from the parent window, then posts kiosk.ready); loadConfig() with version (fetchConfig(): true when the server answered, a 4xx counts, 5xx and no reply don\'t); the connection: link up | checking | down (state.link, state.online = not down). A dropped or failed live link, a heartbeat with no pong (a ping every 15 s on the socket, 6 s to answer; only once the server\'s connected message says heartbeat: true, answered in config/ws.js), a request with no reply or the browser\'s offline event: linkTrouble() makes two quick tries (after 1 s and 2 s more, 4 s timeout each) and only then link down (ordering paused), then keepChecking() every 5 s until linkOk(); the online event checks at once; socket pos.config reloads, pos.revoked forgets; placeOrder(); the outbox for card orders paid but not sent (sent again until accepted; the guest gets the order number at once: the kiosk numbers its own orders, takeNumbers() with tradingDay from the config\'s trading_day); textsFor() (translations, then UI_TEXT, money with narrowSymbol); allergen levels (itemLevels(): a combo is the union of its dishes).'],
          ['fly.js', 'flyToBasket(from): Add to order\'s flight. A copy of the picture (from.cloneNode(true): the dish page\'s .k-hero-img, a card\'s .k-item-img, a hexagon\'s .k-hex without its band, marks and fit badge, an upsell card\'s photo) goes into .k-root (so the root\'s picture style classes and --k-* colours still apply) as .k-fly, fixed, its place and size inline, then animates (Web Animations, FLY_MS 700) to the middle of the first visible [data-fly-target=basket] (the menu\'s View order, the order page\'s Checkout): a small lift, then faster and smaller into it (end scale about the button\'s icon), fading to 0.55; on landing it is removed and the button found again (the bar may have been drawn again) gets a scale(1.12) bounce. Returns false (no flight) without a picture, a target or animate(), with prefers-reduced-motion or the design\'s layout.fly_to_order off (data-fly-to-order on the root). Callers pass the result to addToBasket(entry, key, { flew }), which then leaves the order button\'s own k-bump (state.added) to the landing. Wired in DishBuilder and ComboBuilder (heroPicture(), not when editing: builder.key), tapItem(item, ..., { from }) for + and plain dishes in Menu.jsx (and banners / featured tiles that add a dish), and the order page\'s "Anything else?". A video (a video banner) flies as a canvas of the frame it is showing (videoFrame(): its classes and inline styles copied), so no second video starts.'],
          ['photos.js', 'savePhotos(config, report): every picture the config can show (configImages() in shared/kiosk.js: logo, start pictures (not videos), every image_url / logo_url, own origin only, each once, at most MAX_SAVED_PICTURES) that the kiosk-images cache (service worker, StaleWhileRevalidate, 2000 entries, a year) doesn\'t have yet, loaded as <img> three at a time (a fetch() wouldn\'t match the picture rule); counted again from the cache after. Run after each config change, at boot and when the link comes back; previews never run it. state.photos { total, saved, busy } for the staff panel (saved null = no service worker). Then saveVideos(config, report): the design\'s videos (configVideos(): start screen, reach band and home page banners, own origin, at most MAX_SAVED_VIDEOS 22) downloaded whole with fetch() one at a time (status 200 and a video type only, 10 minute limit) into the kiosk-videos cache; the service worker\'s video route (request.destination video, CacheFirst, rangeRequests, cacheableResponse 200, matchOptions ignoreVary) slices the Range requests a video element makes out of the saved file, and a video not saved plays from the network. Videos the design no longer plays are deleted. state.videos for the staff panel.'],
          ['KioskApp.jsx', 'The design as CSS variables (--k-*), fonts, the idle warning and restart, reach, wake lock (not in the preview), the small-screen zoom (useKioskViewport(), viewport.js), the staff panel (Screen and Card machine lines among others), screens. Root classes k-tiles-<style> (data-tiles) and k-icons drive the layout options in kiosk.css; data-option-pictures and data-option-align say how choices show (for tests; the displays read the design themselves).'],
          ['Start / Menu / Builder / OptionGroup / Checkout / Allergens', 'Start screen; menu with rail (or SectionTiles: the home page above a tile per section, the design\'s order first; a section opened from it gets Back in the order bar), home page and dish cards (ItemHex in a HexGrid for hexagons); TopBar (logo and LanguageButton, none with layout.header off: the language button moves to the bottom bar), RestartButton (Start again with its confirm sheet, after Back in the bottom bars of the menu, basket, name / table number and pay; not on the card reader or in the builder); the dish and combo builder (the Add / Continue button points at the first choice still missing; Hero: the dish page\'s top, beside or stacked with the photo SELF-aligned and the words in a k-align-<left|center|right> column, data-hero / data-image-align / data-text-align / data-item, props price (undefined = the dish\'s priceLabel(), null = none, or a node) and note (k-hero-note); a combo draws one Hero per page from its subject (a part page: the picked dish with its own pickImages() and the note ui(\'in_deal\'); else the combo with the steps\' picks), in the page upright, in the side column above the step tabs on a wide screen, and shows the running price once: the TopBar, or with the header off the combo hero\'s k-combo-price, or k-combo-head (the combo\'s name and price) above a picked dish\'s hero; a combo: the step page\'s heading is the step name right above its choices (no ruleText line; a step with max > 1 shows got/max beside it, k-step-picked), Step n of N (k-step-count, the big button\'s 1.2em / 700) beside Continue but not on the review page, and a done step\'s tab (data-picked) shows pickedOf(): its picks\' pictures (k-opt-thumb k-step-thumb, up to three, overlapping) with the names under them upright or beside them on a wide screen; a part or own-options page shows its groups\' picks the same way (groupPicks())); one option group in its display; basket, upsell, name and table number (keyboard / number pad), pay, test card reader, order number; the allergens screen (Allergens.jsx, below).'],
          ['Allergens.jsx / fit.jsx', 'The allergens screen: the allergen notice (noticeOf(config.allergen_notice), TK.notice words), TagPicks for the allergens to avoid (every allergen tag) and the diets (dietary tags some kiosk dish carries), the count from countFor() (k-fit-result, data-fits / data-total), Clear all, See the menu (go(\'menu\') when ordering, else the order type sheet, or startOrder() with one type; hidden while ordering is paused, orderingClosed() in Start.jsx). The picks are state.prefs { avoid, diet } (setPrefs(), cleared by restart()). fit.jsx: needsCheck(fit), FitMark (the yellow mark, k-fit-mark / k-fit-badge), FitNote (Contains / May contain / Some choices contain / Can be removed / Not marked, names in mark.k-fit-hl), PrefsStrip (top of the menu, Change), tagName(). Menu.jsx passes fitOf(config, item) to ItemCard / ItemHex (data-fit check | ok); Builder.jsx: AllergenLine highlights prefs.avoid, HeroFit on the dish page and a combo\'s side column, step choices carry mark / note / check for the displays (data-fit on each option).'],
          ['displays.jsx', 'GridDisplay (a compact HexGrid of HexOption when the choices\' style, layout.option_tiles, is hexagon), ListDisplay, SliderDisplay (sorted by level when a scale shows), WheelDisplay (up to 16 on the wheel, the rest in a grid below; Spin only with wheel.spin; with wheel.picks a spin turns to a random choice that can be picked and calls onTap when it stops, the card under the pointer hidden while it spins); the same props (plus wheel), so any group or step can use any. choiceLook(design, group) gives every display tiles and pictures (groupLook(): the design\'s look for the group, else the group\'s own, else layout.option_tiles / option_pictures) and center (layout.option_align === \'center\'); OptionGroup and Builder spread it into the display and centre their heading with it. Without pictures a card is a Face (name, level marks, description) above the price, round / oval / hexagon cards draw the face in that shape (.k-opt-face in kiosk.css), a hexagon grid uses HexTile words (.k-hex-words: no photo, the name in the middle), and the list, slider and wheel leave their thumbnails and photos out. Centred: the compact HexGrid takes center (justify-content), cards wrap in a centred flex row of fixed-width cards instead of the grid.'],
          ['parts.jsx / kiosk.css', 'Sheets (close on a click of the backdrop), number pad, level marks, photos; :where(.k-root) button keeps button colour inheritance at the lowest weight. BackButton: every screen\'s way back, a solid button (.k-btn-back: the text colour on a light bar, the page colour on the dark .k-bar) first in the screen\'s bottom bar; no screen has a Back at the top (the builder\'s top bar is the item name and a combo\'s price). Back and Start again put their words in .k-btn-label with aria-label (.k-icons hides the label and makes them square). SplitPhoto / PickPhoto (the split photo). HexGrid: measured width, n columns (a number or as many as fit at about target px), positions from hexLayout() in shared/kiosk.js (half-hexagon columns; every other row moved over half a hexagon, a row only moved by whole hexagons): dishes fill the width with rows of n and n - 1; compact (choices) makes two rows from three hexagons on (3 = 2 + 1, 4 = 2 + 2, 5 = 3 + 2) while they fit, else rows of n and n - 1 with the last one centred, cells at most maxCell px in fixed columns; cells w wide and w / 0.866 high with -h/4 bottom margin so rows lock together; HexTile: a clip-path hexagon (the ring in the button colour when picked) with the photo, a band of words, marks at the top and extra buttons outside the shape. Round / oval / hexagon in kiosk.css, on two root classes: .k-tiles-<style> for dishes (.k-item, .k-item-img, .k-thumb in the basket, .k-hero-img, .k-rail-img) and .k-opts-<style> for choices (.k-opt, .k-opt-img, .k-opt-thumb in the list and wheel, .k-opt-tick / .k-opt-less): no card behind, photos in a circle, ellipse or hexagon; hexagon dishes also give buttons, chips and cards hexagon ends, round buttons and badges flat hexagons, and a faint honeycomb behind the screens (a masked ::before).'],
        ]}
      />
      <P>
        A pay-at-counter order whose reply is lost keeps its events: Try again sends the very same ones,
        the server skips event ids it already has and returns the order number for the duplicate, so the
        till never gets the order twice.
      </P>
      <H3>Admin</H3>
      <P>
        Store tech → Kiosks: <Mono>components/pos/KiosksSection.jsx</Mono> (kiosks with their design,
        stream, card reader, receipt printer and problems; <Mono>kioskDesign()</Mono>). Store tech →
        Kiosk designer (<Mono>/pos/kiosk-designs</Mono>, <Mono>KioskDesignsSection</Mono> in the same
        file, since migration 241): the designs with copy / delete. Design editor:{' '}
        <Mono>pages/KioskDesigner.jsx</Mono>{' '}
        (<Mono>/pos/kiosk-designs/:id</Mono>): panels over the raw draft (text) and the normalised design
        (everything else), the preview frame at 1080 x 1920 or 1920 x 1080 scaled to fit, the design posted
        to the frame's own origin after <Mono>kiosk.ready</Mono>, Save / Discard / leave confirm, view only.
        Save as (<Mono>SaveAsDialog</Mono>, manage only): <Mono>POST /api/pos/kiosk-designs</Mono> with the
        typed name and the normalised draft, so the same <Mono>ownDesign()</Mono> checks and 50-design limit
        apply; <Mono>savedAs()</Mono> puts the new row into the <Mono>['kiosk-designs']</Mono> query, resets
        the save mutation and the leave confirm, and navigates to it. The editor stays mounted across the id
        change: its load effect keys on the row id (<Mono>loadedFor</Mono>), so the draft, the saved copy and
        the dirty check move to the new design, and the preview link is made again (its query key has the
        id). The original keeps its saved settings and its share.
        Panels: Brand, Layout (<Mono>LayoutPanel</Mono>: tile style, top bar, icon buttons), Start screen,
        Languages, Menu (rail with <Mono>SectionTilesList</Mono> for none: every section the kiosk shows,
        drag order, picture, words, width), Choices (display, wheel spin, level marks), Paying, Timing.
        Translations: <Mono>pages/MenuTranslations.jsx</Mono> (<Mono>/menus/translations</Mono>, nav link
        from migration 172). Option groups: <Mono>components/menus/VariantGroupsManager.jsx</Mono>; combo
        steps: <Mono>components/menus/ComboEditor.jsx</Mono> (both with a Picks on the dish's photo choice: No, Split the photo, Small in the corner); pictures in those rows:{' '}
        <Mono>components/media/PicturePick.jsx</Mono> (pick from Media or drop a file).
      </P>
    </section>
  )
}
