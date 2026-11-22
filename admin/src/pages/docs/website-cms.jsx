// src/pages/docs/website-cms.jsx
// The Docs page's "Website CMS" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, Code, DataTable, InfoBox } from './parts.jsx'

export const id = 'website-cms'
export const label = 'Website CMS'
export const order = 430

export function Section() {
  return (
    <section id="website-cms" data-doc="">
      <H2>Website CMS</H2>
      <P>
        Multi-tenant website builder. Each tenant gets a branded public site served
        server-side by the Fastify API at <Mono>{'{slug}.macaroonie.com'}</Mono> or a
        verified custom domain. All content is tenant-scoped via the existing RLS model.
      </P>

      <H3>Database schema</H3>
      <P>Six tables introduced across migrations 025 + 026. All RLS-enabled:</P>
      <DataTable
        head={['Table', 'Purpose']}
        rows={[
          ['website_config',         'Singleton per tenant (UNIQUE tenant_id). 60+ columns covering identity, branding, hero, about, find-us, contact, social, ordering, delivery, SEO, analytics, feature toggles, + custom_domain, custom_domain_verified, template_key, theme (JSONB).'],
          ['website_opening_hours',  '7-day grid with multiple sessions per day (day_of_week, opens_at, closes_at, is_closed, label, sort_order).'],
          ['website_gallery_images', 'Ordered gallery images (image_url, caption, sort_order).'],
          ['website_pages',          'Custom CMS pages — UNIQUE (website_config_id, slug). Content is free HTML.'],
          ['website_menu_documents', 'PDF menu uploads with labels, per location (website_config_id). website_config.show_menu (default true) gates them: off, the venue bundle loads none, so the menu_pdfs block renders nothing, /locations/:slug/menu is 404 and JSON-LD hasMenu is left out. The page builder hides the block from its picker (BlockAvailabilityContext in canvas/BlockInserter.jsx, computed in PageBuilder.jsx from the page\'s venue or the only venue) and its canvas shows a Hidden placeholder. Every PAGE_TEMPLATES starter except From scratch includes the block.'],
          ['website_allergen_info',  'Singleton per config; info_type = document | structured. Structured data is a JSONB array of {dish, allergens[], notes}.'],
        ]}
      />
      <InfoBox type="info">
        The subdomain slug is a <strong>global</strong> namespace (UNIQUE on
        website_config.subdomain_slug). Separate from tenants.slug (Auth0 lookup).
        Use <Mono>GET /api/website/slug-available?slug=...</Mono> before POSTing.
      </InfoBox>

      <H3>Theme JSONB shape</H3>
      <P>
        <Mono>website_config.theme</Mono> stores per-tenant styling. Any missing key
        falls back to defaults hard-coded in <Mono>views/site/shared/head.eta</Mono>.
      </P>
      <Code>{`{
  "colors":     { primary, accent, background, background_image, surface, text, muted, border },
  "typography": { heading_font, body_font, base_size_px, heading_scale,
                  heading_weight, body_weight, line_height, letter_spacing },
  "spacing":    { container_max_px, section_y_px, section_y_mobile_px, gap_px,
                  boxed_step, boxed_step_mobile, boxed_steps },
  "radii":      { sm_px, md_px, lg_px },
  "logo":       { height_px, show_name_beside },
  "buttons":    { radius_px, padding_y_px, padding_x_px, weight },
  "hero":       { overlay_opacity, min_height_px }
}`}</Code>
      <InfoBox type="warn">
        PATCH semantics are <strong>column overwrite</strong>, not deep-merge.
        The admin's ThemeSection holds the FULL merged theme in local state and PATCHes
        the whole object. Never PATCH a partial theme — missing keys become null.
      </InfoBox>

      <H3>Boxed-inset step values (theme.spacing.boxed_steps)</H3>
      <P>
        <Mono>boxed_step</Mono> (theme-wide default) and <Mono>boxed_step_mobile</Mono>{' '}
        (mobile-portrait-only override — swap to a <em>different step index</em> on
        mobile) — plus every block's own per-block <Mono>boxed_step</Mono> override — are
        step <em>numbers</em> (1-5) that index into <Mono>boxed_steps</Mono>: an array of
        exactly 5{' '}
        <Mono>{'{ value, unit: \'px\' | \'%\', mobile_value?, mobile_unit? }'}</Mono>{' '}
        entries, Zod-validated with <Mono>.length(5)</Mono>. Falls back to the standard
        16/24/40/64/96px scale (<Mono>DEFAULT_BOXED_STEPS</Mono> in{' '}
        <Mono>boxedLayout.js</Mono> / <Mono>head.eta</Mono>) when a tenant hasn't
        customised it. Units can be mixed freely per step — e.g. step 1 = 20px, step 3 = 5%.
      </P>
      <P>
        <Mono>mobile_value</Mono>/<Mono>mobile_unit</Mono> are optional per-step overrides —
        a step can resolve to a different length on phone portrait (≤600px) without
        touching any other step, e.g. step 1 = 16px desktop, 8px mobile. This is distinct
        from <Mono>boxed_step_mobile</Mono> (which points the theme DEFAULT at a different
        step index on mobile) — both can be used together. Both fields have to be listed
        in <Mono>ThemeSchema</Mono>'s <Mono>boxed_steps</Mono> entry in{' '}
        <Mono>routes/website.js</Mono>: Zod strips unknown keys, and until they were added
        every save silently dropped them (the Layout card saved, then reverted). The step
        value fields in <Mono>BrandLayoutFields.jsx</Mono> use <Mono>StepNumberInput</Mono>,
        which keeps the typed text while focused (same idea as the menu{' '}
        <Mono>PriceInput</Mono>). The step pickers under it (default step, mobile override,
        and the block inspector's Boxed inset) show each step's phone value next to or
        instead of its desktop value; the mobile override row shows only the phone value,
        since that is the only place it applies.
      </P>
      <P>
        Every consumer resolves through 5 shared CSS variables (
        <Mono>--boxed-step-1</Mono> … <Mono>--boxed-step-5</Mono>) emitted once in{' '}
        <Mono>head.eta</Mono>'s <Mono>:root</Mono>, with a single{' '}
        <Mono>@media (max-width: 600px) and (orientation: portrait)</Mono> block overriding
        whichever steps have a <Mono>mobile_value</Mono> set. The theme default (
        <Mono>--boxed-pad</Mono>) is just <Mono>var(--boxed-step-N)</Mono>, and all 19{' '}
        <Mono>api/src/views/site/blocks/*.eta</Mono> partials resolve their own per-block{' '}
        <Mono>boxed_step</Mono> override the same way (
        <Mono>{"pad = 'var(--boxed-step-' + step + ')'"}</Mono>) instead of computing a
        literal px/% value — so a per-step mobile value applies everywhere that step is
        used, block overrides included, with no per-block media query needed. On the admin
        canvas, <Mono>boxedLayout.js</Mono> exports the matching{' '}
        <Mono>boxedStepVarCss</Mono>/<Mono>boxedStepVarsCss</Mono>/
        <Mono>boxedStepMobileVarsCss</Mono> helpers, called from{' '}
        <Mono>themeResolver.js</Mono> and emitted by <Mono>ThemeFrame.jsx</Mono>.
      </P>
      <InfoBox type="info">
        The canvas's "Approximate mobile preview" toggle (<Mono>PageBuilder.jsx</Mono>)
        narrows a container div, not the real browser viewport, so it does not retrigger{' '}
        <Mono>@media</Mono> rules — a per-step mobile value only visibly differs in the
        canvas if the admin's actual browser window is narrowed below 600px. This is a
        pre-existing limitation of the preview mode, unrelated to boxed-step resolution.
      </InfoBox>
      <P>
        The canvas's template and theme come from <Mono>brandConfig</Mono> in{' '}
        <Mono>PageBuilder.jsx</Mono>, not from the record being edited: the tenant home
        uses <Mono>tenant_site</Mono>; every other page (location page, extra page or
        modal) uses <Mono>tenant_site</Mono> too, with the venue's{' '}
        <Mono>BRAND_OVERRIDE_FIELDS</Mono> laid over it when that venue's{' '}
        <Mono>website_config.use_brand_override</Mono> is on (a venue-level page fetches
        the venue's config as <Mono>['website-config', venueId]</Mono>). This mirrors{' '}
        <Mono>mergeLocationConfig()</Mono> in <Mono>siteDataSvc.js</Mono>; keep the field
        list in both files the same.
      </P>
      <InfoBox type="warn">
        <Mono>boxedLayout.js</Mono>'s current step values live in a module-level variable
        (<Mono>currentBoxedSteps</Mono>), not React Context — deliberate, since there is
        only ever one <Mono>&lt;ThemeFrame&gt;</Mono> mounted at a time (the page-builder
        canvas). If a second concurrent canvas is ever added, this needs to become a
        Context instead or two tenants' step values will collide.
      </InfoBox>
      <InfoBox type="warn">
        Every canvas component under <Mono>admin/src/components/website-builder/canvas/</Mono>{' '}
        is a second, independent implementation of what its matching SSR{' '}
        <Mono>.eta</Mono> partial renders — there's no shared renderer between them. Any
        conditional-display data flag added to a block (a menu-level toggle, a per-block
        option, a venue setting) must be ported into the canvas version too, or the
        editor's preview silently drifts from the published page. Caught once already:{' '}
        <Mono>MenuInlineCanvas</Mono> (<Mono>dataBlocks.jsx</Mono>) ignored a menu's{' '}
        <Mono>hide_zero_priced_variants</Mono> / <Mono>hide_unpriced_variants</Mono> toggles
        for a while after <Mono>menu_inline.eta</Mono> already had them.
      </InfoBox>

      <H3>The Brand &amp; theme page (/brand)</H3>
      <P>
        Since 20 Oct 2026 the group's brand has its own page, <Mono>pages/Brand.jsx</Mono> (route{' '}
        <Mono>/brand</Mono>, catalogue entry with module <Mono>website</Mono>), because kiosks, menu screens,
        printed menus and the admin's card headers use it too. It renders{' '}
        <Mono>BrandIdentitySection part="brand"</Mono> (brand_name, tagline, logo_url, favicon_url) and{' '}
        <Mono>BrandThemeSection</Mono> (Theme ideas, Colours, Fonts) from <Mono>Website.jsx</Mono>, inside a{' '}
        <Mono>ReadOnlyFieldset</Mono> for people without Website manage. Storage is unchanged:{' '}
        <Mono>tenant_site</Mono> through <Mono>/website/brand-defaults</Mono>, so the public site shows a change
        after Publish, while <Mono>/api/me</Mono>'s <Mono>site_theme</Mono> (swatches, card headers) and the
        designers' Use the brand read the saved draft straight away. Each identity part saves only its own fields
        (<Mono>IDENTITY_PARTS</Mono>: brand, site, all). <Mono>BrandThemeSection</Mono> also writes the legacy{' '}
        <Mono>primary_colour</Mono> / <Mono>font_family</Mono> columns from the theme.
      </P>
      <P>
        <Mono>components/brand/ApplyBrand.jsx</Mono> (<Mono>ApplyBrandCard</Mono>, "Use the brand on other designs")
        lists kiosk designs (Store tech manage), menu screen boards (Menu screens manage) and printed menu designs
        (Menus manage, from <Mono>GET /api/menus/print-designs</Mono>); the ticked ones take{' '}
        <Mono>kitFromBrand(tenant_site)</Mono> (<Mono>shared/themeKit.js</Mono>, source <Mono>brand</Mono>)
        through the mappers <Mono>kioskBrandFromKit()</Mono> / <Mono>boardFromKit()</Mono> /{' '}
        <Mono>printFromKit()</Mono>, saved with each design's own PUT (a board is read first: its list row has no
        layout). In the designers, <Mono>ThemeMakerButton</Mono> shows Use the brand (<Mono>useBrandKit()</Mono>)
        and the theme maker lists Your brand first for every target but the website.
      </P>
      <H3>Brand & theme — tenant default + per-venue site overrides</H3>
      <P>
        <Mono>website_config.use_brand_override</Mono> (migration 098, boolean, default{' '}
        <Mono>false</Mono>) is the single switch deciding whether a venue's own brand/theme
        fields apply. When <Mono>false</Mono> (the default, and the only state for
        single-venue tenants), every field in{' '}
        <Mono>BRAND_OVERRIDE_FIELDS</Mono> (<Mono>siteDataSvc.js</Mono>) — site_name,
        tagline, logo_url, favicon_url, primary_colour, secondary_colour, font_family,
        template_key, theme — is read from <Mono>tenant_site</Mono> only; the venue's own
        stored values (if any, from a previously-removed override) are ignored entirely.
        When <Mono>true</Mono>, the venue's own values replace the tenant's wholesale — no
        per-field blending. <Mono>mergeLocationConfig()</Mono> in <Mono>siteDataSvc.js</Mono>{' '}
        is the one place this resolves.
      </P>
      <P>
        Admin UI: <Mono>BrandSection</Mono> in <Mono>Website.jsx</Mono> (rendered under{' '}
        <Mono>tenant-brand</Mono>, labelled Look &amp; layout) shows a pill selector — "Whole website"
        plus one pill per venue with an active override — only when the tenant has more than one venue.
        Whole website shows a card pointing at <Mono>/brand</Mono>, <Mono>BrandIdentitySection part="site"</Mono>{' '}
        (site name, social picture) and <Mono>BrandLayoutSection</Mono>; a venue pill shows identity (part all),
        theme and layout for that venue.{' '}
        <Mono>Give a location its own look</Mono> calls <Mono>POST /website/config</Mono> (ensures the
        venue's row exists) then <Mono>PATCH /website/config?venue_id=X</Mono> with{' '}
        <Mono>use_brand_override: true</Mono> and every override field COPIED from the
        tenant's current values at that moment — a snapshot, not a live link; editing the
        tenant default afterwards does not change an already-created override.{' '}
        <Mono>Remove override</Mono> just flips the flag back to <Mono>false</Mono> (inline
        double-confirm); the venue's stored values are left in place in case the operator
        re-adds the override later. <Mono>BrandIdentitySection</Mono>,{' '}
        <Mono>BrandThemeSection</Mono>, and <Mono>BrandLayoutSection</Mono> all take an
        optional <Mono>venueId</Mono> prop — <Mono>null</Mono> (default) edits{' '}
        <Mono>tenant_site</Mono> via <Mono>/website/brand-defaults</Mono> exactly as before;
        a venue id edits that venue's <Mono>website_config</Mono> via{' '}
        <Mono>/website/config?venue_id=X</Mono> instead, using the identical form fields.
      </P>
      <P>
        Saving the tenant default (<Mono>PATCH /website/tenant-site</Mono>,{' '}
        <Mono>PATCH</Mono> / <Mono>POST /website/brand-defaults</Mono>) writes{' '}
        <Mono>tenant_site</Mono> only and never touches a venue's{' '}
        <Mono>website_config</Mono>. Until 20 Oct 2026 both routes also stripped{' '}
        <Mono>colors</Mono> / <Mono>typography</Mono> from every venue's theme and set its{' '}
        <Mono>template_key</Mono> to NULL (left over from before migration 098). The column is
        NOT NULL, so every save that sent a template (Brand identity always does) failed with
        a 500 once a venue had website settings, and theme saves emptied overrides' colours
        and fonts.
      </P>
      <InfoBox type="warn">
        This replaces an earlier per-field sparse-inheritance model (
        <Mono>BRAND_INHERITABLE</Mono>, and a <Mono>brandTheme.js</Mono> helper that forced
        tenant colours/typography to always win regardless of what a venue had stored) that
        let a stale, half-filled venue theme silently bleed into the live site. Both are
        deleted — there is no code path left that blends tenant and venue brand/theme
        field-by-field. A venue's brand/theme is either the tenant's, in full, or its own,
        in full.
      </InfoBox>
      <InfoBox type="info">
        The standalone per-venue "Identity" page (site name/tagline/logo/favicon only, no
        theme) that used to sit under the venue Pages nav is gone (2026-09-25). It never
        actually had any effect beyond logo/favicon — <Mono>mergeLocationConfig()</Mono>{' '}
        never read its site_name/tagline back out for rendering — and is now fully
        superseded by the Brand & theme override above, which covers strictly more (theme,
        typography, layout too) with an explicit on/off switch instead of silent
        per-field inheritance.
      </InfoBox>

      <H3>API routes</H3>
      <DataTable
        head={['Method + Path', 'Auth', 'Purpose']}
        rows={[
          ['GET /api/website/config',             'auth',  'Fetch singleton config for the current tenant. Returns {} when no row exists yet.'],
          ['POST /api/website/config',            'admin', 'Create config row (first-time setup). Requires subdomain_slug.'],
          ['PATCH /api/website/config',           'admin', 'Partial update. Mutating custom_domain clears custom_domain_verified.'],
          ['GET /api/website/slug-available',     'auth',  'Global uniqueness check across ALL tenants. Does NOT use withTenant().'],
          ['POST /api/website/tenant-site/verify-domain', 'admin', 'DNS-resolves custom_domain, matches A records to platformIps() (what the site\'s own address and the root resolve to, plus APP_PUBLIC_IPS) and/or a CNAME ending in PUBLIC_ROOT_DOMAIN. Updates the verified flag (verified also writes the domain sync\'s kick file); returns server_status, server_auto, server_state and a hint.'],
          ['GET/POST/PATCH/DELETE /api/website/gallery',    'auth/admin', 'Gallery CRUD + /gallery/reorder.'],
          ['GET/POST/PATCH/DELETE /api/website/pages',      'auth/admin', 'Custom pages CRUD.'],
          ['GET/POST/DELETE /api/website/menus',            'auth/admin', 'PDF menu docs CRUD. GET and POST need ?venue_id= (without it GET returns [] and POST 404s, which is why the admin page could never upload before it sent one).'],
          ['GET/POST /api/website/opening-hours',           'auth/admin', 'Bulk upsert (POST replaces the whole set).'],
          ['GET/POST /api/website/allergens',                'auth/admin', 'Upsert allergen info (document or structured).'],
          ['POST /api/website/upload',            'admin', 'multipart/form-data. Fields: file, kind (images | menus | docs). Delegates to storageSvc.'],
          ['GET /api/site/:slug',                 'public', 'Full site bundle (JSON). 404 when not published. Short cache headers.'],
          ['GET /api/site/:slug/sitemap.xml',     'public', 'Dynamic sitemap.'],
          ['GET /api/site/:slug/robots.txt',      'public', 'robots.txt pointing at the sitemap.'],
        ]}
      />

      <H3>SSR renderer &amp; templates</H3>
      <P>
        <Mono>src/routes/siteRenderer.js</Mono> activates on requests whose Host header
        matches <em>either</em> <Mono>{'{slug}.{PUBLIC_ROOT_DOMAIN}'}</Mono> with a
        non-reserved slug, <em>or</em> a verified <Mono>custom_domain</Mono>. Everything
        else falls through to <Mono>/api/*</Mono>.
      </P>
      <Code>{`// host resolution
resolveSiteHost(host) → { slug, customDomain } | null

// reserved subdomains bypass the renderer entirely
www, api, admin, app, mail, static, assets, cdn, ws,
stripe, webhook, webhooks

// routes (relative to the matched host)
GET /                  → site/templates/{template_key}/index.eta
GET /menu              → templates/{key}/menu.eta   (list)
GET /menu/:id          → templates/{key}/menu.eta   (active PDF)
GET /p/:pageSlug       → templates/{key}/page.eta
GET /sitemap.xml
GET /robots.txt`}</Code>

      <H3>Template &amp; theme structure</H3>
      <Code>{`api/src/views/site/
├── shared/
│   └── head.eta            ← converts theme JSONB → CSS vars
├── not-found.eta            ← 404 for missing / unpublished sites
└── templates/
    ├── classic/             ← warm, traditional layout
    │   ├── index.eta  menu.eta  page.eta
    │   └── partials/{header,footer}.eta
    └── modern/              ← full-bleed editorial layout
        ├── index.eta  menu.eta  page.eta
        └── partials/{header,footer}.eta`}</Code>
      <P>
        Both templates consume the same CSS custom properties
        (<Mono>--c-*</Mono> colours, <Mono>--f-*</Mono> fonts, <Mono>--r-*</Mono> radii,
        etc.) emitted by <Mono>shared/head.eta</Mono>. A theme change applies regardless
        of which template the tenant picks.
      </P>
      <InfoBox type="tip">
        To add a new theme knob: update <Mono>ThemeSchema</Mono> in
        <Mono>routes/website.js</Mono>, the <Mono>DEFAULT_THEME</Mono> constant in
        <Mono>admin/src/pages/Website.jsx</Mono>, and the CSS-variable block in
        <Mono>shared/head.eta</Mono> together.
      </InfoBox>

      <H3>Pluggable storage</H3>
      <P>
        <Mono>src/services/storageSvc.js</Mono> exposes a single{' '}
        <Mono>getStorage().put(tenantId, kind, ext, mimetype, buffer)</Mono> contract.
        Driver is selected via <Mono>STORAGE_DRIVER</Mono> env var.
      </P>
      <DataTable
        head={['Driver', 'Behaviour', 'Env vars']}
        rows={[
          ['local (default)', 'Writes to UPLOAD_DIR. Served at /uploads/* by @fastify/static.', 'UPLOAD_DIR'],
          ['s3',              'Writes to any S3-compatible bucket. Lazy-imports @aws-sdk/client-s3 (optionalDependencies).', 'S3_BUCKET, S3_REGION, S3_ENDPOINT (opt., DO Spaces / R2), S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_URL_BASE, S3_FORCE_PATH_STYLE'],
        ]}
      />
      <InfoBox type="warn">
        Switching driver mid-flight <strong>orphans existing upload URLs</strong>.
        Migrate files between backends first if needed.
      </InfoBox>

      <H3>Block colours: theme roles or a custom code</H3>
      <P>
        <Mono>ThemeColourPicker</Mono> (<Mono>components/website-builder/ThemeColourPicker.jsx</Mono>)
        stores a theme role name (<Mono>primary</Mono>, <Mono>accent</Mono>, <Mono>background</Mono>,{' '}
        <Mono>surface</Mono>, <Mono>text</Mono>, <Mono>muted</Mono>, <Mono>border</Mono>) for a
        swatch, or <Mono>#rrggbb</Mono> for its custom colour (the rainbow swatch, with a code box
        while one is in use; <Mono>allowCustom</Mono> turns it off). Every reader resolves both: a
        role to <Mono>var(--c-*)</Mono> (background is <Mono>--c-bg</Mono>), a code as it is.
        Readers: <Mono>shared/headingBlock.js</Mono> <Mono>roleColour()</Mono>,{' '}
        <Mono>tabs.eta</Mono> / <Mono>tabColour()</Mono>, <Mono>ai_chat.eta</Mono>,{' '}
        <Mono>promo_cta.eta</Mono> / <Mono>promoColour()</Mono> (dark text on a light custom
        background too), <Mono>online_ordering.eta</Mono> <Mono>_colour()</Mono>,{' '}
        <Mono>ordering.eta</Mono> <Mono>boxColour()</Mono>, <Mono>scrolling_text.eta</Mono>,{' '}
        <Mono>footer.eta</Mono> (custom codes since this change; the canvas in{' '}
        <Mono>siteBlocks.jsx</Mono> too) and the reservations widget (<Mono>resolveRoleHex()</Mono>,
        in the block and in <Mono>resolveWidgetDefaults()</Mono> in <Mono>siteRenderer.js</Mono>,
        which now also resolves the tenant default confirmation buttons; a role there used to
        reach the page as <Mono>#primary</Mono>).
      </P>
      <InfoBox type="warn">
        A new block colour field that uses <Mono>ThemeColourPicker</Mono> must accept both
        shapes in its SSR partial and its canvas (or pass <Mono>allowCustom={'{false}'}</Mono>):
        a reader that only maps role names silently drops a custom colour on the live site.
      </InfoBox>

      <H3>Theme maker (a picture and words to a theme)</H3>
      <P>
        One look for four designers: Website &gt; Brand &amp; theme (Theme ideas card), the kiosk
        designer&apos;s Brand panel, the menu screen designer&apos;s board panel and the printed
        menu designer&apos;s Page setup (Colours). <Mono>shared/themeKit.js</Mono> holds the
        rules; a <strong>kit</strong> is <Mono>{'{ name, about, colors: { background, surface, text, muted, border, primary, primary_text, accent, accent_text }, fonts: { heading, body, script, display }, shape: square | soft | round, heading_case: upper | normal, source }'}</Mono>.
      </P>
      <DataTable
        head={['Piece', 'What it does']}
        rows={[
          ['normaliseKit(raw)', 'The only way a kit is made: unknown fonts replaced (website list, display faces DISPLAY_FONTS), and contrast fixed by readableOn() (moves lightness, keeps the hue): text 4.5 on page and surface, muted 3, primary_text / accent_text 4.5, primary 3 against the page.'],
          ['extractPalette(rgba)', 'A picture\'s main colours from canvas pixels: median cut to 16 boxes, colours closer than 26 merged, see-through pixels (alpha < 128) ignored; [{ hex, share, h, s, l }].'],
          ['kitsFromPalette(palette)', 'Light, dark and bold kits from the palette alone (no AI): used when Pepper isn\'t available and shown at once while it works.'],
          ['websiteThemeFromKit / kioskBrandFromKit / boardFromKit / printFromKit', 'A kit into each designer\'s own settings, keeping everything a kit doesn\'t cover (background picture, spacing, logo...). Website: the primary carries white button text (head.eta .btn) and stands out 3:1 from the page when any shade can (websitePrimary()). Board: a light kit gets a deep background with words at 7:1. Print: inks readable on the paper (PRINT_PAPER) at 7 / 4.5.'],
          ['kitFrom*(current) / kitFromCurrent(target, current)', 'A designer\'s current look as a kit, sent to Pepper so "make it warmer" starts from it.'],
        ]}
      />
      <P>
        <Mono>POST /api/ai/themes</Mono> (<Mono>routes/themes.js</Mono>, under /api/ai for the longer
        proxy timeout): body <Mono>{'{ target: website | kiosk | board | print, prompt, image: { media_type, data (base64) }, palette: [{ hex, share }], current, like, count (1-4) }'}</Mono>,
        answer <Mono>{'{ kits, notes }'}</Mono>. Needs Pepper (ai_assistant view, staff_enabled, a key)
        and Manage on the target&apos;s page (<Mono>TARGET_MODULE</Mono>: website, pos_setup, screens,
        menus). The picture is checked by its bytes (<Mono>detectFile()</Mono>, 5 MB) and never stored.{' '}
        <Mono>services/themeAi.js</Mono> <Mono>suggestThemes()</Mono>: one call to the main model with the
        picture, the measured colours (exact, so the model doesn&apos;t guess them), the brand name,
        current / liked kits; structured output (<Mono>THEMES_SCHEMA</Mono>, every property required,
        fonts as enums), falling back to plain JSON if the schema is refused; counted with{' '}
        <Mono>addUsage()</Mono> (channel staff_chat, the person&apos;s daily share); every theme goes
        through <Mono>normaliseKit()</Mono>.
      </P>
      <P>
        Admin: <Mono>components/themes/ThemeMaker.jsx</Mono>. <Mono>ThemeMakerButton</Mono> (shown only
        with Manage) opens <Mono>ThemeMaker</Mono> in a portal in <Mono>{'<body>'}</Mono> (designers sit in
        fieldsets and scrolled panels). <Mono>readPicture()</Mono> shrinks the picture to 1024 px on a
        canvas, measures the palette before a white backing, sends a JPEG; From Media and Use my logo
        fetch the file first (same origin). Previews per place (<Mono>KitPreview</Mono>) draw through the
        same mappers, so a preview is what Use this gives. Use this calls the designer&apos;s{' '}
        <Mono>onApply(kit)</Mono>, which fills its form; Save stays the designer&apos;s. Kits used are kept
        in <Mono>maca_theme_kits</Mono> (8, this device) for the other designers.
      </P>
      <P>
        Alongside: the website <Mono>ThemeSchema</Mono> now keeps <Mono>colors.background_image</Mono> (Zod
        dropped it on every theme save); Brand &amp; theme shows the ready-made themes and the live preview
        (the unreferenced <Mono>ThemeSection</Mono> that held them was removed); printed menu designs take{' '}
        <Mono>ink_color</Mono> / <Mono>accent_color</Mono> / <Mono>muted_color</Mono> (null = standard),
        which <Mono>pageStyle()</Mono> in <Mono>shared/menuLayout.js</Mono> writes as <Mono>--ink</Mono>,{' '}
        <Mono>--plum</Mono> (+ <Mono>--plum-soft</Mono>, <Mono>--line</Mono>) and <Mono>--muted</Mono>.
      </P>
      <InfoBox type="warn">
        A new designer that takes themes needs a mapper and a <Mono>kitFrom*</Mono> in{' '}
        <Mono>themeKit.js</Mono> (checked against that designer&apos;s own normaliser in{' '}
        <Mono>shared/test/themeKit.test.mjs</Mono>), a target in <Mono>KIT_TARGETS</Mono>,{' '}
        <Mono>TARGET_MODULE</Mono> and the prompt&apos;s <Mono>TARGETS</Mono>, and a preview in{' '}
        <Mono>KitPreview</Mono>.
      </InfoBox>

      <H3>Heading block (heading)</H3>
      <P>
        <Mono>blocks/heading.eta</Mono>, editor <Mono>HeadingEditor.jsx</Mono>, canvas{' '}
        <Mono>HeadingCanvas</Mono> (<Mono>canvas/blockCanvas.jsx</Mono>). Every style comes from one
        file, <Mono>shared/headingBlock.js</Mono>: <Mono>headingLayout(data)</Mono> returns the tag, the
        decoration flags and objects of CSS properties; the partial writes them with{' '}
        <Mono>styleString()</Mono>, the canvas with <Mono>styleObject()</Mono>. The partial reaches it as{' '}
        <Mono>it.siteBlocks</Mono>, which <Mono>renderSite()</Mono> in <Mono>siteRenderer.js</Mono> adds to
        every site render (<Mono>headingLayout</Mono>, <Mono>styleString</Mono>,{' '}
        <Mono>googleFontsUrl</Mono>); a new block can share its styles the same way instead of keeping a
        second copy in the canvas. Data: heading, eyebrow, subheading, level h1-h4, size auto | sm | md |
        lg | xl | xxl (lg and up capped by vw), align, font_family (empty = theme heading font, @body =
        theme body font, else a font from shared/fonts.js, loaded by the block's own stylesheet link so
        it works in columns, pages and modals), font_weight, italic, uppercase, colour / sub_colour /
        decoration_colour / background (theme roles; background maps to --c-bg), decoration none | bar |
        rules, spacing sm | md | lg, container, boxed_step. Defaults: <Mono>HEADING_DEFAULTS</Mono>. The
        block renders nothing when heading, eyebrow and subheading are all empty.
      </P>

      <H3>Container blocks: Columns and Tabs</H3>
      <P>
        A container holds other blocks in slots. <Mono>SLOT_FIELD</Mono> in{' '}
        <Mono>website-builder/blockTree.js</Mono> names each container's slot list (<Mono>columns</Mono> →{' '}
        <Mono>data.columns</Mono>, <Mono>tabs</Mono> → <Mono>data.tabs</Mono>); each slot is{' '}
        <Mono>{'{ id, blocks, ...extra }'}</Mono> (a tab adds <Mono>label</Mono> and <Mono>anchor</Mono>). Every
        tree helper (find, map, remove, duplicate, insert, move, reorder) goes through{' '}
        <Mono>slotsOf()</Mono>, and a block's parent inside any container is{' '}
        <Mono>{"{ kind: 'column', blockId, columnId }"}</Mono>. Drop ids: <Mono>col:block:slot</Mono> is a slot
        body, <Mono>tab:block:slot</Mono> (<Mono>tabKey()</Mono>) a tab button, which drops the block at the end
        of that tab; <Mono>parseParentKey()</Mono> reads both. No container inside a container: enforced in{' '}
        <Mono>PageBuilder.jsx</Mono>'s drag end, <Mono>addInColumn</Mono> / <Mono>insertAfter</Mono>, and{' '}
        <Mono>BlockInserter</Mono>'s <Mono>nested</Mono> prop (hides <Mono>isContainer</Mono> blocks).
      </P>
      <P>
        Tabs: editor <Mono>TabsEditor.jsx</Mono> (tab list via <Mono>SortableRows</Mono>, style underline |
        pills | boxed, align left | center | stretch, active_colour theme role, mobile tabs | accordion,
        background), canvas <Mono>TabsCanvas</Mono> in <Mono>canvas/blockCanvas.jsx</Mono> (shows one slot at a
        time), SSR <Mono>blocks/tabs.eta</Mono>: ARIA tablist with arrow keys, accordion at 700px and below
        when mobile = accordion, first panel visible without JS, and a URL hash matching a tab's anchor or any
        element inside a panel opens that panel. Server code that walks blocks for data (the three loaders in{' '}
        <Mono>siteDataSvc.js</Mono>, <Mono>collectBlockFonts</Mono> in <Mono>head.eta</Mono>) walks{' '}
        <Mono>data.columns</Mono> and <Mono>data.tabs</Mono>; a new container type must be added there and to{' '}
        <Mono>SLOT_FIELD</Mono>, and <Mono>collectAnchors()</Mono> in <Mono>blockRegistry.js</Mono> lists tab
        anchors for the link picker.
      </P>
      <P>
        Full screen: <Mono>PageBuilder.jsx</Mono> state in localStorage <Mono>maca_builder_fullscreen</Mono>.
        The root becomes <Mono>fixed inset-0 z-[45]</Mono> (above the AppShell burger at z-40, below modals at
        z-50), the canvas and <Mono>BlockInspector</Mono> (<Mono>fullHeight</Mono>) each scroll on their own.
      </P>

      <H3>Guestplan block (guestplan_widget)</H3>
      <P>
        Embeds Guestplan&apos;s own loader (<Mono>cdn.guestplan.com/widget.js</Mono>, <Mono>window._gstpln.accessKey</Mono>),
        loaded with the page. Guestplan mounts its own floating button and booking form outside the block (on a desktop
        it may open the form by itself); we don&apos;t draw a button. With no heading the block outputs only the script
        (and the optional custom CSS), so it adds no empty band; with a heading it renders a section holding just the
        heading. A second Guestplan block on a page only re-sets the access key.
      </P>
      <P>
        The earlier &quot;Start closed&quot; option (<Mono>data.launcher_mode</Mono>: our own floating button that loaded
        Guestplan on the first tap and then clicked Guestplan&apos;s launcher for the visitor) is gone: on the live site the
        click never opened the form, so visitors had to tap twice. Migration 163 removes <Mono>launcher_mode</Mono> from
        every stored and published block, and clears <Mono>heading</Mono> on blocks that had it on (it was the button&apos;s
        label there).
      </P>

      <H3>Publishing (admin)</H3>
      <P>
        <Mono>Website.jsx</Mono>: <Mono>PublishButton</Mono> sits at the top of the builder's left menu
        (above the Site / location switcher and Home) and shows <Mono>tenant_site.published_at</Mono> or{' '}
        <Mono>scheduled_publish_at</Mono>, with a Staging link beside it (<Mono>staging-{'{subdomain_slug}'}</Mono>,
        new tab, only when a subdomain is set); it opens <Mono>PublishModal</Mono> (staging link,{' '}
        <Mono>POST /website/tenant-site/publish</Mono>, <Mono>POST|DELETE /website/tenant-site/schedule-publish</Mono>,{' '}
        <Mono>POST /website/tenant-site/override-staging</Mono>, all invalidating <Mono>['tenant-site']</Mono>).
        The <Mono>tenant-domain</Mono> section (<Mono>TenantDomainSection</Mono>, now labelled Domain) keeps the
        subdomain, custom domain, DNS verify and the <Mono>is_published</Mono> switch with their own Save.
      </P>
      <P>
        Publish status: <Mono>GET /website/tenant-site/publish-status</Mono> → <Mono>publishStatus()</Mono> in{' '}
        <Mono>services/publishSvc.js</Mono> builds the snapshot Publish would save (<Mono>buildPublishSnapshot()</Mono>)
        and compares it with <Mono>published_snapshot</Mono> through <Mono>canonical()</Mono> (keys sorted, null and
        missing keys dropped, so jsonb key order and fields added to the lists since don&apos;t count). It returns{' '}
        <Mono>{'{ published_at, never_published, in_sync, changes: [{ label, kind }] }'}</Mono>: tenant fields
        grouped by <Mono>TENANT_AREAS</Mono> (Home page, Header, Footer, Brand &amp; theme, SEO, …, anything else
        Site settings), pages by id (added / changed / removed or hidden), per location its page
        (<Mono>page_blocks</Mono>, header/footer switches), its own brand (only while <Mono>use_brand_override</Mono>{' '}
        is on, since a tenant theme save strips colours from every location) and other details.{' '}
        <Mono>usePublishStatus()</Mono> in <Mono>Website.jsx</Mono> refetches 600 ms after any successful mutation
        (mutation cache subscription), every 30 s and on focus; <Mono>PublishButton</Mono> shows the line and a count
        badge, <Mono>PendingChanges</Mono> the list in the publish window. Fixed alongside:{' '}
        <Mono>use_brand_override</Mono> was missing from <Mono>WEBSITE_CONFIG_CONTENT_FIELDS</Mono>, so a
        location&apos;s own Brand &amp; theme never showed on production (it does after the next publish), and
        Override staging re-created pages without their ids or <Mono>system_key</Mono>.
      </P>

      <H3>Staging password</H3>
      <P>
        Migration 158: <Mono>staging_access</Mono> (one row per tenant: <Mono>password_hash</Mono>,{' '}
        <Mono>updated_by</Mono>, <Mono>updated_at</Mono>, RLS). No row = staging is open as before. Kept out of{' '}
        <Mono>tenant_site</Mono> because that row is read with <Mono>SELECT *</Mono> by the renderer and returned whole
        by the admin routes. <Mono>services/stagingAccess.js</Mono>: <Mono>hashPassword()</Mono> /{' '}
        <Mono>checkPassword()</Mono> (scrypt, random salt, <Mono>s1$salt$hash</Mono>), <Mono>cookieValue()</Mono> /{' '}
        <Mono>cookieOk()</Mono> (cookie <Mono>mcrn_staging</Mono> = issued-at + HMAC, 30 days, host-only, HttpOnly,
        SameSite=Lax, Secure on https), <Mono>previewKey()</Mono> / <Mono>previewKeyOk()</Mono> (expiry + HMAC, 10
        minutes), <Mono>safeNext()</Mono> (same-host paths only). Every HMAC is keyed by the stored hash, so changing
        or removing the password ends all cookies and links, and one tenant&apos;s cookie means nothing on another
        tenant&apos;s staging host.
      </P>
      <P>
        Gate: the <Mono>onRequest</Mono> hook in <Mono>routes/siteRenderer.js</Mono>, staging hosts only, every route
        in that plugin except <Mono>/robots.txt</Mono>, <Mono>/bimi.svg</Mono> and the login route. No valid cookie:
        a <Mono>?staging_key=</Mono> that checks out sets the cookie and 302s to the same URL without the key;
        otherwise 401 with <Mono>views/site/staging_login.eta</Mono> (noindex, <Mono>no-store</Mono>).{' '}
        <Mono>POST /_staging/login</Mono> (form <Mono>password</Mono> + <Mono>next</Mono>, 10 a minute per IP) sets the
        cookie and 303s back. Staging pages are sent <Mono>Cache-Control: private, no-cache</Mono>. Other plugins on the
        same host (<Mono>/order-api</Mono>, <Mono>/widget-api</Mono>, <Mono>/uploads</Mono>) aren&apos;t gated: they
        serve the same live data as production.
      </P>
      <P>
        Admin API (<Mono>routes/website.js</Mono>): <Mono>GET /website/tenant-site/staging-access</Mono> →{' '}
        <Mono>{'{ protected, updated_at, updated_by, url }'}</Mono> (never the hash);{' '}
        <Mono>PUT</Mono> the same with <Mono>{'{ password }'}</Mono> (6-200 characters, not blank) or{' '}
        <Mono>{'{ password: null }'}</Mono> to remove, owner/admin; <Mono>POST /website/tenant-site/staging-link</Mono>{' '}
        → the staging URL, with a preview key when protected. Admin UI in <Mono>Website.jsx</Mono>:{' '}
        <Mono>useStagingAccess()</Mono>, <Mono>StagingPassword</Mono> in the publish window&apos;s Staging card, and{' '}
        <Mono>useOpenStaging()</Mono> on both Staging links (opens the tab during the click, then sends it to the
        signed link, opener cleared).
      </P>

      <H3>Admin page</H3>
      <P>
        <Mono>admin/src/pages/Website.jsx</Mono> at the <Mono>/website</Mono> route.
        Left-rail nav with 18 sections. First-time tenants see an onboarding card that
        POSTs a subdomain slug to create the config row.
      </P>
      <P>Shared primitives in the same file:</P>
      <ul className="list-disc ml-5 space-y-1 text-sm text-muted-foreground mb-4">
        <li><Mono>SectionCard</Mono>, <Mono>FormRow</Mono>, <Mono>Toggle</Mono>, <Mono>SaveBar</Mono> — layout</li>
        <li><Mono>FileUpload</Mono>, <Mono>ImageField</Mono> — wrap <Mono>api.upload()</Mono></li>
        <li><Mono>useConfigFields(config, fields)</Mono> — hook used by simple sections to stage edits and PATCH a subset of config fields on save</li>
        <li>
          Gallery uses <Mono>@dnd-kit/sortable</Mono> (new dep). Touch-drag requires a
          200ms delay to avoid conflict with page scroll.
        </li>
      </ul>

      <H3>Custom domain lifecycle</H3>
      <Code>{`1. Tenant saves tenant_site.custom_domain (PATCH /website/tenant-site).
   cleanCustomDomain(): lower case, no scheme / path / port / trailing dot,
   must be a hostname, refuses our own root and *.root (422), and another
   tenant's domain (409). Only a CHANGED domain sets
   custom_domain_verified = false (the Domain section sends the domain
   with every save).
2. Tenant adds DNS:
     CNAME www → {slug}.{root}
     OR
     A     @   → the IPs platformIps() returns: what {slug}.{root} and
                 the root resolve to, plus APP_PUBLIC_IPS if set.
3. Verify DNS → POST /website/tenant-site/verify-domain: resolves the
   domain's CNAME / A records, compares, sets custom_domain_verified,
   and when verified writes /var/lib/macaroonie-domains/kick.
4. The domain sync (scripts/custom-domains-sync.sh, a systemd timer every
   minute, started at once by the kick) runs the domain script:
     scripts/nginx-custom-domain.sh <domain> [www / bare twin]
   which writes sites-available/macaroonie-domain-<domain> (everything
   proxied to the API) and gets a certificate (certbot certonly --webroot).
5. siteRenderer matches the Host header to tenant_site.custom_domain
   (verified, site published).`}</Code>
      <P>
        Step 4 is what makes the domain reach the site: nginx only sends a host to the API when a
        server block names it. Without one a request for the domain lands on nginx&apos;s default
        server for the port, which on this server is certbot&apos;s port-80 block for the apex (
        <Mono>return 404</Mono>), so the guest gets a bare nginx 404 however the app is set up.
      </P>
      <H3>The domain sync</H3>
      <P>
        <Mono>scripts/install-domain-sync.sh</Mono> runs on every deploy (deploy.yml, with sudo). It
        copies both scripts to root-owned <Mono>/usr/local/sbin/macaroonie-domains-sync</Mono> and{' '}
        <Mono>/usr/local/sbin/macaroonie-domain</Mono>, makes <Mono>/var/lib/macaroonie-domains</Mono>{' '}
        (its <Mono>kick</Mono> file owned by the app user) and enables{' '}
        <Mono>macaroonie-domains.timer</Mono> (every minute) and <Mono>macaroonie-domains.path</Mono>{' '}
        (runs the service when <Mono>kick</Mono> is written). The API never runs anything as root: it
        only reads the state directory and writes <Mono>kick</Mono>.
      </P>
      <DataTable
        head={['Each run', 'What happens']}
        rows={[
          ['Reads', 'SELECT lower(custom_domain), custom_domain_verified FROM tenant_site (psql, api/.env\'s DATABASE_URL) in system mode (PGOPTIONS -c app.bypass_rls=on, as systemSql: tenant_site has forced row-level security, migration 176, and without it the query sees no rows). If that fails, or tenant_site has no rows at all, it exits 1 and changes nothing.'],
          ['Removes', 'Every macaroonie-domain-* block whose domain no tenant has saved (any verification state), with its certificate (REMOVE=1 DELETE_CERT=1) and state. The database decides, so a block made by hand for a domain nobody saved goes too.'],
          ['Switches on', 'Each verified domain without a 443 block: DNS must point only at this server (every A record in what the root resolves to plus APP_PUBLIC_IPS; any AAAA record too). Otherwise state waiting_dns with the reason, checked again every run (no certificate request, so no Let\'s Encrypt attempt). Then the domain script with the domain and its www / bare twin when the twin points here and no other tenant saved it.'],
          ['Twin later', 'For a domain already on https, the twin is added once its DNS points here. The domain script keeps https on for the main name while it asks for the bigger certificate and if that fails.'],
          ['Retries', 'A failed certificate waits 5 min, 15 min, 1 h, 6 h, then a day (Let\'s Encrypt allows 5 failed checks per name per hour). A kick retries sooner, but not within 2 minutes of the last try. Twins keep their own backoff in twins/<name>.'],
          ['Reports', '<domain>.json (status working | waiting_dns | http | error | https, message: certbot\'s Detail line or the DNS reason, attempts, last_try, next_try) and last-run, all world-readable.'],
          ['Stops', 'touch /var/lib/macaroonie-domains/disabled. One run at a time (flock); logs: journalctl -u macaroonie-domains.'],
        ]}
      />
      <P>
        <Mono>GET /website/tenant-site/dns-setup</Mono> and the verify response carry{' '}
        <Mono>server_status</Mono> from <Mono>domainServerStatus()</Mono> (reads{' '}
        <Mono>/etc/nginx/sites-enabled/macaroonie-domain-&lt;domain&gt;</Mono>: <Mono>https</Mono> when it
        listens on 443, <Mono>http</Mono> before the certificate, <Mono>none</Mono> without the file,
        null when the API isn&apos;t on the nginx server), plus <Mono>server_auto</Mono> (the sync&apos;s{' '}
        <Mono>last-run</Mono> is under 5 minutes old) and <Mono>server_state</Mono> (its{' '}
        <Mono>&lt;domain&gt;.json</Mono>, <Mono>next_try</Mono> in ms). The Domain section shows the
        progress while <Mono>server_auto</Mono> is on (refetching every 10 seconds until https), the
        manual command for platform admins when it is off, and links the domain only once it is{' '}
        <Mono>https</Mono>. <Mono>DOMAIN_SYNC_DIR</Mono> and <Mono>NGINX_SITES_ENABLED</Mono> override
        the paths (tests).
      </P>
      <DataTable
        head={['scripts/nginx-custom-domain.sh', 'What it does']}
        rows={[
          ['Arguments', 'The site\'s address first (as saved in Website > Domain), then any names that redirect to it (the www or bare version). All names need DNS pointing at the server. Run by the sync; by hand only to add a name the sync doesn\'t, or with the sync off.'],
          ['Certificate', 'CERT_NAME if given, else an existing certificate in /etc/letsencrypt/live covering every name, else certbot certonly --webroot (cert name = the first name; renewed by certbot\'s timer with a nginx reload). Certbot never edits the file.'],
          ['No certificate yet', 'If certbot fails (DNS not here yet, Cloudflare orange cloud), the HTTP-only block stays on, so the site works on http://, and the script exits 1 saying why. When a certificate for the main name already exists (adding a twin), https stays on with it and only the new name is left out.'],
          ['Checks', 'Warns (doesn\'t stop) when no tenant has the first name saved, when it isn\'t verified, or when the site isn\'t live (psql with api/.env\'s DATABASE_URL).'],
          ['REMOVE=1 / DRY_RUN=1', 'Take the domain off (DELETE_CERT=1 also deletes the certificate) / print the config.'],
          ['Lock', 'One run at a time (flock on /run/lock/macaroonie-domain.lock); children get the lock closed so a restarted nginx never holds it.'],
        ]}
      />
      <P>
        Tested against a local nginx, Postgres and the API with certbot stubbed: saved but not
        verified left alone, a failed certificate (http:// only, backoff, kick), https, the twin added
        later, a twin that fails keeping https, DNS pointing elsewhere and a stray AAAA record, removal
        when the domain changes or nobody saved it, the API&apos;s kick and status fields, a bad
        database URL, the off switch, the lock, and the installer (systemd-analyze verify).
      </P>
      <H3>Wildcard pieces (tenant subdomains)</H3>
      <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
        <li>Nginx: wildcard server block for <Mono>*.macaroonie.com</Mono> proxying to the API.</li>
        <li>DNS: wildcard A record for <Mono>*.macaroonie.com</Mono> → app IP.</li>
        <li>SSL: wildcard cert via Certbot DNS-01 (Lightsail DNS hook scripts; see docs/claude/areas/infra.md).</li>
      </ul>
    </section>
  )
}
