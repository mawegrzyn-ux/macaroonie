// src/pages/docs/platform-site.jsx
// The Docs page's "Platform site" section: the public pages on macaroonie.com.
// Docs.jsx gathers every file in this folder (except parts.jsx) by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'platform-site'
export const label = 'Platform site'
export const order = 85

export function Section() {
  return (
    <section id="platform-site" data-doc="">
      <H2>Platform site</H2>
      <P>
        The platform&apos;s own public pages on the apex (macaroonie.com): what Macaroonie does, how it is built,
        screenshots, the register-interest form, and the Terms and conditions and Privacy policy. They are served by the API, not the admin: the apex hook in{' '}
        <Mono>api/src/routes/platformSite.js</Mono> renders them from Eta views, and every other GET on the apex
        still goes to office. (301). No database tables; the content is in code.
      </P>
      <H3>Pages</H3>
      <DataTable
        head={['Address', 'What it shows']}
        rows={[
          ['/', 'Home (views/platform/landing.eta): the message, six feature tiles that each open a drill-down under their row, how it fits, the sandboxes, the team and the register-interest form.'],
          ['/features', 'The same tiles, and an index of every part of every group.'],
          ['/features/<group>', 'One page per group (guests, service, menus, back-office, pepper, one-platform): its points, screenshot, its parts (each opened in place; /features/<group>#<part> opens one) and how it fits.'],
          ['/architecture', 'The picture in layers: at the venue, the venue hub, the cloud, Pepper and outside services. Each part is a button that opens its detail; /architecture#<part> opens one.'],
          ['/screenshots', 'The screenshots, each opening larger in a dialog.'],
          ['/try', 'The kitchen walkthrough and the kiosk designer demo, each with its screenshot and a link (a record\'s open names the button).'],
          ['/try/kitchen-flow', 'The kitchen walkthrough: a narrated Friday service at an invented restaurant in 5 chapters and 20 steps (Back, Next, Play, Restart, arrow keys and space, #step-7 links), the kitchen map with the ways dishes took lit, and the step\'s screens. Story api/platform-site/kitchen-story.js, page api/platform-site/try-kitchen.js and try-kitchen.css.'],
          ['/try/kiosk', 'The kiosk designer demo: the office\'s real kiosk designer (every panel, the media picker, the theme maker) with an invented menu for Harbour & Co, and the real kiosk app as its preview, in a frame under the site\'s header (view try-kiosk.eta, style try.css). Dish pictures and Start again above it; on a phone, the kiosk with a colour set, the headings font and a start picture. Nothing is sent to the API.'],
          ['/site/demo/kiosk-designer/<file>, /site/demo/kiosk-app/<file>', 'The demo\'s two builds, admin/dist-demo and pos/dist-demo (made by npm run build from each app\'s vite.demo.config.js), served by demoBuilds.js from a list of the files each build made: hashed files under assets/ for a year, pages checked every time, anything else 404. pictures-sw.js is sent with Service-Worker-Allowed: /site/demo/.'],
          ['/terms', 'Terms and conditions (view terms.eta): website use, the terms for business customers (27 clauses, numbered by hand) and the data processing schedule (UK GDPR Article 28(3)). Linked from every footer, not the header; no register-interest band (cta: false).'],
          ['/privacy', 'Privacy policy (view privacy.eta): UK GDPR Articles 13 and 14 for visitors, people who register interest, customers and their staff, and restaurant guests (Macaroonie as processor), with the cookies part at /privacy#cookies (the footer\'s Cookies link; there is no /cookies page). The register-interest form links /privacy#register-interest.'],
          ['/sitemap.xml, /robots.txt', 'Every page that is not a placeholder; robots names the sitemap.'],
          ['/site/<file>', 'The pages\' CSS, script and screenshots from api/platform-site/. Linked with ?v=<hash of the file> and then cached for a year; without it, an hour.'],
          ['/site/shared/<version>/<file>', 'The shared rules the sandboxes run in the browser, as they are in shared/ (plain ESM). Only the files the entries import are served (an allowlist made from their import lines); <version> is a hash of them all, so they are cached for a year and an old version answers 404. Gzipped when the browser takes it.'],
        ]}
      />
      <H3>Where things are</H3>
      <DataTable
        head={['File', 'What it holds']}
        rows={[
          ['api/src/services/platformSite/pages.js', 'PAGES: one record per page (path, view, title, description, nav label, soon, shot for the Open Graph image; foot, the footer label of a legal page; updated, its Last updated date; cta: false for no register-interest band). sitePage(), NAV, LEGAL_LINKS (the footer\'s legal links), TRY_PAGES, sitemapXml().'],
          ['api/src/services/platformSite/company.js', 'COMPANY: the registered name, trading name, company number, where it is registered, the registered office and the contact email. The footer of every page and both legal pages read it from here.'],
          ['api/src/services/platformSite/features.js', 'FEATURE_GROUPS: the six groups, their points, parts, screenshot and place in the picture.'],
          ['api/src/services/platformSite/architecture.js', 'ARCH_LAYERS: the layers of the picture and each part\'s text and why it matters.'],
          ['api/src/services/platformSite/screenshots.js', 'SHOTS (file name, size, alt text, caption) and GALLERY, the Screenshots page\'s order.'],
          ['api/src/services/platformSite/sharedModules.js', 'ENTRIES (the kitchen walkthrough\'s modules), sharedBase(), sharedPreloads() for a page\'s modulepreload links, sharedFiles() and serveShared(). A page record names its css, script and shared entries; _head.eta links them.'],
          ['api/src/services/platformSite/assets.js', 'assetUrl() and serveAsset(): /site/<file>, file names checked against a pattern (no folders above img/).'],
          ['api/src/views/platform/site/', '_head.eta and _foot.eta around every page, _tiles.eta, _shot.eta, and one view per page.'],
          ['api/platform-site/', 'site.css, site.js (no build: the header menu, the drill-downs, the picture, the screenshot dialog, the form) and img/ (WebP at 800 and 1600 wide, a JPEG at 1200).'],
          ['scripts/ensure-nginx-site-assets.sh', 'Run by the deploy: adds location ^~ /site/ to the apex nginx config, so the static-file regex doesn\'t look for .css, .js and .png in the admin\'s build.'],
        ]}
      />
      <H3>The legal pages and the company details</H3>
      <P>
        The footer of every page (<Mono>_foot.eta</Mono>, the home page included) carries the trading disclosure the
        company rules ask for: Macaroonie is a trading name of the registered company, where it is registered, its
        number and registered office, the contact email (a mailto link), and a copyright line in the company&apos;s
        name, all from <Mono>company.js</Mono>. Below the site&apos;s links it lists <Mono>LEGAL_LINKS</Mono>: the Terms and
        conditions, the Privacy policy and Cookies (<Mono>/privacy#cookies</Mono>).
      </P>
      <P>
        The words of both documents are in their views, <Mono>views/platform/site/terms.eta</Mono> and{' '}
        <Mono>privacy.eta</Mono>, as plain HTML: a contents list beside the text (sticky from 1000 px, above it on a
        phone) whose links must match the headings&apos; ids, clause numbers written by hand (<Mono>span.sn</Mono> and{' '}
        <Mono>span.cn</Mono>, the schedule&apos;s <Mono>span.sp</Mono> and <Mono>span.pn</Mono>), tables whose cells carry{' '}
        <Mono>data-label</Mono> so each row becomes a card under 640 px, and a print style without the header and
        contents. Styles are the legal block of <Mono>site.css</Mono>. The test checks the numbering, the contents, every
        link into either page and the footer on every page.
      </P>
      <InfoBox type="warn">
        The Privacy policy names the outside services that receive personal data (its section 7, the sub-processor
        list the Terms&apos; data processing schedule points to) and how long data is kept (section 9). When a service is
        added or dropped, or a retention period changes in code, change the policy in the same pull request and move
        the updated date on both page records. The policy says what is true of the code; the statements only the
        owner can confirm (hosting region, backups, transfer safeguards and others) are listed in{' '}
        <Mono>docs/claude/outstanding/shell.md</Mono>.
      </InfoBox>
      <H3>The kiosk designer demo</H3>
      <P>
        The demo is the office&apos;s own code built twice more, never a copy. <Mono>admin/vite.demo.config.js</Mono> builds{' '}
        <Mono>admin/demo-kiosk.html</Mono> (<Mono>src/demo/kiosk/main.jsx</Mono>): <Mono>pages/KioskDesigner.jsx</Mono> with its
        panels, <Mono>MediaLibraryModal</Mono>, <Mono>PicturePick</Mono> and the theme maker, under a{' '}
        <Mono>MemoryRouter</Mono> and a <Mono>QueryClient</Mono>, with no Auth0. A small Vite plugin resolves every import of{' '}
        <Mono>src/lib/api.js</Mono> to <Mono>src/demo/kiosk/demoApi.js</Mono>: the same exports, and a <Mono>useApi()</Mono>{' '}
        that answers the designer&apos;s routes in the browser (<Mono>/me</Mono> as Manage, <Mono>/venues</Mono>,{' '}
        <Mono>/pos/venues/:id/setup</Mono>, <Mono>/pos/kiosk-designs</Mono> GET, POST and PUT through{' '}
        <Mono>normaliseDesign()</Mono>, the preview link, <Mono>/media/*</Mono> and uploads) and refuses the rest with
        &quot;In the demo this isn&apos;t sent anywhere&quot; (a share link, for one). Saves go to <Mono>demoStore.js</Mono>{' '}
        (memory and localStorage <Mono>maca_kiosk_demo_v1</Mono>). The menu, venue and order types are{' '}
        <Mono>demoData.json</Mono>, made through the real API by <Mono>api/test/tools/kiosk-demo-data.mjs</Mono> on a test
        database; pictures in it are <Mono>/demo-img/&lt;name&gt;.svg</Mono>, swapped for the built-in set in{' '}
        <Mono>src/demo/kiosk/img/</Mono> (<Mono>pictures.js</Mono>).
      </P>
      <P>
        The preview is the kiosk app: <Mono>pos/vite.demo.config.js</Mono> builds <Mono>pos/demo-kiosk.html</Mono>, which mounts{' '}
        <Mono>KioskApp</Mono> with <Mono>demo</Mono>. <Mono>bootDemo()</Mono> in <Mono>kiosk/store.js</Mono> starts it as a
        preview (nothing sent, an order ends on Done with a pretend number) whose config comes from the page framing it
        (<Mono>kiosk/demoSource.js</Mono> asks with <Mono>kiosk.demo.want</Mono>; <Mono>src/demo/kiosk/bridge.js</Mono> answers{' '}
        <Mono>kiosk.demo.config</Mono>, and again when a dish&apos;s picture changes). Both sides take messages only from
        this origin and from the frame or parent window. The design goes the office preview&apos;s way:{' '}
        <Mono>kiosk.ready</Mono>, then <Mono>kiosk.design</Mono> on every change.
      </P>
      <P>
        A visitor&apos;s own pictures never leave the browser: drawn smaller on a canvas, kept in Cache Storage under{' '}
        <Mono>/site/demo/my/&lt;id&gt;.webp</Mono> (<Mono>demoPictures.js</Mono>) and answered from there by{' '}
        <Mono>admin/public-demo/pictures-sw.js</Mono>, a service worker scoped to <Mono>/site/demo/</Mono> (so the kiosk frame
        sees them too). A path, because <Mono>normaliseDesign()</Mono> takes only http(s) addresses and paths. In a browser
        without service workers (a private window) adding pictures is refused with a note; the built-in ones still work.
      </P>
      <H3>Adding a page</H3>
      <P>
        Add a record to <Mono>PAGES</Mono> (a <Mono>nav</Mono> label puts it in the header and footer; a{' '}
        <Mono>foot</Mono> label puts it in the footer&apos;s legal links only) and a view in{' '}
        <Mono>views/platform/site/</Mono> that starts with <Mono>{"<%~ include('./_head', it) %>"}</Mono> and ends with{' '}
        <Mono>{"<%~ include('./_foot', it) %>"}</Mono>. Styles go in <Mono>site.css</Mono>, behaviour in{' '}
        <Mono>site.js</Mono> or a file of its own under <Mono>api/platform-site/</Mono>. A sandbox under{' '}
        <Mono>/try/</Mono> names its own view, its <Mono>css</Mono> and <Mono>script</Mono>, and the shared modules its
        script imports (<Mono>shared</Mono>), so they are preloaded; a module not yet on the list goes in{' '}
        <Mono>ENTRIES</Mono>, and must have no Node-only imports. Check the address against the admin&apos;s
        routes first: an admin bookmark on the apex would show the page instead of going to office.
      </P>
      <H3>The pages under /try run the real rules</H3>
      <P>
        Neither page has a copy of a rule. The kitchen walkthrough&apos;s story (<Mono>kitchenStory()</Mono> in{' '}
        <Mono>api/platform-site/kitchen-story.js</Mono>, a module with no imports: the page passes it the shared
        modules it loaded) builds Harbour &amp; Co&apos;s kitchen as a real flow of 15 boxes (a Splitter with a
        split-above rule, a Sleeper, a Setter, two printers, a ready board, the Pass, Packing with the packing
        check, the Floor runner screen) and three flow timers. <Mono>play(n)</Mono> replays steps 1 to n from nothing on{' '}
        <Mono>createBench()</Mono> (<Mono>shared/pos/kitchenBench.js</Mono>, the office&apos;s Test the kitchen) with a
        scripted clock: orders from the till (tables with held courses, an allergy flag), the kiosk (meal deals),
        the website (one for later) and GloriaFood, then the screens&apos; bumps, ticks, a recall, a remake, a fired
        course and a collection, each through the bench as a kitchen screen or till would send it. Printing runs{' '}
        <Mono>kitchenPrintJobs()</Mono> after every change; the timers are <Mono>timerResults()</Mono>. Back is a replay
        to the step before, never an undo, so a step always looks the same and a deep link works. The page draws
        what the rules give: tickets from <Mono>stationTickets()</Mono> laid out as the kitchen screen app draws
        them, with <Mono>ticketColours()</Mono>, <Mono>rowLook()</Mono> and <Mono>ticketLook()</Mono> from{' '}
        <Mono>kitchenColours.js</Mono>; the printers&apos; paper with <Mono>previewHtml()</Mono>; the ready board from{' '}
        <Mono>boardNumbers()</Mono> with the Setter&apos;s status; the map&apos;s lit ways from where each dish arrived
        (<Mono>flowTimes()</Mono>) between the step before and this one. A step the rules refuse throws, and{' '}
        <Mono>api/test/kitchen-walk.test.mjs</Mono> replays the story to check its key steps. The kiosk sandbox cleans its design with{' '}
        <Mono>normaliseDesign()</Mono> and draws it with <Mono>kioskTextVars()</Mono>, <Mono>kioskFontStack()</Mono>,{' '}
        <Mono>kioskFontsUrl()</Mono>, <Mono>partColours()</Mono> and the kiosk&apos;s words (<Mono>uiText()</Mono>); its
        screens are a small stand-in for the kiosk app&apos;s, styled with the same --k-* variables. Neither calls the
        API or saves anything; the kiosk sandbox keeps the visitor&apos;s own design in localStorage.
      </P>
      <InfoBox type="info">
        The screenshots come from a local copy filled with an invented group (Harbour &amp; Co). The steps to take
        them again are in <Mono>docs/claude/areas/shell.md</Mono>. Tests: <Mono>api/test/platform-site.test.mjs</Mono>, <Mono>api/test/kitchen-walk.test.mjs</Mono>.
      </InfoBox>
    </section>
  )
}
